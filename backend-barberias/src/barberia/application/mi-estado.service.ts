import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { errorDeConflicto, errorDePermiso, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import {
  TiempoService,
  ZONA_POR_DEFECTO,
  fechaCalendarioISO,
  horaRelojHHMM,
} from '../../shared/time/tiempo.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import {
  ESTADOS_RESERVA_QUE_ANCLAN,
  ESTADOS_VINCULACION,
} from '../domain/vinculacion.js';
import {
  LIMITE_INASISTENCIAS_POR_DEFECTO,
  describirEstadoFidelizacion,
} from '../../reserva/domain/fidelizacion.js';

/**
 * E4-03/2 · H54 · lo que el CLIENTE ve de su propia fidelización.
 *
 * Hasta aquí el contador de inasistencias y la restricción existían —los
 * calcula E3-10 y los gestiona la sede— pero el cliente no tenía NINGUNA forma
 * de enterarse: se lo encontraba al intentar reservar y recibir el 403
 * `CLIENTE_RESTRINGIDO`. Este servicio expone su propia fila, en su sede y con
 * el mensaje ya redactado.
 *
 * Reglas que respeta:
 *  - Solo su fila: la sede sale del parámetro de la ruta y el cliente del token,
 *    así que nunca hay datos de otra persona ni de otra sede (D48).
 *  - La regla es una sola: el mensaje no se improvisa aquí, lo proyecta
 *    `describirEstadoFidelizacion` sobre el MISMO contador que usa el cobro de
 *    inasistencias (D47).
 *  - Sin suspender nada: la lectura no escribe (y nada de aquí toca
 *    `usuarios.estado_cuenta`, que es decisión manual del ADMINISTRADOR, D48).
 *
 * E3-12/3 · la otra mitad de 1.9 · `desvincular`.
 *
 * El cliente ya podía ENTRAR a una sede (código de acceso) y desde H71 volver
 * a entrar tras un rechazo, pero no podía SALIR por su cuenta: la única vía
 * era que la plataforma rechazara su sexta vinculación. `desvincular` cierra su
 * PROPIA fila —`UPDATE` a `DESVINCULADO`, nunca un borrado (D20/D21)— y es la
 * ruta que le devuelve el control del ciclo de vida.
 */
export interface MiEstadoDto {
  barberiaId: string;
  clienteId: string;
  /** `ACTIVO`, `PENDIENTE_APROBACION` o `DESVINCULADO` en ESA sede (D10). */
  estadoVinculacion: string;
  contadorNoPresentado: number;
  estaRestringido: boolean;
  motivoRestriccion: string | null;
  /** `true` con 3 o más inasistencias: el perfil muestra la advertencia. */
  advertencia: boolean;
  /** Inasistencias que faltan para que esta sede restrinja. */
  inasistenciasParaRestriccion: number;
  /** El límite que aplica la sede (5 por defecto, §5.8). */
  limiteInasistencias: number;
  /** Texto listo para mostrar, o `null` si no hay nada que avisar. */
  mensaje: string | null;
}

/** Resultado de cerrar el vínculo por decisión del propio cliente (E3-12/3). */
export interface MiDesvinculacionDto {
  barberiaId: string;
  clienteId: string;
  barberiaNombre: string;
  estadoVinculacion: 'DESVINCULADO';
  esBarberiaActiva: false;
  /**
   * Vínculos VIVOS que le quedan al cliente. Es el cupo que D10 le devuelve: el
   * `DESVINCULADO` conserva la fila y su historial (D20/D21) pero deja de
   * ocupar plaza, así que la próxima sede ya no nace pendiente de aprobación.
   */
  vinculacionesVigentes: number;
}

@Injectable()
export class MiEstadoService {
  private readonly logger = new Logger(MiEstadoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly tiempo: TiempoService,
  ) {}

  /**
   * `GET /barberias/:barberiaId/mi-estado`
   *
   * 403 `NO_VINCULADO` cuando no hay fila en `cliente_barberias`: sin vínculo no
   * hay estado que mostrar, y el código es el mismo que ya responde
   * `crearReserva` para un cliente no vinculado (E3-03). No se responde 404 para
   * no distinguir «no estás vinculado» de «esta sede no existe» más de lo que ya
   * hace el resto de la API.
   */
  async obtener(barberiaId: string, solicitante: UsuarioAutenticado): Promise<MiEstadoDto> {
    const vinculo = await this.prisma.clienteBarberia.findUnique({
      where: {
        uk_cliente_barberia: {
          usuarioId: solicitante.id,
          barberiaId,
        },
      },
      select: {
        estadoVinculacion: true,
        contadorNoPresentado: true,
        estaRestringido: true,
        motivoRestriccion: true,
      },
    });

    if (!vinculo) {
      throw errorDePermiso(
        'NO_VINCULADO',
        'No estás vinculado a esta barbería: no hay estado que mostrar.',
      );
    }

    const visible = describirEstadoFidelizacion({
      contadorNoPresentado: vinculo.contadorNoPresentado,
      estaRestringido: vinculo.estaRestringido,
      motivoRestriccion: vinculo.motivoRestriccion,
    });

    return {
      barberiaId,
      clienteId: solicitante.id,
      estadoVinculacion: vinculo.estadoVinculacion,
      contadorNoPresentado: visible.contadorNoPresentado,
      estaRestringido: visible.estaRestringido,
      motivoRestriccion: visible.motivoRestriccion,
      advertencia: visible.advertencia,
      inasistenciasParaRestriccion: visible.inasistenciasParaRestriccion,
      limiteInasistencias: LIMITE_INASISTENCIAS_POR_DEFECTO,
      mensaje: visible.mensaje,
    };
  }

  /**
   * `POST /barberias/:barberiaId/mi-estado/desvincular` · E3-12/3.
   *
   * 403 `NO_VINCULADO` sin fila (el código se comparte con la lectura: sin
   * vínculo no hay nada que cerrar), 409 `ESTADO_INVALIDO` si ya está cerrado
   * —cerrar dos veces no es idempotente, es un error del cliente, mismo
   * criterio que el perdón de E4-03— y 422 `RESERVAS_EN_CURSO` con el conteo si
   * quedan citas futuras que anclan el vínculo.
   *
   * D20: NO se toca el contador de inasistencias, ni `esta_restringido`, ni su
   * motivo. Cerrar el vínculo no borra la penalización de la sede y, como la
   * ruta tampoco lo reabre, desvincularse no es una forma de escapar de ella.
   * D21/H71: la fila se conserva en el sitio, así que volver a introducir el
   * código del acceso la reabre sin perder el historial.
   */
  async desvincular(
    barberiaId: string,
    solicitante: UsuarioAutenticado,
  ): Promise<MiDesvinculacionDto> {
    const resultado = await withSerializableTransaction(this.prisma, async (tx) => {
      const vinculo = await tx.clienteBarberia.findUnique({
        where: {
          uk_cliente_barberia: {
            usuarioId: solicitante.id,
            barberiaId,
          },
        },
        include: { barberia: { select: { nombre: true, zonaHoraria: true } } },
      });

      if (!vinculo) {
        throw errorDePermiso(
          'NO_VINCULADO',
          'No estás vinculado a esta barbería: no hay vínculo que cerrar.',
        );
      }

      if (vinculo.estadoVinculacion === ESTADOS_VINCULACION.DESVINCULADO) {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          'Tu vínculo con esta barbería ya está cerrado.',
        );
      }

      // E3-12/3: solo se puede salir con la agenda libre de compromisos
      // futuros. La consulta va ANTES de escribir y dentro de la transacción,
      // para que el conteo y el cierre no puedan verse desordenados por una
      // reserva que entra en el mismo instante.
      const ancladas = await tx.reserva.findMany({
        where: {
          clienteId: solicitante.id,
          barberiaId,
          estado: { in: [...ESTADOS_RESERVA_QUE_ANCLAN] },
          fechaCita: { gte: this.inicioDeHoy(vinculo.barberia?.zonaHoraria) },
        },
        select: { id: true, estado: true, fechaCita: true, horaInicio: true },
        orderBy: [{ fechaCita: 'asc' }, { horaInicio: 'asc' }],
      });

      if (ancladas.length > 0) {
        throw reglaDeNegocio(
          'RESERVAS_EN_CURSO',
          `No puedes desvincularte: tienes ${ancladas.length} reserva(s) en curso en esta barbería. Cancélalas o espéralas primero.`,
          {
            conteo: ancladas.length,
            reservas: ancladas.map((reserva) => ({
              reservaId: reserva.id,
              estado: reserva.estado,
              fecha: fechaCalendarioISO(reserva.fechaCita),
              hora: horaRelojHHMM(reserva.horaInicio),
            })),
          },
        );
      }

      await tx.clienteBarberia.update({
        where: { id: vinculo.id },
        // A propósito SOLO estos dos campos: el contador y la restricción de
        // D20 sobreviven al cierre (desvincularse no perdona inasistencias).
        data: {
          estadoVinculacion: ESTADOS_VINCULACION.DESVINCULADO,
          esBarberiaActiva: false,
        },
      });

      // El cierre y su rastro salen juntos (P-SD-4): no puede quedar el vínculo
      // cerrado sin evento ni el evento sin el cierre.
      await this.auditoria.registrarEvento(
        {
          usuarioId: solicitante.id,
          accion: 'CLIENTE_DESVINCULADO_VOLUNTARIAMENTE',
          entidad: 'cliente_barberias',
          entidadId: vinculo.id,
          contexto: {
            barberiaId,
            clienteId: solicitante.id,
            anterior: {
              estadoVinculacion: vinculo.estadoVinculacion,
              esBarberiaActiva: vinculo.esBarberiaActiva,
            },
            nuevo: {
              estadoVinculacion: ESTADOS_VINCULACION.DESVINCULADO,
              esBarberiaActiva: false,
            },
          },
        },
        tx,
      );

      // Se cuenta ya SIN la fila que se acaba de cerrar: es el cupo que D10 le
      // devuelve al cliente.
      const vinculacionesVigentes = await tx.clienteBarberia.count({
        where: {
          usuarioId: solicitante.id,
          estadoVinculacion: { not: ESTADOS_VINCULACION.DESVINCULADO },
        },
      });

      return {
        barberiaId,
        clienteId: solicitante.id,
        barberiaNombre: vinculo.barberia?.nombre ?? 'la barbería',
        estadoVinculacion: ESTADOS_VINCULACION.DESVINCULADO,
        esBarberiaActiva: false,
        vinculacionesVigentes,
      } satisfies MiDesvinculacionDto;
    });

    this.logger.log(
      `Cliente ${solicitante.id} se desvinculó de la barbería ${barberiaId}; le quedan ${resultado.vinculacionesVigentes} vínculos vigentes`,
    );

    return resultado;
  }

  /**
   * Medianoche UTC del día de HOY en la zona de la sede. `fecha_cita` es un
   * `DATE` y Prisma lo devuelve/escribe como la medianoche UTC de su etiqueta
   * (E2-04), así que comparar contra ese instante es «de hoy en adelante» sin
   * depender de la zona del servidor.
   */
  private inicioDeHoy(zonaHoraria?: string | null): Date {
    const hoy = this.tiempo.fechaLocal(this.tiempo.ahora(), zonaHoraria ?? ZONA_POR_DEFECTO);
    return this.tiempo.fechaDeCalendario(hoy);
  }
}
