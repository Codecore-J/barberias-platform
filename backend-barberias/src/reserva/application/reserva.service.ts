import { Injectable, BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { errorDeConflicto, errorDePermiso, errorDeSolicitud, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import {
  ACTORES,
  ESTADOS,
  ESTADOS_CANCELACION_ESPECIAL,
  ESTADOS_PROPUESTA,
  TIPOS_PROPUESTA,
  type ActorTransicion,
  type EstadoReserva,
} from '../../shared/domain/estados.js';
import {
  ReservaStateMachine,
  type EjecutoresDeEfectos,
} from '../../shared/domain/reserva-state-machine.js';
import type { Prisma } from '@prisma/client';
import { CreateReservaDto } from './dto/create-reserva.dto.js';
import {
  LONGITUD_MINIMA_DETALLE,
  MOTIVOS_RECHAZO,
  RechazarReservaDto,
  type MotivoRechazo,
} from './dto/rechazar-reserva.dto.js';
import { ReprogramarReservaDto } from './dto/reprogramar-reserva.dto.js';
import {
  CancelacionEspecialDto,
  MOTIVOS_CANCELACION_ESPECIAL,
  type MotivoCancelacionEspecial,
} from './dto/cancelacion-especial.dto.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { CotizacionResponse, BloqueCalculado } from './dto/cotizacion.dto.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { validateTimeRange } from '../../horario/domain/time.utils.js';
import {
  TiempoService,
  ZONA_POR_DEFECTO,
  fechaCalendarioISO,
  horaRelojHHMM,
} from '../../shared/time/tiempo.service.js';
import { DisponibilidadService } from '../../agenda/application/disponibilidad.service.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import {
  alcanceCumple,
  esAdministradorGlobalPorId,
  ROL_ADMINISTRADOR,
  ROL_ADMIN_BARBERIA,
  ROL_BARBERO,
} from '../../iam/domain/roles.js';

import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  JOBS,
  QUEUES,
  jobIdExpiracionReserva,
  type ExpirarReservaJobPayload,
} from '../../shared/queues/queue.constants.js';

/**
 * Estados desde los que el cliente o la sede todavía pueden cancelar (E3-05).
 * Todo lo demás es terminal (`EXPIRADA`, `CANCELADA`, `RECHAZADA`,
 * `NO_PRESENTADO`, `COMPLETADA`) y volver a cancelarlo es un 409
 * `ESTADO_INVALIDO`.
 *
 * E2-02: la lista no decide la transición —eso es de §5.2 y vive en
 * `estados.ts`—, pero sí expresa «reserva viva» para las operaciones que no
 * cambian el estado (reprogramar y proponer un horario).
 */
export const ESTADOS_CANCELABLES = [
  ESTADOS.PENDIENTE,
  ESTADOS.CONFIRMADA,
  ESTADOS.PROPUESTA_PENDIENTE,
] as const;

/**
 * E3-06 · una cita ya agendada solo se mueve desde los mismos estados desde los
 * que se cancela: una terminal (`EXPIRADA`, `CANCELADA`, `RECHAZADA`,
 * `NO_PRESENTADO`, `COMPLETADA`) no tiene agenda que reprogramar.
 */
export const ESTADOS_REPROGRAMABLES = ESTADOS_CANCELABLES;

/**
 * E3-07 §5.7 · ventana del CLIENTE para cancelar por su cuenta una cita ya
 * agendada. Una solicitud todavía en `PENDIENTE` se cancela siempre; una
 * `CONFIRMADA` (o con propuesta viva) solo hasta 30 minutos antes del inicio.
 * Pasado el límite queda la cancelación especial (E3-07 §3, pendiente) o llamar
 * a la sede (E3-08).
 */
export const VENTANA_CANCELACION_CLIENTE_MIN = 30;

/**
 * E3-08/D18 §5.4 · ventana para resolver una propuesta de horario. El CLIENTE
 * dueño propone y la sede tiene 10 minutos para aceptarla; pasado el plazo la
 * propuesta queda vencida y hay que pedir una nueva.
 */
export const VENTANA_PROPUESTA_HORARIO_MIN = 10;

/** Texto del catálogo §5.5 de cancelación, para la notificación al cliente. */
const TEXTO_MOTIVO_CANCELACION_ESPECIAL: Record<string, string> = {
  EMERGENCIA: 'una emergencia en la sede',
  ENFERMEDAD: 'una indisposición del personal',
  CIERRE_IMPREVISTO: 'un cierre imprevisto de la sede',
  FUERZA_MAYOR: 'un caso de fuerza mayor',
  OTRO: 'una causa justificada de la sede',
};

/** Texto del catálogo §5.5 para la notificación, en el idioma del usuario. */
const TEXTO_MOTIVO_RECHAZO: Record<string, string> = {
  HORARIO_NO_DISPONIBLE: 'el horario ya no está disponible',
  SERVICIO_NO_DISPONIBLE: 'el servicio solicitado ya no está disponible',
  RESPONSABLE_AUSENTE: 'el responsable de la sede no está disponible',
  CLIENTE_RESTRINGIDO: 'existe una restricción sobre tu cuenta en esta barbería',
  OTRO: 'no fue posible atender la solicitud',
};

@Injectable()
export class ReservaService {
  private readonly logger = new Logger(ReservaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly disponibilidadService: DisponibilidadService,
    @InjectQueue(QUEUES.RESERVAS) private readonly reservasQueue: Queue,
    private readonly auditoriaService: AuditoriaService,
    // E2-04: reloj y zona centralizados. El fallback permite pruebas unitarias
    // que no montan el módulo compartido; en producción lo inyecta Nest.
    @Optional() private readonly tiempo: TiempoService = new TiempoService(),
    @Optional() private readonly notificacionService?: NotificacionService,
  ) {}

  /**
   * E2-04: zona horaria de la sede desde `barberias.zona_horaria`. Es la única
   * fuente de la zona; el fallback solo cubre una fila anterior a la migración o
   * un mock de prueba.
   */
  private async zonaDeSede(barberiaId: string, db: any = this.prisma): Promise<string> {
    const barberia = await db.barberia.findUnique({
      where: { id: barberiaId },
      select: { zonaHoraria: true },
    });
    return barberia?.zonaHoraria || ZONA_POR_DEFECTO;
  }

  /**
   * Horizonte de reserva medido en días de la SEDE (E2-04). Antes usaba
   * `new Date()` + `getFullYear/getMonth/getDate` (zona del servidor) y comparaba
   * contra la etiqueta `YYYY-MM-DD` del DTO: con el servidor al oeste de la sede
   * «hoy» podía ser el día anterior.
   */
  private exigirHorizonteDeSede(
    fechaIso: string,
    horizonteDias: number | null | undefined,
    tz: string,
    verbo: 'reservar' | 'agendar',
  ): void {
    if (horizonteDias == null) {
      return;
    }
    const limite = this.tiempo.sumarDias(
      this.tiempo.fechaLocal(this.tiempo.ahora(), tz),
      horizonteDias,
    );

    if (fechaIso.slice(0, 10) > limite) {
      throw reglaDeNegocio(
        'FUERA_DE_HORIZONTE',
        `Solo se puede ${verbo} hasta ${horizonteDias} días de antelación.`,
      );
    }
  }

  /**
   * Cálculo PURO del bloque y su cotización (E2-05/D44). Devuelve el bloque total,
   * la hora de fin, el margen y el desglose de servicios SIN tocar la BD.
   * Se reutiliza en crearReserva y en el endpoint de cotización.
   */
  private calcularBloque(dto: CreateReservaDto, config: { margenGrupalMinutos: number; serviciosCatalogo: any[] }): BloqueCalculado {
    const duracionTotal = (parseInt(dto.horaFin.slice(0, 2), 10) - parseInt(dto.horaInicio.slice(0, 2), 10)) * 60
      + (parseInt(dto.horaFin.slice(3, 5), 10) - parseInt(dto.horaInicio.slice(3, 5), 10));
    const margenTotal = config.serviciosCatalogo.reduce((acc, s) => acc + (s.margenOperativo ?? 0), 0) + (config.margenGrupalMinutos ?? 10);
    const precioTotal = config.serviciosCatalogo.reduce((acc, s) => acc + Number(s.precio), 0);
    return { duracionTotal, margenTotal, precioTotal };
  }

  /**
   * Cotización sin persistir (D44): devuelve bloque total, hora de fin, margen,
   * precio total y desglose de servicios. No graba nada en la BD.
   */
  async cotizar(barberiaId: string, dto: CreateReservaDto) {
    const config = await this.prisma.configuracionBarberia.findUnique({
      where: { barberiaId },
    });
    if (!config) {
      throw new NotFoundException('Configuración de barbería no encontrada');
    }

    const serviciosCatalogo = await this.prisma.servicio.findMany({
      where: {
        id: { in: dto.serviciosIds },
        barberiaId,
        estado: 'ACTIVO',
      },
    });
    if (serviciosCatalogo.length !== dto.serviciosIds.length) {
      throw errorDeSolicitud(
        'SERVICIO_FUERA_DE_BARBERIA',
        'Uno o más servicios seleccionados no existen, no pertenecen a esta barbería o están inactivos.',
      );
    }

    const { duracionTotal, margenTotal, precioTotal } = this.calcularBloque(dto, {
      margenGrupalMinutos: config.margenGrupalMinutos,
      serviciosCatalogo,
    });

    // La hora de fin del bloque se devuelve tal cual la pidió el cliente: el DTO
    // ya la validó como HH:mm. Antes se reconstruía con `new Date(...)` y se
    // formateaba con `toISOString()`, lo que descartaba los minutos (`10:30` →
    // `10:00`) y además desplazaba la hora al convertir a UTC fuera de UTC.
    const [hFin, mFin] = dto.horaFin.split(':').map(Number);
    const horaFin = `${String(hFin).padStart(2, '0')}:${String(mFin).padStart(2, '0')}`;

    return {
      barberiaId,
      fecha: dto.fecha,
      horaFin,
      bloqueTotal: { duracionTotal, margenTotal, precioTotal },
      desgloseServicios: serviciosCatalogo.map((s) => ({
        servicioId: s.id,
        nombre: s.nombre,
        precio: Number(s.precio),
        duracionEstimada: s.duracionEstimada,
        margenOperativo: s.margenOperativo ?? 0,
      })),
    };
  }

  async crearReserva(clienteId: string, barberiaId: string, dto: CreateReservaDto) {
    const { inicio, fin } = validateTimeRange(dto.horaInicio, dto.horaFin);
    // E2-04: la fecha es una etiqueta `DATE`; se normaliza con el servicio central.
    const fecha = this.tiempo.fechaDeCalendario(dto.fecha);

    const duracionSolicitada = (fin.getTime() - inicio.getTime()) / 60000;

    return withSerializableTransaction(this.prisma, async (tx) => {
      // 0. Orden de validaciones (principio 9): sesión → rol → DTO → vinculación
      //    ACTIVO con esa barbería → no restringido → configuración (pausa, tipo
      //    aceptado, horizonte, max_pendientes) → bloque → servicios y combos
      //    activos de ESA barbería → disponibilidad bajo SERIALIZABLE y FOR UPDATE
      //    → persistir con snapshots y modo_confirmacion.
      //
      //    Las reglas de negocio se resuelven ANTES del lock FOR UPDATE: un
      //    rechazo por D40 (403/422) no necesita serializar la barbería entera.
      const vinculo = await tx.clienteBarberia.findUnique({
        where: {
          uk_cliente_barberia: {
            usuarioId: clienteId,
            barberiaId,
          },
        },
      });

      if (!vinculo) {
        throw errorDePermiso('NO_VINCULADO', 'No estás vinculado a esta barbería.');
      }

      if (vinculo.estaRestringido) {
        throw errorDePermiso(
          'CLIENTE_RESTRINGIDO',
          vinculo.motivoRestriccion ?? 'Superaste el límite de inasistencias en esta barbería.',
        );
      }

      const config = await tx.configuracionBarberia.findUnique({
        where: { barberiaId },
      });

      if (!config) {
        throw new NotFoundException('Configuración de barbería no encontrada');
      }

      // E2-04: la zona de la sede se lee una vez y gobierna TODAS las
      // conversiones etiqueta ↔ instante de esta reserva.
      const tz = await this.zonaDeSede(barberiaId, tx);

      if (!config.nuevasReservasActivas) {
        throw reglaDeNegocio(
          'RESERVAS_PAUSADAS',
          'La barbería no está aceptando nuevas reservas actualmente.',
        );
      }

      if (!config.aceptaIndividual) {
        throw new BadRequestException('RESERVAS_PAUSADAS: la barbería no acepta reservas de tipo individual');
      }

      // GRUPAL responde 422 GRUPAL_NO_DISPONIBLE hasta E4-01 (no se ignora en silencio).
      if (dto.tipo === 'GRUPAL' && !config.aceptaGrupal) {
        throw reglaDeNegocio('GRUPAL_NO_DISPONIBLE', 'La barbería no acepta reservas grupales.');
      }

      // Horizonte de reserva: la fecha de la cita no puede superar "hoy +
      // horizonte_reserva_dias", con "hoy" medido en la zona de la SEDE (E2-04).
      this.exigirHorizonteDeSede(dto.fecha, config.horizonteReservaDias, tz, 'reservar');

      // Límite de reservas pendientes de la SEDE: mientras la barbería acumule
      // max_pendientes sin resolver (PENDIENTE o PROPUESTA_PENDIENTE) no admite
      // más, sea de quien sea la solicitud.
      if (config.maxPendientes != null) {
        const pendientes = await tx.reserva.count({
          where: {
            barberiaId,
            estado: { in: [ESTADOS.PENDIENTE, ESTADOS.PROPUESTA_PENDIENTE] },
          },
        });

        if (pendientes >= config.maxPendientes) {
          throw reglaDeNegocio(
            'LIMITE_PENDIENTES',
            `La barbería ya tiene ${pendientes} reservas pendientes (máximo ${config.maxPendientes}).`,
          );
        }
      }

      // Bloqueo pesimista sobre la barbería (row-level lock) para evitar Race Conditions
      await tx.$queryRaw`SELECT id FROM "barberias" WHERE id = ${barberiaId}::uuid FOR UPDATE`;

      // 1. Obtener y validar servicios del catálogo (T6.2 Snapshot Histórico Inmutable)
      const serviciosCatalogo = await tx.servicio.findMany({
        where: {
          id: { in: dto.serviciosIds },
          barberiaId,
          estado: 'ACTIVO',
        },
      });

      if (serviciosCatalogo.length !== dto.serviciosIds.length) {
        throw errorDeSolicitud(
          'SERVICIO_FUERA_DE_BARBERIA',
          'Uno o más servicios seleccionados no existen, no pertenecen a esta barbería o están inactivos.',
        );
      }

      const duracionTotalServicios = serviciosCatalogo.reduce(
        (acc, s) => acc + s.duracionEstimada,
        0,
      );
      const precioTotalCatalogo = serviciosCatalogo.reduce(
        (acc, s) => acc + Number(s.precio),
        0,
      );
      if (duracionSolicitada < duracionTotalServicios) {
        throw new BadRequestException(
          `La duración solicitada (${duracionSolicitada} min) es insuficiente para los servicios seleccionados (mínimo ${duracionTotalServicios} min)`,
        );
      }

      // D42 (2026-10-02): el margen grupal es un campo propio de la barbería
      // (configuracion_barberia.margen_grupal_minutos, default 10, rango 0-60).
      // Se ignoran tanto la suma de márgenes individuales (D01) como cualquier
      // valor enviado por el cliente en el DTO (D44: todo se calcula en el backend).
      const margenFinal = config.margenGrupalMinutos ?? 10;

      // 2. Verificamos disponibilidad en tiempo real delegando a Agenda/Disponibilidad
      const disponibilidades = await this.disponibilidadService.calcularDisponibilidad({
        barberiaId,
        fecha,
        duracionTotal: duracionSolicitada,
        margenRequerido: margenFinal,
      }, tx);

      // E2-04/H36: el bloque solicitado se compone como INSTANTE en la zona de la
      // sede. Antes `new Date(fecha); setHours(...)` usaba la zona del servidor y
      // comparaba contra slots igual de desplazados: el día equivocado no se
      // notaba, pero el instante real de la cita quedaba 4 h fuera de lugar.
      const inicioCita = this.tiempo.aInstante(dto.fecha, dto.horaInicio, tz);
      const finCita = this.tiempo.aInstante(dto.fecha, dto.horaFin, tz);

      const finConMargen = new Date(finCita.getTime() + margenFinal * 60000);

      const isAvailable = disponibilidades.some(slot =>
        inicioCita >= slot.inicio && finConMargen <= slot.fin
      );

      if (!isAvailable) {
        throw new ConflictException('El horario seleccionado ya no está disponible o se solapa con un bloqueo/reserva');
      }

      const expiraAt =
        config.modoReserva === 'MANUAL'
          ? new Date(this.tiempo.ahora().getTime() + 10 * 60000)
          : null;

      // E2-02 §5.2 (filas 1 y 2): MANUAL nace `PENDIENTE` con temporizador de 10
      // minutos; AUTOMATICA nace `CONFIRMADA` sin temporizador. La creación pasa
      // por la máquina igual que el resto de transiciones; el actor es el CLIENTE
      // porque la reserva es suya aunque la teclee el staff (walk-in).
      const estadoInicial: EstadoReserva =
        config.modoReserva === 'AUTOMATICA' ? ESTADOS.CONFIRMADA : ESTADOS.PENDIENTE;
      ReservaStateMachine.assertTransition(null, estadoInicial, ACTORES.CLIENTE);

      // 3. Crear reserva con snapshot financiero inmutable congelado
      const reserva = await tx.reserva.create({
        data: {
          barberiaId,
          clienteId,
          barberoId: dto.barberoId || null,
          tipoReserva: 'INDIVIDUAL',
          fechaCita: fecha,
          horaInicio: inicio,
          horaFin: fin,
          margenGrupalHistorico: margenFinal,
          totalPagar: precioTotalCatalogo, // Fijado inmutablemente desde el catálogo
          estado: estadoInicial,
          modoConfirmacion: config.modoReserva,
          expiraAt,
        },
      });

      // 4. Crear Participante y Vincular snapshot inmutable de cada servicio
      const participante = await tx.participanteReserva.create({
        data: {
          reservaId: reserva.id,
          esAdultoResponsable: true,
          nombreParticipante: dto.nombreInvitado ? dto.nombreInvitado : 'Titular',
        }
      });

      const serviciosData = serviciosCatalogo.map((s) => ({
        participanteId: participante.id,
        servicioId: s.id,
        precioHistorico: s.precio,
        duracionHistorica: s.duracionEstimada,
        margenHistorico: s.margenOperativo ?? 0,
      }));

      await tx.participanteServicio.createMany({
        data: serviciosData,
      });

      this.logger.log(`Reserva ${reserva.id} creada para barbería ${barberiaId} con snapshot financiero de $${precioTotalCatalogo}`);

      if (config.modoReserva === 'MANUAL') {
        // E3-04: el job lleva un `jobId` DETERMINISTA para que aceptar o
        // rechazar puedan cancelarlo. Con un id aleatorio de BullMQ no habría
        // forma de encontrarlo después. Además es idempotente: reencolar la
        // misma reserva no duplica el job.
        await this.reservasQueue.add(
          JOBS.EXPIRAR_RESERVA,
          { reservaId: reserva.id, barberiaId } satisfies ExpirarReservaJobPayload,
          { delay: 10 * 60000, jobId: jobIdExpiracionReserva(reserva.id) },
        );
        this.logger.log(`Job de expiración programado para reserva ${reserva.id} en 10 minutos`);
      }

      // 5. Despacho asíncrono de notificación y programación de recordatorio 1h antes (T8.1)
      if (this.notificacionService) {
        const esAuto = config.modoReserva === 'AUTOMATICA';
        const tipoNotif = esAuto ? 'RESERVA_CONFIRMADA' : 'RESERVA_CREADA';
        const msg = esAuto
          ? `Tu reserva ha sido confirmada para el ${dto.fecha} a las ${dto.horaInicio}.`
          : `Tu reserva ha sido registrada y está pendiente de confirmación para el ${dto.fecha} a las ${dto.horaInicio}.`;

        this.notificacionService
          .enviarNotificacion({
            usuarioId: clienteId,
            tipo: tipoNotif,
            contenido: msg,
          })
          .catch((err) =>
            this.logger.warn(`No se pudo despachar notificación: ${err.message}`),
          );

        this.notificacionService
          .programarRecordatorio({
            usuarioId: clienteId,
            reservaId: reserva.id,
            fechaCita: fecha,
            horaInicio: inicio,
            nombreBarberia: 'Barbería',
            zonaHoraria: tz,
          })
          .catch((err) =>
            this.logger.warn(`No se pudo programar recordatorio: ${err.message}`),
          );
      }

      return reserva;
    });
  }

  async obtenerDetalleReserva(barberiaId: string, reservaId: string, user: UsuarioAutenticado) {
    const reserva = await this.prisma.reserva.findFirst({
      where: { id: reservaId, barberiaId },
      include: {
        participantes: {
          include: {
            participanteServicios: {
              include: {
                servicio: {
                  select: {
                    id: true,
                    nombre: true,
                  },
                },
              },
            },
          },
        },
        pago: true,
        cliente: {
          select: {
            id: true,
            nombreCompleto: true,
            correo: true,
            telefono: true,
          },
        },
      },
    });

    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }

    // SEC-E2 y HALLAZGO-14: Verificar que el usuario autenticado tenga rol en esta barbería,
    // y si SOLO es CLIENTE, verificar que la reserva sea suya.
    const rolesEnBarberia = user.rolesDetallados?.filter(
      (r) => alcanceCumple(r, barberiaId)
    ) || [];

    if (rolesEnBarberia.length === 0) {
      throw new ForbiddenException('No tienes acceso a las reservas de esta barbería.');
    }

    const isAdminOrBarbero = rolesEnBarberia.some((r) =>
      [ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA, ROL_BARBERO].includes(r.nombre),
    );

    if (!isAdminOrBarbero && reserva.clienteId !== user.id) {
      throw new ForbiddenException('No tienes permisos para ver el detalle de esta reserva.');
    }

    return reserva;
  }

  async marcarInasistencia(barberiaId: string, reservaId: string, solicitanteId?: string) {
    if (solicitanteId) {
      const barberia = await this.prisma.barberia.findUnique({
        where: { id: barberiaId },
        select: { responsableId: true },
      });

      if (!barberia) {
        throw new NotFoundException('Barbería no encontrada');
      }

      const isResponsable = barberia.responsableId === solicitanteId;
      // E1-04 (D05): el rol global es ADMINISTRADOR.
      const esGlobal = await esAdministradorGlobalPorId(this.prisma, solicitanteId);
      const rolesUser = await this.prisma.usuarioRol.findMany({
        where: { usuarioId: solicitanteId, barberiaId },
        include: { rol: true },
      });

      if (!isResponsable && !esGlobal && !rolesUser.some((ur) => ur.rol.nombre === 'ADMIN_BARBERIA' || ur.rol.nombre === 'BARBERO')) {
        throw new ForbiddenException('No tienes permisos para marcar inasistencias en esta barbería');
      }
    }

    const resultado = await withSerializableTransaction(this.prisma, async (tx) => {
      const reserva = await tx.reserva.findUnique({
        where: { id: reservaId, barberiaId },
      });

      if (!reserva) {
        throw new NotFoundException('Reserva no encontrada');
      }

      // E2-02 §5.2 (fila 12): CONFIRMADA → NO_PRESENTADO con el actor STAFF. La
      // máquina cubre el doble marcado (NO_PRESENTADO es terminal → 409
      // ESTADO_INVALIDO) y el intento sobre una reserva ya cerrada. Antes se
      // escribía `NO_ASISTIO`, que NO pertenece a los 8 estados de §5.1 (H45).
      await this.cambiarEstado(tx, reserva, ESTADOS.NO_PRESENTADO, ACTORES.STAFF);

      // Obtener o crear vínculo cliente-barbería
      let vinculo = await tx.clienteBarberia.findUnique({
        where: {
          uk_cliente_barberia: {
            usuarioId: reserva.clienteId,
            barberiaId: reserva.barberiaId,
          }
        }
      });

      if (!vinculo) {
        vinculo = await tx.clienteBarberia.create({
          data: {
            usuarioId: reserva.clienteId,
            barberiaId: reserva.barberiaId,
            contadorNoPresentado: 0,
          }
        });
      }

      // Incrementar contador
      const nuevoContador = vinculo.contadorNoPresentado + 1;
      let estaRestringido = vinculo.estaRestringido;
      let motivoRestriccion = vinculo.motivoRestriccion;

      if (nuevoContador >= 5) {
        estaRestringido = true;
        motivoRestriccion = 'Bloqueo automático: Superó el límite de inasistencias (5)';
        this.logger.warn(`El cliente ${reserva.clienteId} ha sido restringido automáticamente en la barbería ${barberiaId}`);
      }

      await tx.clienteBarberia.update({
        where: { id: vinculo.id },
        data: {
          contadorNoPresentado: nuevoContador,
          estaRestringido,
          motivoRestriccion,
        }
      });

      return { success: true, contadorNoPresentado: nuevoContador, estaRestringido };
    });

    // E2-02 §5.2: al entrar en NO_PRESENTADO el temporizador de expiración se
    // cierra por el hook, fuera de la transacción (BullMQ no participa).
    await this.aplicarEfectosPostCommit(reservaId, ESTADOS.NO_PRESENTADO);

    return resultado;
  }

  async obtenerAgendaDiaria(barberiaId: string, fechaStr: string | undefined, user: UsuarioAutenticado) {
    if (!barberiaId) {
      throw new BadRequestException('ID de barbería es requerido');
    }

    const rolesEnBarberia = user.rolesDetallados?.filter(
      (r) => alcanceCumple(r, barberiaId)
    ) || [];

    if (rolesEnBarberia.length === 0) {
      throw new ForbiddenException('No tienes acceso a la agenda de esta barbería.');
    }

    // E2-04: sin `fecha`, el día por defecto es HOY en la zona de la SEDE; antes
    // lo resolvía el controller con `new Date().toISOString()`, que es el día del
    // servidor (UTC en Render).
    const tz = await this.zonaDeSede(barberiaId);
    const fechaLocal =
      fechaStr?.slice(0, 10) || this.tiempo.fechaLocal(this.tiempo.ahora(), tz);

    const startOfDay = new Date(`${fechaLocal}T00:00:00.000Z`);
    const endOfDay = new Date(`${fechaLocal}T23:59:59.999Z`);

    const reservas = await this.prisma.reserva.findMany({
      where: {
        barberiaId,
        fechaCita: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        cliente: {
          select: {
            id: true,
            nombreCompleto: true,
            correo: true,
            telefono: true,
            clienteBarberias: {
              where: { barberiaId },
              select: {
                contadorNoPresentado: true,
                estaRestringido: true,
              }
            }
          },
        },
        barbero: {
          select: {
            id: true,
            nombreCompleto: true,
          }
        },
        participantes: {
          include: {
            participanteServicios: {
              include: {
                servicio: {
                  select: {
                    id: true,
                    nombre: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        horaInicio: 'asc',
      },
    });

    return reservas.map((r) => {
      // E2-04: las etiquetas DATE/TIME se leen por partes UTC del almacenamiento,
      // no con `toISOString().split(...)`.
      const fechaPart = r.fechaCita instanceof Date ? fechaCalendarioISO(r.fechaCita) : fechaLocal;
      const horaPart = r.horaInicio instanceof Date ? horaRelojHHMM(r.horaInicio) : '00:00';

      return {
        id: r.id,
        estado: r.estado,
        fechaHoraInicio: `${fechaPart}T${horaPart}:00`,
        precioTotalHist: Number(r.totalPagar),
        cliente: {
          id: r.cliente?.id,
          nombre: r.cliente?.nombreCompleto || 'Cliente',
          correo: r.cliente?.correo || '',
          telefono: r.cliente?.telefono || 'Sin teléfono',
          contadorNoPresentado: r.cliente?.clienteBarberias?.[0]?.contadorNoPresentado || 0,
          estaRestringido: r.cliente?.clienteBarberias?.[0]?.estaRestringido || false,
        },
        barbero: r.barbero ? {
          id: r.barbero.id,
          nombre: r.barbero.nombreCompleto,
        } : null,
        detalles: (r.participantes || []).flatMap((p) =>
          (p.participanteServicios || []).map((ps) => ({
            id: ps.id,
            nombreServicioHist: ps.servicio?.nombre || 'Servicio',
            duracionMinutosHist: ps.duracionHistorica,
            precioHistorico: Number(ps.precioHistorico),
          }))
        ),
      };
    });
  }

  async obtenerMisReservas(clienteId: string) {
    const reservas = await this.prisma.reserva.findMany({
      where: {
        clienteId,
      },
      include: {
        barberia: {
          select: {
            id: true,
            nombre: true,
          },
        },
        participantes: {
          include: {
            participanteServicios: {
              include: {
                servicio: {
                  select: {
                    id: true,
                    nombre: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        fechaCita: 'desc',
      },
    });

    return reservas.map((r) => {
      const fechaPart = r.fechaCita instanceof Date ? fechaCalendarioISO(r.fechaCita) : '';
      const horaPart = r.horaInicio instanceof Date ? horaRelojHHMM(r.horaInicio) : '00:00';

      return {
        id: r.id,
        estado: r.estado,
        fechaHoraInicio: `${fechaPart}T${horaPart}:00`,
        precioTotalHist: Number(r.totalPagar),
        barberiaNombre: r.barberia?.nombre || 'Barbería',
        detalles: (r.participantes || []).flatMap((p) =>
          (p.participanteServicios || []).map((ps) => ({
            id: ps.id,
            nombreServicioHist: ps.servicio?.nombre || 'Servicio',
            duracionMinutosHist: ps.duracionHistorica,
            precioHistorico: Number(ps.precioHistorico),
          }))
        ),
      };
    });
  }

  /**
   * E3-04 · Aceptar una solicitud MANUAL: `PENDIENTE → CONFIRMADA`.
   *
   * El orden importa y es el mismo que en la creación: primero el lock de la
   * sede (`FOR UPDATE` bajo SERIALIZABLE) y solo después la revalidación de la
   * disponibilidad. Si se revalidara antes de bloquear, otra petición podría
   * ocupar el hueco entre la comprobación y la escritura.
   *
   * `expira_at` se mira ANTES de revalidar: una solicitud caducada responde 409
   * `SOLICITUD_EXPIRADA` y no un conflicto de horario, que es el error que el
   * admin necesita leer para saber qué pasó.
   */
  async aceptarReserva(barberiaId: string, reservaId: string, user: UsuarioAutenticado) {
    const reserva = await withSerializableTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "barberias" WHERE id = ${barberiaId}::uuid FOR UPDATE`;

      const actual = await tx.reserva.findFirst({ where: { id: reservaId, barberiaId } });

      if (!actual) {
        throw new NotFoundException('Reserva no encontrada');
      }

      const tz = await this.zonaDeSede(barberiaId, tx);

      // E2-02 §5.2: solo PENDIENTE → CONFIRMADA y solo con el actor STAFF. Va
      // ANTES de la revalidación de disponibilidad: una reserva terminal no es
      // «conflicto de horario», es una transición inválida (409 ESTADO_INVALIDO).
      ReservaStateMachine.assertTransition(
        actual.estado as EstadoReserva,
        ESTADOS.CONFIRMADA,
        ACTORES.STAFF,
      );

      if (actual.expiraAt && actual.expiraAt.getTime() <= this.tiempo.ahora().getTime()) {
        throw errorDeConflicto(
          'SOLICITUD_EXPIRADA',
          'La solicitud expiró antes de ser aceptada: ya no se puede confirmar.',
        );
      }

      const config = await tx.configuracionBarberia.findUnique({ where: { barberiaId } });
      const margenFinal = config?.margenGrupalMinutos ?? actual.margenGrupalHistorico ?? 10;

      // Las horas se leen con getUTC* porque `parseTime` las escribió con
      // `setUTCHours` (`time.utils.ts`): así se recupera el mismo instante.
      const inicioMin = actual.horaInicio.getUTCHours() * 60 + actual.horaInicio.getUTCMinutes();
      const finMin = actual.horaFin.getUTCHours() * 60 + actual.horaFin.getUTCMinutes();
      const duracionTotal = finMin - inicioMin;

      const disponibilidades = await this.disponibilidadService.calcularDisponibilidad(
        {
          barberiaId,
          fecha: actual.fechaCita,
          duracionTotal,
          margenRequerido: margenFinal,
          // La reserva sigue PENDIENTE mientras se revalida: sin excluirla se
          // bloquearía a sí misma y ningún aceptar legítimo cabría.
          excluirReservaId: actual.id,
        },
        tx,
      );

      // E2-04: el bloque almacenado (etiquetas DATE + TIME) se recompone como
      // INSTANTE en la zona de la sede para comparar con los slots, que ya vienen
      // como instantes reales.
      const fechaIso = fechaCalendarioISO(actual.fechaCita);
      const inicioCita = this.tiempo.aInstante(fechaIso, horaRelojHHMM(actual.horaInicio), tz);
      const finCita = this.tiempo.aInstante(fechaIso, horaRelojHHMM(actual.horaFin), tz);
      const finConMargen = new Date(finCita.getTime() + margenFinal * 60000);

      const sigueDisponible = disponibilidades.some(
        (slot) => inicioCita >= slot.inicio && finConMargen <= slot.fin,
      );

      if (!sigueDisponible) {
        throw errorDeConflicto(
          'CONFLICTO_HORARIO',
          'El horario de la solicitud ya no está disponible: otra reserva o un bloqueo ocupa ese hueco.',
        );
      }

      // E2-02 §5.2: PENDIENTE → CONFIRMADA con el actor STAFF. La máquina es la
      // única que decide el grafo; el «no está PENDIENTE» pasa a ser su 409.
      const actualizada = await this.cambiarEstado(tx, actual, ESTADOS.CONFIRMADA, ACTORES.STAFF);

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: user.id,
          accion: 'RESERVA_CONFIRMADA',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: {
            barberiaId,
            estadoAnterior: actual.estado,
            estadoNuevo: ESTADOS.CONFIRMADA,
          },
        },
        tx,
      );

      return actualizada;
    });

    // El job de expiración se cancela fuera de la transacción: BullMQ no
    // participa en ella. El processor solo expira reservas en PENDIENTE, así
    // que si la cancelación fallara la reserva ya CONFIRMADA seguiría a salvo.
    await this.aplicarEfectosPostCommit(reservaId, ESTADOS.CONFIRMADA);

    if (this.notificacionService) {
      this.notificacionService
        .enviarNotificacion({
          usuarioId: reserva.clienteId,
          tipo: 'RESERVA_CONFIRMADA',
          contenido: `Tu reserva del ${this.fechaISO(reserva.fechaCita)} a las ${this.horaHHMM(reserva.horaInicio)} fue confirmada.`,
        })
        .catch((err) =>
          this.logger.warn(`No se pudo notificar la confirmación: ${err.message}`),
        );
    }

    return reserva;
  }

  /**
   * E3-04 · Rechazar una solicitud MANUAL: `PENDIENTE → RECHAZADA`.
   *
   * El `motivo_codigo` es obligatorio y del catálogo §5.5. Se valida en el
   * servicio ADEMÁS del DTO: así la regla de negocio no depende de que la ruta
   * tenga el `ValidationPipe` global bien configurado, y el 400 sale también
   * cuando el servicio se llama desde otro sitio.
   *
   * `RECHAZADA` no ocupa agenda (§5.3), así que liberar el espacio es
   * consecuencia del propio cambio de estado, no una escritura aparte.
   */
  async rechazarReserva(
    barberiaId: string,
    reservaId: string,
    dto: RechazarReservaDto,
    user: UsuarioAutenticado,
  ) {
    const motivo = this.validarMotivoRechazo(dto);

    const reserva = await withSerializableTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "barberias" WHERE id = ${barberiaId}::uuid FOR UPDATE`;

      const actual = await tx.reserva.findFirst({ where: { id: reservaId, barberiaId } });

      if (!actual) {
        throw new NotFoundException('Reserva no encontrada');
      }

      // E2-02 §5.2: PENDIENTE → RECHAZADA con el actor STAFF.
      const actualizada = await this.cambiarEstado(tx, actual, ESTADOS.RECHAZADA, ACTORES.STAFF, {
        motivoCodigo: motivo.codigo,
        motivoDetalle: motivo.detalle,
      });

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: user.id,
          accion: 'RESERVA_RECHAZADA',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: {
            barberiaId,
            estadoAnterior: actual.estado,
            estadoNuevo: ESTADOS.RECHAZADA,
            motivoCodigo: motivo.codigo,
            motivoDetalle: motivo.detalle,
          },
        },
        tx,
      );

      return actualizada;
    });

    await this.aplicarEfectosPostCommit(reservaId, ESTADOS.RECHAZADA);

    if (this.notificacionService) {
      const razon = motivo.codigo === 'OTRO' ? motivo.detalle : TEXTO_MOTIVO_RECHAZO[motivo.codigo];
      this.notificacionService
        .enviarNotificacion({
          usuarioId: reserva.clienteId,
          tipo: 'RESERVA_RECHAZADA',
          contenido: `Tu solicitud del ${this.fechaISO(reserva.fechaCita)} a las ${this.horaHHMM(reserva.horaInicio)} fue rechazada: ${razon}.`,
        })
        .catch((err) =>
          this.logger.warn(`No se pudo notificar el rechazo: ${err.message}`),
        );
    }

    return reserva;
  }

  /**
   * Catálogo §5.5 en el dominio: obligatorio, cerrado y con la regla de `OTRO`
   * (detalle de al menos 5 caracteres). Devuelve el valor ya normalizado.
   */
  private validarMotivoRechazo(dto: RechazarReservaDto): {
    codigo: MotivoRechazo;
    detalle: string | null;
  } {
    const codigo = dto?.motivoCodigo;

    if (!codigo || !MOTIVOS_RECHAZO.includes(codigo as MotivoRechazo)) {
      throw errorDeSolicitud(
        'MOTIVO_INVALIDO',
        `motivoCodigo es obligatorio y debe pertenecer al catálogo de rechazo: ${MOTIVOS_RECHAZO.join(', ')}.`,
      );
    }

    const detalle = typeof dto.motivoDetalle === 'string' ? dto.motivoDetalle.trim() : '';

    if (codigo === 'OTRO' && detalle.length < LONGITUD_MINIMA_DETALLE) {
      throw errorDeSolicitud(
        'MOTIVO_INVALIDO',
        `Cuando el motivo es OTRO, motivoDetalle debe tener al menos ${LONGITUD_MINIMA_DETALLE} caracteres.`,
      );
    }

    return { codigo: codigo as MotivoRechazo, detalle: detalle || null };
  }

  /**
   * Cancela el job de expiración de una reserva (E3-04 §4).
   *
   * Es best-effort a propósito: BullMQ es un sistema aparte y no puede tumbar
   * una transición de estado ya confirmada. El processor vuelve a comprobar
   * `estado === ESTADOS.PENDIENTE` antes de expirar, así que un job que sobreviva no
   * puede mover una reserva que ya dejó de estar pendiente.
   */
  private async cancelarJobExpiracion(reservaId: string): Promise<void> {
    const jobId = jobIdExpiracionReserva(reservaId);

    try {
      const job = await this.reservasQueue.getJob(jobId);
      if (!job) {
        this.logger.log(`No había job de expiración que cancelar para la reserva ${reservaId}.`);
        return;
      }

      await job.remove();
      this.logger.log(`Job de expiración ${jobId} cancelado para la reserva ${reservaId}.`);
    } catch (err: any) {
      this.logger.warn(
        `No se pudo cancelar el job de expiración ${jobId}: ${err?.message ?? err}`,
      );
    }
  }


  /**
   * E3-08 §5.4 · validación del BLOQUE NUEVO de una propuesta de horario.
   *
   * Es la misma batería que aplica la reprogramación directa del staff, en el
   * orden del principio 9: configuración de la sede (pausa → horizonte) →
   * duración frente a los servicios CONGELADOS → disponibilidad excluyendo la
   * propia reserva. NO escribe nada: quien la llama decide si persiste el
   * bloque, porque proponer no ocupa agenda y aceptar sí.
   */
  private async validarBloqueNuevo(
    tx: any,
    barberiaId: string,
    actual: { id: string; margenGrupalHistorico: number | null },
    dto: ReprogramarReservaDto,
  ): Promise<{ fecha: Date; inicio: Date; fin: Date }> {
    const { inicio, fin } = validateTimeRange(dto.horaInicio, dto.horaFin);
    // E2-04: la fecha es una etiqueta `DATE`; se normaliza con el servicio central.
    const fecha = this.tiempo.fechaDeCalendario(dto.fecha);
    const duracionSolicitada = (fin.getTime() - inicio.getTime()) / 60000;

    const config = await tx.configuracionBarberia.findUnique({ where: { barberiaId } });

    if (!config) {
      throw new NotFoundException('Configuración de barbería no encontrada');
    }

    const tz = await this.zonaDeSede(barberiaId, tx);

    if (!config.nuevasReservasActivas) {
      throw reglaDeNegocio(
        'RESERVAS_PAUSADAS',
        'La barbería no está aceptando cambios de horario actualmente.',
      );
    }

    // Mismo horizonte que crearReserva, con "hoy" en la zona de la SEDE (E2-04).
    this.exigirHorizonteDeSede(dto.fecha, config.horizonteReservaDias, tz, 'agendar');

    // Los servicios están congelados en el snapshot: el bloque nuevo tiene que
    // seguir cubriendo lo que se pactó.
    const serviciosCongelados = await tx.participanteServicio.findMany({
      where: { participante: { reservaId: actual.id } },
      select: { duracionHistorica: true },
    });

    const duracionMinima = serviciosCongelados.reduce(
      (acc: number, s: { duracionHistorica: number }) => acc + s.duracionHistorica,
      0,
    );

    if (duracionSolicitada < duracionMinima) {
      throw new BadRequestException(
        `La duración solicitada (${duracionSolicitada} min) es insuficiente para los servicios de la reserva (mínimo ${duracionMinima} min)`,
      );
    }

    const margenFinal = actual.margenGrupalHistorico ?? config.margenGrupalMinutos ?? 10;

    const disponibilidades = await this.disponibilidadService.calcularDisponibilidad(
      {
        barberiaId,
        fecha,
        duracionTotal: duracionSolicitada,
        margenRequerido: margenFinal,
        excluirReservaId: actual.id,
      },
      tx,
    );

    // E2-04: el bloque nuevo se compone como instante en la zona de la sede.
    const inicioCita = this.tiempo.aInstante(dto.fecha, dto.horaInicio, tz);
    const finCita = this.tiempo.aInstante(dto.fecha, dto.horaFin, tz);
    const finConMargen = new Date(finCita.getTime() + margenFinal * 60000);

    const libre = disponibilidades.some(
      (slot: { inicio: Date; fin: Date }) => inicioCita >= slot.inicio && finConMargen <= slot.fin,
    );

    if (!libre) {
      throw errorDeConflicto(
        'CONFLICTO_HORARIO',
        'El horario nuevo ya no está disponible: otra reserva o un bloqueo ocupa ese hueco.',
      );
    }

    return { fecha, inicio, fin };
  }

  /**
   * Catálogo §5.5 de cancelación en el dominio: obligatorio, cerrado y con la
   * regla de `OTRO` (detalle de al menos 5 caracteres). Mismo criterio que la
   * validación del rechazo, aplicada a su propio catálogo.
   */
  private validarMotivoCancelacionEspecial(dto: CancelacionEspecialDto): {
    codigo: MotivoCancelacionEspecial;
    detalle: string | null;
  } {
    const codigo = dto?.motivoCodigo;

    if (!codigo || !MOTIVOS_CANCELACION_ESPECIAL.includes(codigo as MotivoCancelacionEspecial)) {
      throw errorDeSolicitud(
        'MOTIVO_INVALIDO',
        `motivoCodigo es obligatorio y debe pertenecer al catálogo de cancelación: ${MOTIVOS_CANCELACION_ESPECIAL.join(', ')}.`,
      );
    }

    const detalle = typeof dto.motivoDetalle === 'string' ? dto.motivoDetalle.trim() : '';

    if (codigo === 'OTRO' && detalle.length < LONGITUD_MINIMA_DETALLE) {
      throw errorDeSolicitud(
        'MOTIVO_INVALIDO',
        `Cuando el motivo es OTRO, motivoDetalle debe tener al menos ${LONGITUD_MINIMA_DETALLE} caracteres.`,
      );
    }

    return { codigo: codigo as MotivoCancelacionEspecial, detalle: detalle || null };
  }

  /**
   * E2-04: la etiqueta `YYYY-MM-DD` de un `DATE` (Prisma la entrega a medianoche
   * UTC) se lee por sus partes UTC. Sustituye a
   * `new Date(fecha).toISOString().slice(0, 10)`, que el backlog prohíbe sobre
   * fechas de cita.
   */
  private fechaISO(fecha: Date): string {
    return fechaCalendarioISO(fecha);
  }

  private horaHHMM(hora: Date): string {
    return horaRelojHHMM(hora);
  }

  /**
   * Instante del inicio de la cita, que es lo que decide la ventana de los 30
   * minutos (§5.7).
   *
   * `fecha_cita` es `DATE` y `hora_inicio` es `TIME`: dos ETIQUETAS de calendario
   * sin zona, no dos instantes. E2-04 las recompone con `TiempoService.aInstante`
   * en la zona de la SEDE (`barberias.zona_horaria`).
   *
   * Antes se leían las partes UTC del día y se montaba la hora con la zona del
   * SERVIDOR. Con Render en UTC el instante quedaba 4 h después del real para una
   * sede en UTC-4, así que la ventana de §5.7 cerraba ~4 h tarde: el CLIENTE podía
   * cancelar hasta 3 h 30 min DESPUÉS del inicio (H36).
   */
  private instanteInicioCita(
    reserva: { fechaCita: Date; horaInicio: Date },
    tz: string,
  ): Date {
    return this.tiempo.aInstante(
      fechaCalendarioISO(reserva.fechaCita),
      horaRelojHHMM(reserva.horaInicio),
      tz,
    );
  }

  /**
   * E3-07 §5.7 · la barrera de los 30 minutos, en un solo sitio.
   *
   * Se permite cancelar cuando faltan 30 minutos O MÁS (`ahora <= inicio − 30`),
   * tal como lo fija el backlog; a 29 minutos ya es 422 `FUERA_DE_VENTANA`.
   */
  private exigirVentanaDeCancelacion(
    reserva: { fechaCita: Date; horaInicio: Date },
    tz: string,
  ): void {
    const minutosRestantes = Math.floor(
      (this.instanteInicioCita(reserva, tz).getTime() - this.tiempo.ahora().getTime()) / 60000,
    );

    if (minutosRestantes >= VENTANA_CANCELACION_CLIENTE_MIN) {
      return;
    }

    const detalle =
      minutosRestantes < 0
        ? 'La cita ya comenzó'
        : `Faltan ${minutosRestantes} minutos para la cita`;

    throw reglaDeNegocio(
      'FUERA_DE_VENTANA',
      `${detalle} y el límite para cancelar por tu cuenta es de ${VENTANA_CANCELACION_CLIENTE_MIN} minutos. Contacta con la barbería para una cancelación especial.`,
    );
  }

  /**
   * E3-06 · Reprogramación de una reserva vigente.
   *
   * Mueve la cita a otro bloque SIN tocar nada más: el estado, los snapshots de
   * los servicios y el total a pagar se conservan. Lo único que cambia es CUÁNDO.
   *
   * ORDEN (principio 9, el mismo de `crearReserva`): DTO → estado → configuración
   * de la sede (pausa, horizonte) → duración frente a los servicios CONGELADOS →
   * disponibilidad bajo SERIALIZABLE y `FOR UPDATE` → persistir → auditar.
   *
   * "LIBERAR EL HORARIO ACTUAL Y ADQUIRIR EL NUEVO" es UNA sola escritura: la
   * ocupación de la agenda es la propia fila de `reservas` (la disponibilidad se
   * CALCULA, no se almacena, y no hay tabla de huecos intermedios). Con el lock
   * de la sede tomado, el `update` de `fecha_cita`/`hora_inicio`/`hora_fin`
   * suelta el bloque viejo y toma el nuevo en el mismo instante: no existe una
   * ventana en la que la reserva ocupe los dos huecos ni ninguno. Por eso la
   * revalidación EXCLUYE esta reserva (`excluirReservaId`): sin eso se bloquearía
   * a sí misma al solaparse con su propio hueco anterior.
   *
   * El job de expiración NO se reencola: su `delay` sale de `expira_at`, que no
   * cambia al reprogramar, y su `jobId` es determinístico, así que sigue siendo
   * el mismo job.
   */
  async reprogramarReserva(
    barberiaId: string,
    reservaId: string,
    dto: ReprogramarReservaDto,
    user: UsuarioAutenticado,
  ) {
    const { inicio, fin } = validateTimeRange(dto.horaInicio, dto.horaFin);
    // E2-04: la fecha es una etiqueta `DATE`; se normaliza con el servicio central.
    const fecha = this.tiempo.fechaDeCalendario(dto.fecha);
    const duracionSolicitada = (fin.getTime() - inicio.getTime()) / 60000;

    const reserva = await withSerializableTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "barberias" WHERE id = ${barberiaId}::uuid FOR UPDATE`;

      const actual = await tx.reserva.findFirst({ where: { id: reservaId, barberiaId } });

      if (!actual) {
        throw new NotFoundException('Reserva no encontrada');
      }

      if (
        !ESTADOS_REPROGRAMABLES.includes(
          actual.estado as (typeof ESTADOS_REPROGRAMABLES)[number],
        )
      ) {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          `Solo se puede reprogramar una reserva vigente (estado actual: ${actual.estado}).`,
        );
      }

      const config = await tx.configuracionBarberia.findUnique({ where: { barberiaId } });

      if (!config) {
        throw new NotFoundException('Configuración de barbería no encontrada');
      }

      const tz = await this.zonaDeSede(barberiaId, tx);

      if (!config.nuevasReservasActivas) {
        throw reglaDeNegocio(
          'RESERVAS_PAUSADAS',
          'La barbería no está aceptando cambios de horario actualmente.',
        );
      }

      // Mismo horizonte que crearReserva, con "hoy" en la zona de la SEDE (E2-04).
      this.exigirHorizonteDeSede(dto.fecha, config.horizonteReservaDias, tz, 'agendar');

      // Los servicios están congelados en el snapshot: el bloque nuevo tiene que
      // seguir cubriendo lo que se pactó. Reprogramar NO cambia servicios.
      const serviciosCongelados = await tx.participanteServicio.findMany({
        where: { participante: { reservaId } },
        select: { duracionHistorica: true },
      });

      const duracionMinima = serviciosCongelados.reduce(
        (acc, s) => acc + s.duracionHistorica,
        0,
      );

      if (duracionSolicitada < duracionMinima) {
        throw new BadRequestException(
          `La duración solicitada (${duracionSolicitada} min) es insuficiente para los servicios de la reserva (mínimo ${duracionMinima} min)`,
        );
      }

      const margenFinal = actual.margenGrupalHistorico ?? config.margenGrupalMinutos ?? 10;

      const disponibilidades = await this.disponibilidadService.calcularDisponibilidad(
        {
          barberiaId,
          fecha,
          duracionTotal: duracionSolicitada,
          margenRequerido: margenFinal,
          excluirReservaId: actual.id,
        },
        tx,
      );

      // E2-04: el bloque nuevo se compone como instante en la zona de la sede.
      const inicioCita = this.tiempo.aInstante(dto.fecha, dto.horaInicio, tz);
      const finCita = this.tiempo.aInstante(dto.fecha, dto.horaFin, tz);
      const finConMargen = new Date(finCita.getTime() + margenFinal * 60000);

      const libre = disponibilidades.some(
        (slot) => inicioCita >= slot.inicio && finConMargen <= slot.fin,
      );

      if (!libre) {
        throw errorDeConflicto(
          'CONFLICTO_HORARIO',
          'El horario nuevo ya no está disponible: otra reserva o un bloqueo ocupa ese hueco.',
        );
      }

      const actualizada = await tx.reserva.update({
        where: { id: reservaId },
        data: { fechaCita: fecha, horaInicio: inicio, horaFin: fin },
      });

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: user.id,
          accion: 'RESERVA_REPROGRAMADA',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: {
            barberiaId,
            estadoAnterior: actual.estado,
            estadoNuevo: actual.estado,
            fechaAnterior: this.fechaISO(actual.fechaCita),
            horaAnterior: `${this.horaHHMM(actual.horaInicio)}-${this.horaHHMM(actual.horaFin)}`,
            fechaNueva: this.fechaISO(fecha),
            horaNueva: `${dto.horaInicio}-${dto.horaFin}`,
            origen: 'REPROGRAMACION',
          },
        },
        tx,
      );

      return actualizada;
    });

    if (this.notificacionService) {
      this.notificacionService
        .enviarNotificacion({
          usuarioId: reserva.clienteId,
          tipo: 'RESERVA_REPROGRAMADA',
          contenido: `Tu cita se movió al ${this.fechaISO(reserva.fechaCita)} a las ${this.horaHHMM(reserva.horaInicio)}.`,
        })
        .catch((err) =>
          this.logger.warn(`No se pudo notificar la reprogramación: ${err.message}`),
        );
    }

    return reserva;
  }

  /**
   * E3-05 · Cancelación manual: `→ CANCELADA`.
   *
   * La ruta la declaran los tres roles (`CLIENTE`, `ADMIN_BARBERIA`,
   * `ADMINISTRADOR`), pero el `RolesGuard` solo mira el ROL y el `barberiaId`
   * del parámetro: un CLIENTE de la sede pasaría el guard con la reserva de
   * OTRO cliente. La pertenencia se resuelve aquí, con el mismo criterio que
   * `obtenerDetalleReserva` usa para el detalle (HALLAZGO-14): si el solicitante
   * no es staff de la sede, la reserva tiene que ser suya.
   *
   * El estado destino es `CANCELADA` —el valor del dominio (§5.7) y el que ya
   * tratan como terminal `pago.service` y `notificacion.processor`—, no un
   * `CANCELADA_CLIENTE` nuevo que esos consumidores no reconocerían.
   *
   * Liberar el horario es consecuencia del propio cambio de estado: `CANCELADA`
   * no ocupa agenda (§5.3) y la disponibilidad se calcula, no se almacena.
   */
  async cancelarReserva(barberiaId: string, reservaId: string, user: UsuarioAutenticado) {
    const rolesEnBarberia =
      user.rolesDetallados?.filter((rol) => alcanceCumple(rol, barberiaId)) ?? [];

    if (rolesEnBarberia.length === 0) {
      throw new ForbiddenException('No tienes acceso a las reservas de esta barbería.');
    }

    const esStaff = rolesEnBarberia.some((rol) =>
      [ROL_ADMINISTRADOR, ROL_ADMIN_BARBERIA].includes(rol.nombre),
    );

    const reserva = await withSerializableTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "barberias" WHERE id = ${barberiaId}::uuid FOR UPDATE`;

      const actual = await tx.reserva.findFirst({ where: { id: reservaId, barberiaId } });

      if (!actual) {
        throw new NotFoundException('Reserva no encontrada');
      }

      const tz = await this.zonaDeSede(barberiaId, tx);

      if (!esStaff && actual.clienteId !== user.id) {
        throw errorDePermiso(
          'RESERVA_AJENA',
          'Solo puedes cancelar tus propias reservas.',
        );
      }

      // E2-02 §5.2: quién puede cancelar y desde qué estado lo decide la matriz.
      // La comprobación va ANTES de la ventana de §5.7: una reserva terminal no
      // es «fuera de ventana», es una transición inválida (409 ESTADO_INVALIDO).
      const actor: ActorTransicion = esStaff ? ACTORES.STAFF : ACTORES.CLIENTE;
      ReservaStateMachine.assertTransition(
        actual.estado as EstadoReserva,
        ESTADOS.CANCELADA,
        actor,
      );

      // E3-07 §5.7 · ventana del CLIENTE: una solicitud `PENDIENTE` se cancela
      // siempre; una cita ya agendada, solo hasta 30 minutos antes del inicio.
      // El staff no tiene ventana: la sede cancela por teléfono o mostrador
      // (E3-08 le añadirá el motivo obligatorio). La comprobación va dentro de la
      // transacción, con el lock de la sede tomado, para que el reloj que decide
      // sea el del instante de la escritura y no el de la petición.
      if (!esStaff && actual.estado !== ESTADOS.PENDIENTE) {
        this.exigirVentanaDeCancelacion(actual, tz);
      }

      const actualizada = await this.cambiarEstado(tx, actual, ESTADOS.CANCELADA, actor);

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: user.id,
          accion: 'RESERVA_CANCELADA',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: {
            barberiaId,
            estadoAnterior: actual.estado,
            estadoNuevo: ESTADOS.CANCELADA,
            canceladoPor: esStaff ? ACTORES.STAFF : ACTORES.CLIENTE,
          },
        },
        tx,
      );

      return actualizada;
    });

    // BullMQ no participa en la transacción: se cancela el job de expiración
    // después, best-effort. Si sobreviviera, el processor lo ignora porque la
    // reserva ya no está en `ESTADOS_EXPIRABLES`.
    await this.aplicarEfectosPostCommit(reservaId, ESTADOS.CANCELADA);

    if (this.notificacionService) {
      const destinatario = esStaff ? reserva.clienteId : user.id;
      const contenido = esStaff
        ? `Tu reserva del ${this.fechaISO(reserva.fechaCita)} a las ${this.horaHHMM(reserva.horaInicio)} fue cancelada por la sede.`
        : `Tu reserva del ${this.fechaISO(reserva.fechaCita)} a las ${this.horaHHMM(reserva.horaInicio)} quedó cancelada.`;

      this.notificacionService
        .enviarNotificacion({
          usuarioId: destinatario,
          tipo: 'RESERVA_CANCELADA',
          contenido,
        })
        .catch((err) =>
          this.logger.warn(`No se pudo notificar la cancelación: ${err.message}`),
        );
    }

    return reserva;
  }

  /**
   * E3-08/D17 · Cancelación especial: `→ CANCELADA` con motivo del catálogo §5.5.
   *
   * Es la salida de la sede para una cita que ya no cabe en la ventana de los
   * 30 minutos (§5.7). La resuelve directamente el staff de la sede, así que:
   *
   *  - exige que la sede tenga habilitada `permite_cancelacion_especial` (D17,
   *    por defecto FALSE): sin la bandera responde 422 y la reserva no se toca;
   *  - registra QUIÉN la ejecutó (`cancelado_por_id`) y con qué motivo, además
   *    de dejarlo en la auditoría;
   *  - libera el horario como consecuencia del estado `CANCELADA` (§5.3) y
   *    cancela el job de expiración fuera de la transacción, como el resto de
   *    transiciones (BullMQ no participa de la transacción).
   */
  async cancelacionEspecial(
    barberiaId: string,
    reservaId: string,
    dto: CancelacionEspecialDto,
    user: UsuarioAutenticado,
  ) {
    const motivo = this.validarMotivoCancelacionEspecial(dto);

    const reserva = await withSerializableTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "barberias" WHERE id = ${barberiaId}::uuid FOR UPDATE`;

      const actual = await tx.reserva.findFirst({ where: { id: reservaId, barberiaId } });

      if (!actual) {
        throw new NotFoundException('Reserva no encontrada');
      }

      const config = await tx.configuracionBarberia.findUnique({ where: { barberiaId } });

      if (!config?.permiteCancelacionEspecial) {
        throw reglaDeNegocio(
          'CANCELACION_ESPECIAL_NO_HABILITADA',
          'Esta barbería no acepta cancelaciones especiales.',
        );
      }

      // E2-02 §5.2 (fila 15): la cancelación especial es la vía de la sede para
      // pasar una CONFIRMADA a CANCELADA con motivo; desde cualquier otro estado
      // la matriz responde 409 ESTADO_INVALIDO.
      const actualizada = await this.cambiarEstado(
        tx,
        actual,
        ESTADOS.CANCELADA,
        ACTORES.STAFF,
        {
          canceladoPorId: user.id,
          cancelacionEspecialEstado: ESTADOS_CANCELACION_ESPECIAL.APROBADA,
          cancelacionEspecialMotivo: motivo.codigo,
          cancelacionEspecialDetalle: motivo.detalle,
        },
      );

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: user.id,
          accion: 'RESERVA_CANCELACION_ESPECIAL',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: {
            barberiaId,
            estadoAnterior: actual.estado,
            estadoNuevo: ESTADOS.CANCELADA,
            canceladoPor: ACTORES.STAFF,
            canceladoPorId: user.id,
            motivoCodigo: motivo.codigo,
            motivoDetalle: motivo.detalle,
          },
        },
        tx,
      );

      return actualizada;
    });

    await this.aplicarEfectosPostCommit(reservaId, ESTADOS.CANCELADA);

    if (this.notificacionService) {
      const razon =
        motivo.codigo === 'OTRO'
          ? motivo.detalle
          : TEXTO_MOTIVO_CANCELACION_ESPECIAL[motivo.codigo];

      this.notificacionService
        .enviarNotificacion({
          usuarioId: reserva.clienteId,
          tipo: 'RESERVA_CANCELADA',
          contenido: `Tu cita del ${this.fechaISO(reserva.fechaCita)} a las ${this.horaHHMM(reserva.horaInicio)} fue cancelada por la sede por ${razon}.`,
        })
        .catch((err) =>
          this.logger.warn(`No se pudo notificar la cancelación especial: ${err.message}`),
        );
    }

    return reserva;
  }

  /**
   * E3-08/D18 §5.4 · el CLIENTE dueño propone un bloque nuevo para su cita.
   *
   * Proponer NO mueve la cita ni ocupa el hueco: deja una propuesta `PENDIENTE`
   * con una ventana de 10 minutos para que el staff la resuelva. La ocupación
   * real ocurre al aceptarla, donde el bloque se revalida bajo el lock de la
   * sede (por eso aquí la validación es informativa y puede caducar).
   *
   * La ruta declara `@Roles('CLIENTE')`, pero el `RolesGuard` deja pasar al
   * ADMINISTRADOR por jerarquía; la pertenencia la resuelve el servicio: sin ser
   * el dueño de la reserva, responde 403 `RESERVA_AJENA`. Solo puede haber UNA
   * propuesta viva por reserva; una vencida ya no bloquea.
   */
  async proponerHorario(
    barberiaId: string,
    reservaId: string,
    dto: ReprogramarReservaDto,
    user: UsuarioAutenticado,
  ) {
    return withSerializableTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "barberias" WHERE id = ${barberiaId}::uuid FOR UPDATE`;

      const actual = await tx.reserva.findFirst({ where: { id: reservaId, barberiaId } });

      if (!actual) {
        throw new NotFoundException('Reserva no encontrada');
      }

      if (actual.clienteId !== user.id) {
        throw errorDePermiso(
          'RESERVA_AJENA',
          'Solo puedes proponer un horario para tus propias reservas.',
        );
      }

      if (
        !ESTADOS_REPROGRAMABLES.includes(
          actual.estado as (typeof ESTADOS_REPROGRAMABLES)[number],
        )
      ) {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          `Solo se puede proponer un horario para una reserva vigente (estado actual: ${actual.estado}).`,
        );
      }

      const viva = await tx.propuestaHorario.findFirst({
        where: {
          reservaId,
          estado: ESTADOS_PROPUESTA.PENDIENTE,
          expiraAt: { gt: this.tiempo.ahora() },
        },
      });

      if (viva) {
        throw errorDeConflicto(
          'PROPUESTA_PENDIENTE',
          'Ya tienes una propuesta de horario esperando respuesta.',
        );
      }

      const bloque = await this.validarBloqueNuevo(tx, barberiaId, actual, dto);
      const expiraAt = new Date(
        this.tiempo.ahora().getTime() + VENTANA_PROPUESTA_HORARIO_MIN * 60000,
      );

      const creada = await tx.propuestaHorario.create({
        data: {
          reservaId,
          fechaCita: bloque.fecha,
          horaInicio: bloque.inicio,
          horaFin: bloque.fin,
          tipo: TIPOS_PROPUESTA.REPROGRAMACION,
          estado: ESTADOS_PROPUESTA.PENDIENTE,
          expiraAt,
          creadoPor: user.id,
        },
      });

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: user.id,
          accion: 'RESERVA_PROPUESTA_HORARIO',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: {
            barberiaId,
            propuestaId: creada.id,
            fechaAnterior: this.fechaISO(actual.fechaCita),
            horaAnterior: `${this.horaHHMM(actual.horaInicio)}-${this.horaHHMM(actual.horaFin)}`,
            fechaPropuesta: this.fechaISO(bloque.fecha),
            horaPropuesta: `${dto.horaInicio}-${dto.horaFin}`,
            expiraAt: expiraAt.toISOString(),
          },
        },
        tx,
      );

      return creada;
    });
  }

  /**
   * E3-08/D18 · la sede acepta la propuesta de horario: mueve la cita y marca la
   * propuesta `ACEPTADA`, todo bajo el lock de la sede.
   *
   * El bloque se REVALIDA aquí: entre proponer y aceptar pueden pasar hasta 10
   * minutos y el hueco pudo ocuparse. Si ya no está libre, 409 `CONFLICTO_HORARIO`
   * y la cita no se mueve. Si la ventana venció, 409 `PROPUESTA_EXPIRADA`.
   */
  async aceptarPropuestaHorario(
    barberiaId: string,
    reservaId: string,
    user: UsuarioAutenticado,
  ) {
    const reserva = await withSerializableTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "barberias" WHERE id = ${barberiaId}::uuid FOR UPDATE`;

      const actual = await tx.reserva.findFirst({ where: { id: reservaId, barberiaId } });

      if (!actual) {
        throw new NotFoundException('Reserva no encontrada');
      }

      if (
        !ESTADOS_REPROGRAMABLES.includes(
          actual.estado as (typeof ESTADOS_REPROGRAMABLES)[number],
        )
      ) {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          `Solo se puede aceptar una propuesta de una reserva vigente (estado actual: ${actual.estado}).`,
        );
      }

      const propuesta = await tx.propuestaHorario.findFirst({
        where: { reservaId, estado: ESTADOS_PROPUESTA.PENDIENTE },
        orderBy: { creadoAt: 'desc' },
      });

      if (!propuesta) {
        throw errorDeConflicto(
          'SIN_PROPUESTA',
          'No hay ninguna propuesta de horario esperando respuesta.',
        );
      }

      if (propuesta.expiraAt && propuesta.expiraAt.getTime() <= this.tiempo.ahora().getTime()) {
        await tx.propuestaHorario.update({
          where: { id: propuesta.id },
          data: { estado: ESTADOS_PROPUESTA.EXPIRADA },
        });

        throw errorDeConflicto(
          'PROPUESTA_EXPIRADA',
          'La propuesta de horario venció: el cliente debe proponer un horario nuevo.',
        );
      }

      const bloque = await this.validarBloqueNuevo(tx, barberiaId, actual, {
        fecha: this.fechaISO(propuesta.fechaCita),
        horaInicio: this.horaHHMM(propuesta.horaInicio),
        horaFin: this.horaHHMM(propuesta.horaFin),
      });

      const actualizada = await tx.reserva.update({
        where: { id: reservaId },
        data: {
          fechaCita: bloque.fecha,
          horaInicio: bloque.inicio,
          horaFin: bloque.fin,
        },
      });

      await tx.propuestaHorario.update({
        where: { id: propuesta.id },
        data: { estado: ESTADOS_PROPUESTA.ACEPTADA },
      });

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: user.id,
          accion: 'RESERVA_REPROGRAMADA',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: {
            barberiaId,
            propuestaId: propuesta.id,
            origen: 'PROPUESTA_HORARIO',
            estadoAnterior: actual.estado,
            estadoNuevo: actual.estado,
            fechaAnterior: this.fechaISO(actual.fechaCita),
            horaAnterior: `${this.horaHHMM(actual.horaInicio)}-${this.horaHHMM(actual.horaFin)}`,
            fechaNueva: this.fechaISO(bloque.fecha),
            horaNueva: `${this.horaHHMM(bloque.inicio)}-${this.horaHHMM(bloque.fin)}`,
          },
        },
        tx,
      );

      return actualizada;
    });

    if (this.notificacionService) {
      this.notificacionService
        .enviarNotificacion({
          usuarioId: reserva.clienteId,
          tipo: 'RESERVA_REPROGRAMADA',
          contenido: `Tu propuesta fue aceptada: la cita quedó el ${this.fechaISO(reserva.fechaCita)} a las ${this.horaHHMM(reserva.horaInicio)}.`,
        })
        .catch((err) =>
          this.logger.warn(`No se pudo notificar la propuesta aceptada: ${err.message}`),
        );
    }

    return reserva;
  }

  /**
   * E3-08/D18 · la sede rechaza la propuesta de horario. No mueve la cita ni
   * cambia el estado de la reserva: solo cierra la propuesta.
   */
  async rechazarPropuestaHorario(
    barberiaId: string,
    reservaId: string,
    user: UsuarioAutenticado,
  ) {
    return withSerializableTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "barberias" WHERE id = ${barberiaId}::uuid FOR UPDATE`;

      const actual = await tx.reserva.findFirst({ where: { id: reservaId, barberiaId } });

      if (!actual) {
        throw new NotFoundException('Reserva no encontrada');
      }

      const propuesta = await tx.propuestaHorario.findFirst({
        where: { reservaId, estado: ESTADOS_PROPUESTA.PENDIENTE },
        orderBy: { creadoAt: 'desc' },
      });

      if (!propuesta) {
        throw errorDeConflicto(
          'SIN_PROPUESTA',
          'No hay ninguna propuesta de horario esperando respuesta.',
        );
      }

      const rechazada = await tx.propuestaHorario.update({
        where: { id: propuesta.id },
        data: { estado: ESTADOS_PROPUESTA.RECHAZADA },
      });

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: user.id,
          accion: 'RESERVA_PROPUESTA_RECHAZADA',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: {
            barberiaId,
            propuestaId: propuesta.id,
            estadoPropuesta: ESTADOS_PROPUESTA.RECHAZADA,
          },
        },
        tx,
      );

      return rechazada;
    });
  }

  /**
   * E2-02 §5.2 · ÚNICO punto de escritura de `reservas.estado`.
   *
   * Toda transición —la del cliente, la de la sede y la del sistema— pasa por
   * aquí: la máquina comprueba que el grafo la permite para ese actor (409
   * `ESTADO_INVALIDO` si no) y el hook `onEnter` aplica los efectos que §5.2
   * asocia al estado nuevo. El `data` extra va en la MISMA escritura, para que
   * estado y motivo no puedan quedar desacoplados.
   *
   * El endpoint genérico `PATCH :id/estado` se eliminó en E2-02: los flujos de
   * E3-03 a E3-08 son los únicos caminos, cada uno con sus condiciones (ventana
   * de 30 minutos, motivo obligatorio, bandera D17, revalidación del hueco).
   */
  private async cambiarEstado(
    tx: Prisma.TransactionClient,
    reserva: { id: string; estado: string },
    hacia: EstadoReserva,
    actor: ActorTransicion,
    datos: Prisma.ReservaUncheckedUpdateInput = {},
  ) {
    ReservaStateMachine.assertTransition(reserva.estado as EstadoReserva, hacia, actor);

    const actualizada = await tx.reserva.update({
      where: { id: reserva.id },
      data: { ...datos, estado: hacia },
    });

    await ReservaStateMachine.onEnter(hacia, {
      reservaId: reserva.id,
      ejecutores: this.ejecutoresDeEfectos(),
    });

    return actualizada;
  }

  /**
   * E2-02 §5.2 · efectos POSTERIORES a la transacción del hook `onEnter`.
   * Existen aparte porque BullMQ no participa de la transacción de Postgres: si
   * se cancelara el job dentro, un rollback dejaría la reserva sin temporizador.
   */
  private async aplicarEfectosPostCommit(
    reservaId: string,
    hacia: EstadoReserva,
  ): Promise<void> {
    await ReservaStateMachine.despuesDeConfirmar(hacia, {
      reservaId,
      ejecutores: this.ejecutoresDeEfectos(),
    });
  }

  /** Implementación de los efectos declarados por la máquina (E2-02). */
  private ejecutoresDeEfectos(): EjecutoresDeEfectos {
    return {
      limpiarInformacionAdicional: async (reservaId: string) => {
        // H32: la columna `informacion_adicional` no existe todavía — llega con
        // la reserva grupal/información adicional (E4-01/E4-05). El hueco queda
        // cableado para que ese día haya UN solo sitio que lo decida.
        this.logger.log(
          `Efecto de entrada: la reserva ${reservaId} no tiene información adicional que borrar (H32).`,
        );
      },
      cancelarJobs: async (reservaId: string) => {
        await this.cancelarJobExpiracion(reservaId);
      },
    };
  }
}
