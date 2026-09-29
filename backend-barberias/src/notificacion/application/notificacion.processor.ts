import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

@Processor('notificaciones')
export class NotificacionProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificacionProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Procesando job ${job.id} de notificación [${job.name}]`);

    // 1. Despacho inmediato
    if (job.name === 'enviar-notificacion') {
      const { notificacionId, canal, correo, tipo } = job.data;

      // Simulación de envío vía proveedor (SendGrid / Twilio / FCM)
      this.logger.log(`[SIMULACIÓN ${canal}] Enviando ${tipo} al destinatario ${correo}`);

      await this.prisma.notificacion.update({
        where: { id: notificacionId },
        data: {
          estado: 'ENVIADO',
          enviadoAt: new Date(),
        },
      });

      return { status: 'DELIVERED', notificacionId };
    }

    // 2. Recordatorio programado 1 hora antes de la cita (T8.1)
    if (job.name === 'recordatorio-cita') {
      const { usuarioId, reservaId, nombreBarberia, fechaHoraCita } = job.data;

      // Verificar que la reserva siga activa antes de disparar el recordatorio
      const reserva = await this.prisma.reserva.findUnique({
        where: { id: reservaId },
      });

      if (!reserva || ['CANCELADA', 'NO_ASISTIO', 'EXPIRADA'].includes(reserva.estado)) {
        this.logger.log(
          `Recordatorio descartado: la reserva ${reservaId} ya no está activa (Estado: ${reserva?.estado})`,
        );
        return { status: 'SKIPPED', reason: 'RESERVA_INACTIVA' };
      }

      const mensaje = `Recordatorio: Tienes una cita programada en "${nombreBarberia}" para las ${new Date(
        fechaHoraCita,
      ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Te esperamos en 1 hora.`;

      // Persistir el recordatorio como notificación enviada
      const notificacion = await this.prisma.notificacion.create({
        data: {
          usuarioId,
          canal: 'EMAIL',
          tipo: 'RECORDATORIO_CITA',
          contenido: mensaje,
          estado: 'ENVIADO',
          enviadoAt: new Date(),
        },
      });

      this.logger.log(
        `Recordatorio 1h antes para reserva ${reservaId} entregado exitosamente a usuario ${usuarioId}`,
      );

      return { status: 'REMINDER_SENT', notificacionId: notificacion.id };
    }
  }
}
