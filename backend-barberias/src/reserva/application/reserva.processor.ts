import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

@Processor('reservas-pendientes')
export class ReservaProcessor extends WorkerHost {
  private readonly logger = new Logger(ReservaProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Procesando job ${job.id} de tipo ${job.name}`);

    if (job.name === 'expirar-reserva') {
      const { reservaId } = job.data;
      
      const reserva = await this.prisma.reserva.findUnique({
        where: { id: reservaId },
      });

      if (reserva && reserva.estado === 'PENDIENTE') {
        await this.prisma.reserva.update({
          where: { id: reservaId },
          data: { estado: 'EXPIRADA' },
        });
        this.logger.log(`Reserva ${reservaId} expirada tras agotar el tiempo manual.`);
      } else {
        this.logger.log(`Reserva ${reservaId} no expirada (Estado actual: ${reserva?.estado}).`);
      }
    }
  }
}
