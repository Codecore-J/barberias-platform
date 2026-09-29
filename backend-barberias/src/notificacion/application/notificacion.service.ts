import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EnviarNotificacionDto } from './dto/enviar-notificacion.dto.js';

export interface ProgramarRecordatorioPayload {
  usuarioId: string;
  reservaId: string;
  fechaCita: Date;
  horaInicio: Date;
  nombreBarberia: string;
}

@Injectable()
export class NotificacionService {
  private readonly logger = new Logger(NotificacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('notificaciones') private readonly notificacionesQueue: Queue,
  ) {}

  /**
   * Encola una notificación asíncrona inmediata en BullMQ (T8.1).
   */
  async enviarNotificacion(dto: EnviarNotificacionDto) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: dto.usuarioId },
      select: { id: true, correo: true },
    });

    if (!usuario) {
      throw new NotFoundException(`Usuario destinatario con ID ${dto.usuarioId} no encontrado`);
    }

    const notificacion = await this.prisma.notificacion.create({
      data: {
        usuarioId: dto.usuarioId,
        canal: dto.canal ?? 'EMAIL',
        tipo: dto.tipo,
        contenido: dto.contenido,
        estado: 'PENDIENTE',
      },
    });

    await this.notificacionesQueue.add(
      'enviar-notificacion',
      {
        notificacionId: notificacion.id,
        usuarioId: dto.usuarioId,
        correo: usuario.correo,
        canal: dto.canal ?? 'EMAIL',
        tipo: dto.tipo,
        contenido: dto.contenido,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    this.logger.log(`Notificación ${notificacion.id} (${dto.tipo}) encolada para usuario ${dto.usuarioId}`);
    return notificacion;
  }

  /**
   * Programa un recordatorio automático con BullMQ 1 hora antes de la cita (T8.1).
   */
  async programarRecordatorio(payload: ProgramarRecordatorioPayload) {
    const citaDateTime = new Date(payload.fechaCita);
    citaDateTime.setHours(
      payload.horaInicio.getUTCHours(),
      payload.horaInicio.getUTCMinutes(),
      0,
      0,
    );

    // 1 hora antes de la cita
    const recordatorioTime = new Date(citaDateTime.getTime() - 60 * 60 * 1000);
    const delay = Math.max(0, recordatorioTime.getTime() - Date.now());

    const job = await this.notificacionesQueue.add(
      'recordatorio-cita',
      {
        usuarioId: payload.usuarioId,
        reservaId: payload.reservaId,
        nombreBarberia: payload.nombreBarberia,
        fechaHoraCita: citaDateTime.toISOString(),
      },
      {
        delay,
        attempts: 3,
      },
    );

    this.logger.log(
      `Recordatorio de cita para reserva ${payload.reservaId} programado con delay de ${Math.round(
        delay / 1000,
      )}s (Job: ${job.id})`,
    );

    return job;
  }

  /**
   * Consulta las notificaciones recibidas por un usuario.
   */
  async listarNotificacionesUsuario(usuarioId: string) {
    return this.prisma.notificacion.findMany({
      where: { usuarioId },
      orderBy: { enviadoAt: 'desc' },
    });
  }
}
