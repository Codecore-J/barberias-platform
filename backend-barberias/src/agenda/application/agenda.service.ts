import { Injectable, NotFoundException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { CreateBloqueoDto } from './dto/create-bloqueo.dto.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { validateTimeRange } from '../../horario/domain/time.utils.js';
import { esAdministradorGlobalPorId } from '../../iam/domain/roles.js';
import { TiempoService } from '../../shared/time/tiempo.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { fechaCalendarioISO, horaRelojHHMM } from '../../shared/time/tiempo.service.js';

@Injectable()
export class AgendaService {
  private readonly logger = new Logger(AgendaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('agenda-bloqueos') private readonly bloqueosQueue: Queue,
    // E2-04: la fecha de un bloqueo es una etiqueta `DATE`; se construye por el
    // servicio central de tiempo.
    @Optional() private readonly tiempo: TiempoService = new TiempoService(),
    // E2-07 · D29: liberar un bloqueo es una operación auditable (como toda
    // escritura de agenda), así que el servicio entra en la transacción.
    @Optional() private readonly auditoria?: AuditoriaService,
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

  /**
   * E2-07 · D29: un bloqueo no se BORRA, se LIBERA.
   *
   * Spec 01 §9 prohíbe la eliminación física para representar un cambio de
   * estado, y `DELETE` borraba la fila: el hueco volvía a estar disponible, pero
   * con él se perdía la prueba de que había estado bloqueado y de quién lo
   * retiró. Ahora se fija `liberado_at` (la disponibilidad ignora los
   * liberados y el histórico se conserva), se cancela el job de liberación
   * automática y se audita el cambio en la MISMA transacción que la escritura.
   *
   * Idempotente: liberar dos veces devuelve el mismo estado sin reescribir ni
   * auditar de nuevo, porque `liberado_at` ya está fijado.
   */
  async liberarBloqueo(usuarioId: string, barberiaId: string, bloqueoId: string) {
    await this.validateAccess(usuarioId, barberiaId);

    const bloqueo = await this.prisma.bloqueosAgenda.findUnique({
      where: { id: bloqueoId, barberiaId },
    });

    if (!bloqueo) {
      throw new NotFoundException('Bloqueo no encontrado');
    }

    if (bloqueo.liberadoAt) {
      this.logger.log(`Bloqueo ${bloqueoId} ya estaba liberado; no se vuelve a escribir.`);
      return { success: true, message: 'El bloqueo ya estaba liberado', liberadoAt: bloqueo.liberadoAt };
    }

    if (bloqueo.jobId) {
      // El job de liberación automática deja de tener sentido: se cancela.
      try {
        const job = await this.bloqueosQueue.getJob(bloqueo.jobId);
        if (job && await job.isActive() === false && await job.isCompleted() === false) {
           await job.remove();
        }
      } catch {
        this.logger.warn(`No se pudo cancelar el job ${bloqueo.jobId} en BullMQ`);
      }
    }

    const liberadoAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.bloqueosAgenda.update({
        where: { id: bloqueoId },
        data: { liberadoAt, jobId: null },
      });

      await this.auditoria?.registrarEvento(
        {
          usuarioId,
          accion: 'BLOQUEO_LIBERADO',
          entidad: 'bloqueos_agenda',
          entidadId: bloqueo.id,
          contexto: {
            barberiaId,
            fecha: fechaCalendarioISO(bloqueo.fecha),
            horaInicio: horaRelojHHMM(bloqueo.horaInicio),
            horaFin: horaRelojHHMM(bloqueo.horaFin),
            anterior: { liberadoAt: null, jobId: bloqueo.jobId ?? null },
            nuevo: { liberadoAt: liberadoAt.toISOString(), jobId: null },
          },
        },
        tx,
      );
    });

    return { success: true, message: 'Bloqueo liberado correctamente', liberadoAt };
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
