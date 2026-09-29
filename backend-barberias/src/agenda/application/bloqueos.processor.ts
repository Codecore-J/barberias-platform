import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

@Processor('agenda-bloqueos')
export class BloqueosProcessor extends WorkerHost {
  private readonly logger = new Logger(BloqueosProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Procesando job ${job.id} de tipo ${job.name}`);

    if (job.name === 'liberar-bloqueo') {
      const { bloqueoId } = job.data;
      
      const bloqueo = await this.prisma.bloqueosAgenda.findUnique({
        where: { id: bloqueoId },
      });

      if (bloqueo) {
        await this.prisma.bloqueosAgenda.delete({
          where: { id: bloqueoId },
        });
        this.logger.log(`Bloqueo ${bloqueoId} liberado exitosamente tras expirar su tiempo.`);
      } else {
        this.logger.warn(`Bloqueo ${bloqueoId} ya no existe, no se requiere liberación.`);
      }
    }
  }
}
