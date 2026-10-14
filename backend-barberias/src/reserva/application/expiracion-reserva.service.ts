import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';
import {
  JOBS,
  QUEUES,
  jobIdExpiracionReserva,
} from '../../shared/queues/queue.constants.js';
// H62: el reencolado de una reserva no puede abortar el de las demás.
import { encolarConLimite } from '../../shared/queues/encolado-seguro.js';
import {
  ACTORES,
  ESTADOS,
  type EstadoReserva,
} from '../../shared/domain/estados.js';
import { ReservaStateMachine } from '../../shared/domain/reserva-state-machine.js';
import {
  fechaCalendarioISO,
  horaRelojHHMM,
} from '../../shared/time/tiempo.service.js';

/**
 * Estados desde los que una reserva todavía PUEDE expirar (E3-05 §2).
 * `PROPUESTA_PENDIENTE` entra aquí porque una propuesta de horario también
 * caduca (§5.4 / E3-06): lo que expira es la solicitud, no solo el modo MANUAL.
 */
export const ESTADOS_EXPIRABLES = [ESTADOS.PENDIENTE, ESTADOS.PROPUESTA_PENDIENTE] as const;

/** Resultado observable de un intento de expiración (idempotente). */
export type ResultadoExpiracion =
  | 'EXPIRADA'
  | 'AUN_VIGENTE'
  | 'NO_APLICA'
  | 'NO_EXISTE';

export interface ResultadoReconciliacion {
  expiradas: number;
  reencoladas: number;
}

/**
 * E3-05 · Expiración automática de reservas.
 *
 * Dos entradas, una sola regla:
 *  1. `expirarSiCorresponde()` — la llama el consumidor del job (`ReservaProcessor`).
 *  2. `reconciliar()` — la llama el arranque de la aplicación
 *     (`OnApplicationBootstrap`). Cubre el hueco del §5 del backlog: si Redis o
 *     el servidor se reinician, los jobs con `delay` pueden perderse; al
 *     arrancar, las vencidas se expiran y las vigentes sin job se reencolan.
 *
 * IDEMPOTENCIA (criterio de aceptación): la transición se escribe con un
 * `updateMany` CONDICIONADO al estado y a `expira_at <= ahora`. Ejecutar el
 * processor dos veces no cambia nada porque la segunda vez el `where` ya no
 * encuentra la fila (la reserva salió de `ESTADOS_EXPIRABLES`) y devuelve
 * `NO_APLICA` sin auditoría ni notificación.
 *
 * QUÉ SIGNIFICA "LIBERAR EL ESPACIO": la disponibilidad de E3-02 se CALCULA (no
 * se almacena) y solo cuenta reservas en `PENDIENTE`/`CONFIRMADA`; al pasar a
 * `EXPIRADA` la reserva deja de ocupar el hueco por sí sola. No hay ninguna
 * fila de `bloqueos_agenda` que liberar: esa tabla es para bloqueos manuales.
 */
@Injectable()
export class ExpiracionReservaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExpiracionReservaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoriaService: AuditoriaService,
    @InjectQueue(QUEUES.RESERVAS) private readonly reservasQueue: Queue,
    @Optional() private readonly notificacionService?: NotificacionService,
  ) {}

  /**
   * E3-05 §4 · Reconciliación de arranque, SIN bloquear el arranque (H63).
   *
   * POR QUÉ NO SE ESPERA (medido): Nest llama a `onApplicationBootstrap` dentro
   * de `app.init()`, ANTES de `listen`. Esta reconciliación toca la BD y —con
   * reservas vigentes— encola jobs con techo de 2 s por reserva; y al expirar una
   * reserva notifica al cliente, que es otro encolado. Con Redis caído eso
   * significa que el servidor HTTP no empieza a escuchar hasta que terminen (o
   * hasta que se cuelgue para siempre) tareas secundarias. La disponibilidad de
   * reservas, pagos y catálogos no depende de esta purga: se lanza en segundo
   * plano y su resultado se registra cuando llega.
   */
  onApplicationBootstrap(): void {
    void this.reconciliarEnArranque();
  }

  /**
   * Cuerpo de la reconciliación de arranque. Público para poder esperarlo en
   * tests: el hook de Nest NO lo espera, pero el comportamiento tiene que seguir
   * siendo verificable. Nunca lanza: si la base o Redis no están listos, la
   * aplicación arranca igual y se reintenta en el siguiente arranque.
   */
  async reconciliarEnArranque(): Promise<void> {
    try {
      const { expiradas, reencoladas } = await this.reconciliar();

      if (expiradas > 0 || reencoladas > 0) {
        this.logger.log(
          `Reconciliación de expiraciones: ${expiradas} reserva(s) vencida(s) expirada(s), ${reencoladas} job(s) reencolado(s).`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `No se pudo reconciliar las expiraciones al arrancar: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Expira la reserva SOLO si sigue siendo expirable, su `expira_at` ya venció
   * y el reloj que se pasa lo confirma. Devuelve el motivo, nunca lanza por
   * estado (un estado inesperado es un no-op, no un error: el job pudo quedar
   * huérfano de una versión anterior).
   */
  async expirarSiCorresponde(
    reservaId: string,
    ahora: Date = new Date(),
  ): Promise<ResultadoExpiracion> {
    const reserva = await this.prisma.reserva.findUnique({
      where: { id: reservaId },
      select: { id: true, estado: true, expiraAt: true },
    });

    if (!reserva) {
      this.logger.log(`Reserva ${reservaId} no existe: nada que expirar.`);
      return 'NO_EXISTE';
    }

    if (!ESTADOS_EXPIRABLES.includes(reserva.estado as (typeof ESTADOS_EXPIRABLES)[number])) {
      this.logger.log(
        `Reserva ${reservaId} no expira: estado actual ${reserva.estado}.`,
      );
      return 'NO_APLICA';
    }

    // E2-02 §5.2 (filas 6 y 10): PENDIENTE o PROPUESTA_PENDIENTE → EXPIRADA con
    // el actor SISTEMA. `ESTADOS_EXPIRABLES` es la condición (quedan 10 minutos),
    // el grafo lo confirma la máquina.
    ReservaStateMachine.assertTransition(
      reserva.estado as EstadoReserva,
      ESTADOS.EXPIRADA,
      ACTORES.SISTEMA,
    );

    if (!reserva.expiraAt) {
      this.logger.warn(
        `Reserva ${reservaId} está en ${reserva.estado} pero no tiene expira_at: no se expira.`,
      );
      return 'NO_APLICA';
    }

    if (reserva.expiraAt.getTime() > ahora.getTime()) {
      this.logger.log(
        `Reserva ${reservaId} todavía vigente hasta ${reserva.expiraAt.toISOString()}.`,
      );
      return 'AUN_VIGENTE';
    }

    // Transición + auditoría en la MISMA transacción. El `updateMany` filtra por
    // estado y por expira_at: si aceptar/rechazar/cancelar movieron la reserva
    // en el ínterin, `count === 0` y no se audita nada.
    const expirada = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.reserva.updateMany({
        where: {
          id: reservaId,
          estado: { in: [...ESTADOS_EXPIRABLES] },
          expiraAt: { lte: ahora },
        },
        data: { estado: ESTADOS.EXPIRADA },
      });

      if (count === 0) {
        return null;
      }

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: null, // el sistema no es un usuario: el origen va en el contexto
          accion: 'RESERVA_EXPIRADA',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: {
            estadoAnterior: reserva.estado,
            estadoNuevo: ESTADOS.EXPIRADA,
            expiraAt: reserva.expiraAt?.toISOString() ?? null,
            origen: 'EXPIRACION_AUTOMATICA',
          },
        },
        tx,
      );

      return true;
    });

    if (!expirada) {
      this.logger.log(
        `Reserva ${reservaId} cambió de estado antes de expirar: no se toca.`,
      );
      return 'NO_APLICA';
    }

    this.logger.log(
      `Reserva ${reservaId} expirada por agotar su ventana de ${reserva.estado}.`,
    );

    await this.notificarExpiracion(reservaId);

    return 'EXPIRADA';
  }

  /**
   * Reconciliación (E3-05 §4): expira las vencidas y reencola las vigentes que
   * se quedaron sin job (Redis reiniciado, job perdido o proceso caído).
   *
   * H62 (2026-10-14): el reencolado es best-effort POR RESERVA y con techo de
   * tiempo. Es la otra mitad del arreglo del alta: si el job de una reserva no
   * se pudo encolar en su momento, este es el mecanismo que la recupera.
   */
  async reconciliar(ahora: Date = new Date()): Promise<ResultadoReconciliacion> {
    const vencidas = await this.prisma.reserva.findMany({
      where: { estado: { in: [...ESTADOS_EXPIRABLES] }, expiraAt: { lte: ahora } },
      select: { id: true },
    });

    let expiradas = 0;
    for (const { id } of vencidas) {
      if ((await this.expirarSiCorresponde(id, ahora)) === 'EXPIRADA') {
        expiradas += 1;
      }
    }

    const vigentes = await this.prisma.reserva.findMany({
      where: { estado: { in: [...ESTADOS_EXPIRABLES] }, expiraAt: { gt: ahora } },
      select: { id: true, barberiaId: true, expiraAt: true },
    });

    let reencoladas = 0;
    for (const reserva of vigentes) {
      const jobId = jobIdExpiracionReserva(reserva.id);

      // H62: cada reserva es independiente y best-effort. Antes, la primera que
      // fallara —en `getJob` o en `add`— abortaba la reconciliación de TODAS las
      // siguientes y, como el arranque solo registra una advertencia, esas
      // reservas se quedaban sin job hasta el próximo reinicio. Un `try/catch`
      // tampoco bastaría: con Redis inalcanzable `add` ni resuelve ni rechaza.
      const resultado = await encolarConLimite(async () => {
        // El jobId determinístico hace que esta comprobación sea suficiente: si
        // hay job, es EL job de esta reserva (reencolarlo lo duplicaría).
        const existente = await this.reservasQueue.getJob(jobId);
        if (existente) {
          return false;
        }

        await this.reservasQueue.add(
          JOBS.EXPIRAR_RESERVA,
          { reservaId: reserva.id, barberiaId: reserva.barberiaId },
          {
            jobId,
            delay: Math.max(0, (reserva.expiraAt as Date).getTime() - ahora.getTime()),
          },
        );
        return true;
      });

      if (!resultado.ok) {
        this.logger.warn(
          `No se pudo reencolar el job de expiración de la reserva ${reserva.id} (${resultado.motivo}): se deja para el próximo arranque`,
        );
        continue;
      }

      if (resultado.valor) {
        reencoladas += 1;
      }
    }

    return { expiradas, reencoladas };
  }

  /**
   * Notificación best-effort: nunca tumba —ni cuelga— una expiración ya
   * confirmada. H63: el encolado va con techo (`encolarConLimite`) porque con
   * Redis inalcanzable `add` ni resuelve ni rechaza, y esta llamada está en el
   * camino de la reconciliación de arranque y del processor de expiración.
   */
  private async notificarExpiracion(reservaId: string): Promise<void> {
    if (!this.notificacionService) {
      return;
    }

    const reserva = await this.prisma.reserva.findUnique({
      where: { id: reservaId },
      select: { clienteId: true, fechaCita: true, horaInicio: true },
    });

    if (!reserva) {
      return;
    }

    // E2-04: las etiquetas DATE/TIME se leen por sus partes UTC del
    // almacenamiento, sin `toISOString().slice` (prohibido sobre fechas de cita).
    const fecha = fechaCalendarioISO(reserva.fechaCita);
    const hora = horaRelojHHMM(reserva.horaInicio);

    const encolado = await encolarConLimite(() =>
      this.notificacionService!.enviarNotificacion({
        usuarioId: reserva.clienteId,
        tipo: 'RESERVA_EXPIRADA',
        contenido: `Tu solicitud del ${fecha} a las ${hora} expiró sin confirmarse: el espacio volvió a quedar libre.`,
      }),
    );

    if (!encolado.ok) {
      this.logger.warn(
        `No se pudo notificar la expiración de ${reservaId} (${encolado.motivo}): la reserva ya quedó EXPIRADA y el espacio liberado.`,
      );
    }
  }
}
