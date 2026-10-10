import { Injectable, NotFoundException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { CreateBloqueoDto } from './dto/create-bloqueo.dto.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { validateTimeRange } from '../../horario/domain/time.utils.js';
import { esAdministradorGlobalPorId } from '../../iam/domain/roles.js';
import { TiempoService } from '../../shared/time/tiempo.service.js';

@Injectable()
export class AgendaService {
  private readonly logger = new Logger(AgendaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('agenda-bloqueos') private readonly bloqueosQueue: Queue,
    // E2-04: la fecha de un bloqueo es una etiqueta `DATE`; se construye por el
    // servicio central de tiempo.
    @Optional() private readonly tiempo: TiempoService = new TiempoService(),
  ) {}

  private async validateAccess(usuarioId: string, barberiaId: string) {
    const barberia = await this.prisma.barberia.findUnique({
      where: { id: barberiaId },
      select: { responsableId: true },
    });

    if (!barberia) {
      throw new NotFoundException('Barbería no encontrada');
    }

    const rolesUser = await this.prisma.usuarioRol.findMany({
      where: { usuarioId, barberiaId },
      include: { rol: true },
    });

    const isResponsable = barberia.responsableId === usuarioId;
    // E1-04: antes buscaba un rol inexistente, así que el
    // ADMINISTRADOR real pasaba el guard y aquí le devolvían 403.
    const esGlobal = await esAdministradorGlobalPorId(this.prisma, usuarioId);

    if (!isResponsable && !esGlobal && !rolesUser.some((ur) => ur.rol.nombre === 'ADMIN_BARBERIA')) {
      throw new ForbiddenException('No tienes permisos para gestionar la agenda de esta barbería');
    }
  }

  async crearBloqueo(usuarioId: string, barberiaId: string, dto: CreateBloqueoDto) {
    await this.validateAccess(usuarioId, barberiaId);

    const { inicio, fin } = validateTimeRange(dto.horaInicio, dto.horaFin);
    const fecha = this.tiempo.fechaDeCalendario(dto.fecha);

    // TODO: Comprobar solapamiento con reservas existentes

    return this.prisma.$transaction(async (tx) => {
      const bloqueo = await tx.bloqueosAgenda.create({
        data: {
          barberiaId,
          fecha,
          horaInicio: inicio,
          horaFin: fin,
          motivo: dto.motivo,
          creadoPor: usuarioId,
        },
      });

      if (dto.liberacionAutomaticaMinutos) {
        // Encolar job en BullMQ para liberar el bloqueo tras X minutos
        const job = await this.bloqueosQueue.add(
          'liberar-bloqueo',
          { bloqueoId: bloqueo.id },
          { delay: dto.liberacionAutomaticaMinutos * 60 * 1000 },
        );

        // Actualizar bloqueo con jobId
        await tx.bloqueosAgenda.update({
          where: { id: bloqueo.id },
          data: { jobId: job.id },
        });

        this.logger.log(`Bloqueo ${bloqueo.id} programado para liberación en ${dto.liberacionAutomaticaMinutos} mins (Job: ${job.id})`);
      }

      return bloqueo;
    });
  }

  async eliminarBloqueo(usuarioId: string, barberiaId: string, bloqueoId: string) {
    await this.validateAccess(usuarioId, barberiaId);

    const bloqueo = await this.prisma.bloqueosAgenda.findUnique({
      where: { id: bloqueoId, barberiaId },
    });

    if (!bloqueo) {
      throw new NotFoundException('Bloqueo no encontrado');
    }

    if (bloqueo.jobId) {
      // Cancelar el job pendiente en BullMQ si existe
      try {
        const job = await this.bloqueosQueue.getJob(bloqueo.jobId);
        if (job && await job.isActive() === false && await job.isCompleted() === false) {
           await job.remove();
        }
      } catch {
        this.logger.warn(`No se pudo eliminar el job ${bloqueo.jobId} en BullMQ`);
      }
    }

    await this.prisma.bloqueosAgenda.delete({
      where: { id: bloqueoId },
    });

    return { success: true, message: 'Bloqueo eliminado correctamente' };
  }

  /**
   * Lista los bloqueos de una barbería en un rango de fechas (E1-03 · H20).
   *
   * Valida el acceso ANTES de leer: sin esta llamada, cualquier usuario con
   * sesión obtenía los bloqueos y el `motivo` de cualquier barbería.
   */
  async obtenerBloqueos(usuarioId: string, barberiaId: string, fromDate: Date, toDate: Date) {
    await this.validateAccess(usuarioId, barberiaId);

    return this.prisma.bloqueosAgenda.findMany({
      where: {
        barberiaId,
        fecha: { gte: fromDate, lte: toDate },
      },
      orderBy: { fecha: 'asc' },
    });
  }
}
