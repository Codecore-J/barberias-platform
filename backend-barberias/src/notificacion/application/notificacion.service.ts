import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EnviarNotificacionDto } from './dto/enviar-notificacion.dto.js';
import {
  TiempoService,
  ZONA_POR_DEFECTO,
  fechaCalendarioISO,
  horaRelojHHMM,
} from '../../shared/time/tiempo.service.js';

export interface ProgramarRecordatorioPayload {
  usuarioId: string;
  reservaId: string;
  fechaCita: Date;
  horaInicio: Date;
  nombreBarberia: string;
  /** E2-04: zona de la sede para recomponer el instante real de la cita. */
  zonaHoraria?: string;
}

@Injectable()
export class NotificacionService {
  private readonly logger = new Logger(NotificacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('notificaciones') private readonly notificacionesQueue: Queue,
    @Optional() private readonly tiempo: TiempoService = new TiempoService(),
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
    // E2-04/H36: el instante real de la cita se compone con la zona de la SEDE.
    // Antes `new Date(fechaCita); setHours(...)` usaba la zona del servidor, y en
    // Render (UTC) el recordatorio habría saltado 4 h antes para una sede en
    // UTC-4 (o la cita se habría registrado como si fuera de otro día).
    const tz = payload.zonaHoraria || ZONA_POR_DEFECTO;
    const citaDateTime = this.tiempo.aInstante(
      fechaCalendarioISO(payload.fechaCita),
      horaRelojHHMM(payload.horaInicio),
      tz,
    );

    // 1 hora antes de la cita
    const recordatorioTime = new Date(citaDateTime.getTime() - 60 * 60 * 1000);
    const delay = Math.max(0, recordatorioTime.getTime() - this.tiempo.ahora().getTime());

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
