import { Injectable, BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { CreateReservaDto } from './dto/create-reserva.dto.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { validateTimeRange } from '../../horario/domain/time.utils.js';
import { DisponibilidadService } from '../../agenda/application/disponibilidad.service.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class ReservaService {
  private readonly logger = new Logger(ReservaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly disponibilidadService: DisponibilidadService,
    @InjectQueue('reservas-pendientes') private readonly reservasQueue: Queue,
    @Optional() private readonly notificacionService?: NotificacionService,
  ) {}

  async crearReserva(clienteId: string, barberiaId: string, dto: CreateReservaDto) {
    const { inicio, fin } = validateTimeRange(dto.horaInicio, dto.horaFin);
    const fecha = new Date(dto.fecha);

    const duracionSolicitada = (fin.getTime() - inicio.getTime()) / 60000;

    return withSerializableTransaction(this.prisma, async (tx) => {
      // Bloqueo pesimista sobre la barbería (row-level lock) para evitar Race Conditions
      await tx.$queryRaw`SELECT id FROM "barberias" WHERE id = ${barberiaId}::uuid FOR UPDATE`;
      
      // 0. Validar que el cliente no esté restringido en esta barbería (T5.4)
      const vinculo = await tx.clienteBarberia.findUnique({
        where: {
          uk_cliente_barberia: {
            usuarioId: clienteId,
            barberiaId,
          },
        },
      });

      if (vinculo?.estaRestringido) {
        throw new ForbiddenException(`Usuario restringido en esta barbería: ${vinculo.motivoRestriccion ?? 'Superó el límite de inasistencias'}`);
      }

      const config = await tx.configuracionBarberia.findUnique({
        where: { barberiaId },
      });

      if (!config) {
        throw new NotFoundException('Configuración de barbería no encontrada');
      }

      if (!config.nuevasReservasActivas) {
        throw new BadRequestException('La barbería no está aceptando nuevas reservas actualmente');
      }

      if (!config.aceptaIndividual) {
        throw new BadRequestException('La barbería no acepta reservas de tipo individual');
      }

      // 1. Obtener y validar servicios del catálogo (T6.2 Snapshot Histórico Inmutable)
      const serviciosCatalogo = await tx.servicio.findMany({
        where: {
          id: { in: dto.serviciosIds },
          barberiaId,
          estado: 'ACTIVO',
        },
      });

      if (serviciosCatalogo.length !== dto.serviciosIds.length) {
        throw new BadRequestException(
          'Uno o más servicios seleccionados no existen, no pertenecen a esta barbería o están inactivos',
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
        await this.reservasQueue.add('expirar-reserva', { reservaId: reserva.id }, { delay: 10 * 60000 });
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
      (r) => r.barberiaId === barberiaId || r.ambito === 'GLOBAL'
    ) || [];

    if (rolesEnBarberia.length === 0) {
      throw new ForbiddenException('No tienes acceso a las reservas de esta barbería.');
    }

    const isAdminOrBarbero = rolesEnBarberia.some(r => 
      r.nombre === 'ADMINISTRADOR' || r.nombre === 'SUPER_ADMIN' || r.nombre === 'ADMIN_BARBERIA' || r.nombre === 'BARBERO'
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
      const isSuperAdmin = await this.prisma.usuarioRol.findFirst({
        where: { usuarioId: solicitanteId, rol: { nombre: { in: ['SUPER_ADMIN', 'ADMINISTRADOR'] } } },
      });
      const rolesUser = await this.prisma.usuarioRol.findMany({
        where: { usuarioId: solicitanteId, barberiaId },
        include: { rol: true },
      });

      if (!isResponsable && !isSuperAdmin && !rolesUser.some((ur) => ur.rol.nombre === 'ADMIN_BARBERIA' || ur.rol.nombre === 'BARBERO')) {
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
      (r) => r.barberiaId === barberiaId || r.ambito === 'GLOBAL'
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
