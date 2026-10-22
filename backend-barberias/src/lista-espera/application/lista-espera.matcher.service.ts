import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { TiempoService, ZONA_POR_DEFECTO } from '../../shared/time/tiempo.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { ESTADOS_LISTA_ESPERA } from '../../shared/domain/estados.js';
import type { HuecoLiberadoJobPayload } from '../../shared/queues/queue.constants.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';

/** D42 · margen grupal por defecto cuando la sede aún no tiene configuración. */
export const MARGEN_POR_DEFECTO_MINUTOS = 10;

export type ResultadoHuecoLiberado =
  | 'NOTIFICADO'
  | 'SIN_CANDIDATAS'
  | 'NINGUNA_CABE'
  | 'YA_TOMADAS'
  | 'HUECO_INVALIDO'
  | 'HUECO_EN_EL_PASADO'
  | 'SEDE_INEXISTENTE';

export interface ResultadoMatcher {
  resultado: ResultadoHuecoLiberado;
  /** Suscripción que se quedó con el aviso, si hubo. */
  suscripcionId: string | null;
  /** Suscripciones vivas de esa sede y fecha que se evaluaron. */
  candidatas: number;
  /** Candidatas descartadas porque sus servicios + margen no caben. */
  descartadasPorDuracion: number;
}

/**
 * E4-02 · D22 · Carril B: el matcher de la lista de espera.
 *
 * Recibe un bloque de agenda que quedó libre y busca, en la fila FIFO de
 * suscripciones vivas de esa sede y fecha, a quién le cabe. La regla es simple y
 * se aplica de una en una: **un hueco liberado produce como mucho UN aviso**.
 *
 * POR QUÉ UNO Y NO TODOS: avisar a varios convertiría el hueco en una carrera
 * en la que todos menos uno pierden al confirmar (409). El primero de la fila
 * que cabe se queda con el aviso y los demás siguen esperando otro hueco.
 *
 * QUÉ ES «CABER»: la suma de las duraciones de los servicios que el cliente
 * aceptó, MÁS el margen operativo de la sede (D42), tiene que entrar en la
 * duración física del bloque liberado. Se usa `margenGrupalMinutos` de la
 * configuración de la sede, no el margen histórico de la reserva cancelada: el
 * hueco se ofrece a una reserva NUEVA y esa se compone con la configuración
 * vigente.
 *
 * IDEMPOTENCIA: el estado se mueve con un `UPDATE ... WHERE estado = 'PENDIENTE'`
 * dentro de una transacción SERIALIZABLE y se comprueba el conteo. Si dos
 * workers procesan el mismo hueco a la vez, solo uno actualiza la fila y el otro
 * sigue con la siguiente candidata. La notificación se manda DESPUÉS de ganar ese
 * test-and-set, nunca antes: al revés se avisaría a dos clientes del mismo hueco.
 */
@Injectable()
export class ListaEsperaMatcherService {
  private readonly logger = new Logger(ListaEsperaMatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    // E2-04: reloj y zonas centralizados; el fallback solo cubre pruebas que no
    // montan el módulo compartido.
    @Optional() private readonly tiempo: TiempoService = new TiempoService(),
    // E4-02: el aviso es best-effort. Sin el módulo de notificaciones (pruebas
    // unitarias del matcher) se registra en el log y nada más.
    @Optional() private readonly notificacionService?: NotificacionService,
  ) {}

  /**
   * Procesa un `HuecoLiberadoJobPayload`. Nunca lanza por datos del payload: un
   * job con datos imposibles se descarta con su motivo, para que BullMQ no lo
   * reintente tres veces por un error que no se arregla reintentando.
   */
  async procesarHuecoLiberado(payload: HuecoLiberadoJobPayload): Promise<ResultadoMatcher> {
    const inicio = new Date(payload?.inicio ?? '');
    const fin = new Date(payload?.fin ?? '');
    const huecoMinutos = (fin.getTime() - inicio.getTime()) / 60000;

    if (!payload?.barberiaId || !payload?.fecha || !Number.isFinite(huecoMinutos) || huecoMinutos <= 0) {
      this.logger.warn(
        `Hueco liberado descartado: payload inválido (${JSON.stringify(payload ?? null)}).`,
      );
      return this.vacio('HUECO_INVALIDO');
    }

    // Un bloque que ya empezó no es una oportunidad: o terminó del todo, o
    // queda un resto parcial que no coincide con lo que la notificación promete
    // ("de 10:00 a 11:00" cuando ya son las 10:30). La disponibilidad tampoco
    // ofrece tramos pasados (E3-02), y esta es la misma regla.
    if (inicio.getTime() <= this.tiempo.ahora().getTime()) {
      this.logger.warn(
        `Hueco liberado descartado: ${payload.inicio} → ${payload.fin} ya pasó o está en curso.`,
      );
      return this.vacio('HUECO_EN_EL_PASADO');
    }

    const barberia = await this.prisma.barberia.findUnique({
      where: { id: payload.barberiaId },
      select: {
        nombre: true,
        zonaHoraria: true,
        // D42: el margen del bloque nuevo sale de la configuración VIGENTE.
        configuracionBarberia: { select: { margenGrupalMinutos: true } },
      },
    });

    if (!barberia) {
      this.logger.warn(
        `Hueco liberado descartado: la sede ${payload.barberiaId} no existe.`,
      );
      return this.vacio('SEDE_INEXISTENTE');
    }

    const margenMinutos =
      barberia.configuracionBarberia?.margenGrupalMinutos ?? MARGEN_POR_DEFECTO_MINUTOS;

    // D22 · FIFO: el que primero se anotó es el que primero se entera. `id` como
    // segundo criterio para que dos suscripciones del mismo instante tengan un
    // orden estable (y el test no dependa del azar del motor).
    const candidatas = await this.prisma.listaEspera.findMany({
      where: {
        barberiaId: payload.barberiaId,
        fechaObjetivo: this.tiempo.fechaDeCalendario(payload.fecha),
        estado: ESTADOS_LISTA_ESPERA.PENDIENTE,
      },
      orderBy: [{ creadoAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        usuarioId: true,
        creadoAt: true,
        servicios: { select: { id: true, nombre: true, duracionEstimada: true } },
      },
    });

    let descartadasPorDuracion = 0;
    let algunaCabe = false;

    for (const candidata of candidatas) {
      const duracionServicios = candidata.servicios.reduce(
        (total, servicio) => total + servicio.duracionEstimada,
        0,
      );
      const requeridoMinutos = duracionServicios + margenMinutos;

      if (requeridoMinutos > huecoMinutos) {
        descartadasPorDuracion++;
        continue;
      }

      algunaCabe = true;

      if (!(await this.marcarNotificada(candidata.id))) {
        // Otro worker se quedó con esta candidata entre el SELECT y el UPDATE.
        continue;
      }

      await this.notificar(candidata, payload, barberia.nombre, barberia.zonaHoraria, requeridoMinutos);

      return {
        resultado: 'NOTIFICADO',
        suscripcionId: candidata.id,
        candidatas: candidatas.length,
        descartadasPorDuracion,
      };
    }

    return {
      resultado:
        candidatas.length === 0 ? 'SIN_CANDIDATAS' : algunaCabe ? 'YA_TOMADAS' : 'NINGUNA_CABE',
      suscripcionId: null,
      candidatas: candidatas.length,
      descartadasPorDuracion,
    };
  }

  /**
   * Test-and-set del aviso: solo pasa a `NOTIFICADO` si la fila SIGUE
   * `PENDIENTE`. Devuelve `true` si este worker ganó la carrera.
   *
   * La transacción es SERIALIZABLE (Regla de Oro 2) y el `WHERE` por estado es
   * lo que hace la operación atómica: no hay lectura previa que pueda quedar
   * obsoleta entre la comprobación y la escritura.
   */
  private async marcarNotificada(suscripcionId: string): Promise<boolean> {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const actualizadas = await tx.listaEspera.updateMany({
        where: { id: suscripcionId, estado: ESTADOS_LISTA_ESPERA.PENDIENTE },
        data: {
          estado: ESTADOS_LISTA_ESPERA.NOTIFICADO,
          actualizadoAt: this.tiempo.ahora(),
        },
      });

      return actualizadas.count === 1;
    });
  }

  /**
   * Aviso al cliente. Se registra SIEMPRE una línea estructurada (trazabilidad
   * del hueco: quién, cuándo y para qué bloque) y, si el módulo de
   * notificaciones está disponible, se persiste la notificación y se encola su
   * envío. El envío NO se espera: un Redis lento no puede atascar el matcher, y
   * la fila de `notificaciones` ya queda creada antes de encolar.
   */
  private async notificar(
    candidata: { id: string; usuarioId: string },
    payload: HuecoLiberadoJobPayload,
    nombreSede: string,
    zonaHoraria: string,
    requeridoMinutos: number,
  ): Promise<void> {
    const tz = zonaHoraria || ZONA_POR_DEFECTO;
    const desde = this.tiempo.desdeInstante(new Date(payload.inicio), tz).hora;
    const hasta = this.tiempo.desdeInstante(new Date(payload.fin), tz).hora;

    this.logger.log(
      `LISTA_ESPERA_HUECO_LIBERADO ${JSON.stringify({
        suscripcionId: candidata.id,
        usuarioId: candidata.usuarioId,
        barberiaId: payload.barberiaId,
        fecha: payload.fecha,
        inicio: payload.inicio,
        fin: payload.fin,
        reservaId: payload.reservaId ?? null,
        duracionRequeridaMinutos: requeridoMinutos,
      })}`,
    );

    if (!this.notificacionService) return;

    const contenido = `Se liberó un hueco en ${nombreSede} el ${payload.fecha} de ${desde} a ${hasta}. Reserva antes de que lo tome otra persona.`;

    this.notificacionService
      .enviarNotificacion({
        usuarioId: candidata.usuarioId,
        canal: 'EMAIL',
        tipo: 'LISTA_ESPERA_HUECO_LIBERADO',
        contenido,
      })
      .catch((error: Error) =>
        this.logger.warn(
          `No se pudo notificar el hueco a la suscripción ${candidata.id}: ${error.message}`,
        ),
      );
  }

  private vacio(resultado: ResultadoHuecoLiberado): ResultadoMatcher {
    return {
      resultado,
      suscripcionId: null,
      candidatas: 0,
      descartadasPorDuracion: 0,
    };
  }
}
