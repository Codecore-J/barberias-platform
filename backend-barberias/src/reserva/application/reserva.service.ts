import { Injectable, BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { errorDeConflicto, errorDePermiso, errorDeSolicitud, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import { CreateReservaDto } from './dto/create-reserva.dto.js';
import {
  LONGITUD_MINIMA_DETALLE,
  MOTIVOS_RECHAZO,
  RechazarReservaDto,
  type MotivoRechazo,
} from './dto/rechazar-reserva.dto.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { CotizacionResponse, BloqueCalculado } from './dto/cotizacion.dto.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { validateTimeRange } from '../../horario/domain/time.utils.js';
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

  /** Nombre real del job que consume `ReservaProcessor` (literal de BullMQ). */
  private static readonly JOB_EXPIRAR_RESERVA = 'expirar-reserva';

  constructor(
    private readonly prisma: PrismaService,
    private readonly disponibilidadService: DisponibilidadService,
    @InjectQueue('reservas-pendientes') private readonly reservasQueue: Queue,
    private readonly auditoriaService: AuditoriaService,
    @Optional() private readonly notificacionService?: NotificacionService,
  ) {}

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

    const [hFin] = dto.horaFin.split(':').map(Number);
    const horaFin = new Date(dto.fecha + 'T' + String(hFin).padStart(2, '0') + ':00:00');

    return {
      barberiaId,
      fecha: dto.fecha,
      horaFin: horaFin.toISOString().slice(11, 16),
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
    const fecha = new Date(dto.fecha);

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
      // horizonte_reserva_dias". Se compara por día de calendario (YYYY-MM-DD)
      // para no depender de la zona horaria del servidor.
      if (config.horizonteReservaDias != null) {
        const hoy = new Date();
        const limite = new Date(
          hoy.getFullYear(),
          hoy.getMonth(),
          hoy.getDate() + config.horizonteReservaDias,
        );
        const limiteStr = `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, '0')}-${String(limite.getDate()).padStart(2, '0')}`;

        if (String(dto.fecha).slice(0, 10) > limiteStr) {
          throw reglaDeNegocio(
            'FUERA_DE_HORIZONTE',
            `Solo se puede reservar hasta ${config.horizonteReservaDias} días de antelación.`,
          );
        }
      }

      // Límite de reservas pendientes de la SEDE: mientras la barbería acumule
      // max_pendientes sin resolver (PENDIENTE o PROPUESTA_PENDIENTE) no admite
      // más, sea de quien sea la solicitud.
      if (config.maxPendientes != null) {
        const pendientes = await tx.reserva.count({
          where: { barberiaId, estado: { in: ['PENDIENTE', 'PROPUESTA_PENDIENTE'] } },
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

      // Reconciliamos la fecha de la cita con las horas para comparar exactamente con los slots
      const [hInicio, mInicio] = dto.horaInicio.split(':').map(Number);
      const [hFin, mFin] = dto.horaFin.split(':').map(Number);

      const inicioCita = new Date(fecha);
      inicioCita.setHours(hInicio, mInicio, 0, 0);

      const finCita = new Date(fecha);
      finCita.setHours(hFin, mFin, 0, 0);

      const finConMargen = new Date(finCita.getTime() + margenFinal * 60000);

      const isAvailable = disponibilidades.some(slot =>
        inicioCita >= slot.inicio && finConMargen <= slot.fin
      );

      if (!isAvailable) {
        throw new ConflictException('El horario seleccionado ya no está disponible o se solapa con un bloqueo/reserva');
      }

      const expiraAt = config.modoReserva === 'MANUAL' ? new Date(Date.now() + 10 * 60000) : null;

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
          estado: config.modoReserva === 'AUTOMATICA' ? 'CONFIRMADA' : 'PENDIENTE',
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
          ReservaService.JOB_EXPIRAR_RESERVA,
          { reservaId: reserva.id },
          { delay: 10 * 60000, jobId: this.jobIdDeExpiracion(reserva.id) },
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

    return withSerializableTransaction(this.prisma, async (tx) => {
      const reserva = await tx.reserva.findUnique({
        where: { id: reservaId, barberiaId },
      });

      if (!reserva) {
        throw new NotFoundException('Reserva no encontrada');
      }

      if (reserva.estado === 'NO_ASISTIO') {
        throw new BadRequestException('La reserva ya está marcada como inasistencia');
      }

      // Marcar la reserva
      await tx.reserva.update({
        where: { id: reservaId },
        data: { estado: 'NO_ASISTIO' },
      });

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
  }

  async obtenerAgendaDiaria(barberiaId: string, fechaStr: string, user: UsuarioAutenticado) {
    if (!barberiaId) {
      throw new BadRequestException('ID de barbería es requerido');
    }

    const rolesEnBarberia = user.rolesDetallados?.filter(
      (r) => alcanceCumple(r, barberiaId)
    ) || [];

    if (rolesEnBarberia.length === 0) {
      throw new ForbiddenException('No tienes acceso a la agenda de esta barbería.');
    }

    const startOfDay = new Date(`${fechaStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${fechaStr}T23:59:59.999Z`);

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
      const fechaPart = r.fechaCita instanceof Date ? r.fechaCita.toISOString().split('T')[0] : fechaStr;
      const horaPart = r.horaInicio instanceof Date
        ? r.horaInicio.toISOString().split('T')[1].substring(0, 5)
        : '00:00';

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
      const fechaPart = r.fechaCita instanceof Date ? r.fechaCita.toISOString().split('T')[0] : '';
      const horaPart = r.horaInicio instanceof Date
        ? r.horaInicio.toISOString().split('T')[1].substring(0, 5)
        : '00:00';

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

      if (actual.estado !== 'PENDIENTE') {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          `Solo se puede aceptar una solicitud en estado PENDIENTE (estado actual: ${actual.estado}).`,
        );
      }

      if (actual.expiraAt && actual.expiraAt.getTime() <= Date.now()) {
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
          fecha: new Date(actual.fechaCita),
          duracionTotal,
          margenRequerido: margenFinal,
          // La reserva sigue PENDIENTE mientras se revalida: sin excluirla se
          // bloquearía a sí misma y ningún aceptar legítimo cabría.
          excluirReservaId: actual.id,
        },
        tx,
      );

      const fechaCita = new Date(actual.fechaCita);
      const inicioCita = new Date(fechaCita);
      inicioCita.setHours(actual.horaInicio.getUTCHours(), actual.horaInicio.getUTCMinutes(), 0, 0);
      const finCita = new Date(fechaCita);
      finCita.setHours(actual.horaFin.getUTCHours(), actual.horaFin.getUTCMinutes(), 0, 0);
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

      const actualizada = await tx.reserva.update({
        where: { id: reservaId },
        data: { estado: 'CONFIRMADA' },
      });

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: user.id,
          accion: 'RESERVA_CONFIRMADA',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: { barberiaId, estadoAnterior: 'PENDIENTE', estadoNuevo: 'CONFIRMADA' },
        },
        tx,
      );

      return actualizada;
    });

    // El job de expiración se cancela fuera de la transacción: BullMQ no
    // participa en ella. El processor solo expira reservas en PENDIENTE, así
    // que si la cancelación fallara la reserva ya CONFIRMADA seguiría a salvo.
    await this.cancelarJobExpiracion(reservaId);

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

      if (actual.estado !== 'PENDIENTE') {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          `Solo se puede rechazar una solicitud en estado PENDIENTE (estado actual: ${actual.estado}).`,
        );
      }

      const actualizada = await tx.reserva.update({
        where: { id: reservaId },
        data: {
          estado: 'RECHAZADA',
          motivoCodigo: motivo.codigo,
          motivoDetalle: motivo.detalle,
        },
      });

      await this.auditoriaService.registrarEvento(
        {
          usuarioId: user.id,
          accion: 'RESERVA_RECHAZADA',
          entidad: 'Reserva',
          entidadId: reservaId,
          contexto: {
            barberiaId,
            estadoAnterior: 'PENDIENTE',
            estadoNuevo: 'RECHAZADA',
            motivoCodigo: motivo.codigo,
            motivoDetalle: motivo.detalle,
          },
        },
        tx,
      );

      return actualizada;
    });

    await this.cancelarJobExpiracion(reservaId);

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
   * `estado === 'PENDIENTE'` antes de expirar, así que un job que sobreviva no
   * puede mover una reserva que ya dejó de estar pendiente.
   */
  private async cancelarJobExpiracion(reservaId: string): Promise<void> {
    const jobId = this.jobIdDeExpiracion(reservaId);

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
   * El `jobId` es determinista para poder cancelarlo después. Se lee del mismo
   * literal que usa el processor (`'expirar-reserva'`), no de
   * `queue.constants.ts`, cuyas constantes (`QUEUES.RESERVAS =
   * 'queue:reservas'`, `JOBS.EXPIRAR_RESERVA = 'job:expirar-reserva'`) no
   * coinciden con la cola real `'reservas-pendientes'` ni con el nombre real
   * del job. Ver HALLAZGO-E304-01 en el reporte.
   */
  private jobIdDeExpiracion(reservaId: string): string {
    // Sin `:` a propósito: BullMQ reserva ese carácter para separar las claves
    // de Redis y rechaza cualquier `jobId` propio que lo contenga
    // ("Custom Id cannot contain :").
    return `expirar-reserva-${reservaId}`;
  }

  private fechaISO(fecha: Date): string {
    return new Date(fecha).toISOString().slice(0, 10);
  }

  private horaHHMM(hora: Date): string {
    return `${String(hora.getUTCHours()).padStart(2, '0')}:${String(hora.getUTCMinutes()).padStart(2, '0')}`;
  }

  async cambiarEstado(barberiaId: string, reservaId: string, nuevoEstado: string, user: UsuarioAutenticado) {
    const reserva = await this.prisma.reserva.findUnique({
      where: { id: reservaId },
    });

    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }

    const bId = barberiaId || reserva.barberiaId;

    if (nuevoEstado === 'NO_ASISTIO') {
      return this.marcarInasistencia(bId, reservaId, user.id);
    }

    const updated = await this.prisma.reserva.update({
      where: { id: reservaId },
      data: { estado: nuevoEstado },
    });

    return updated;
  }
}
