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

      if (!bloqueo) {
        this.logger.warn(`Bloqueo ${bloqueoId} ya no existe, no se requiere liberación.`);
        return;
      }

      // E2-07 · D29: la liberación automática hace lo MISMO que la manual —fijar
      // `liberado_at` en vez de borrar la fila— para que el histórico sea el
      // mismo venga el disparo del job o del ADMIN_BARBERIA. Idempotente: si el
      // bloqueo ya se liberó a mano, el job no vuelve a escribir.
      if (bloqueo.liberadoAt) {
        this.logger.log(`Bloqueo ${bloqueoId} ya estaba liberado; el job no hace nada.`);
        return;
      }

      await this.prisma.bloqueosAgenda.update({
        where: { id: bloqueoId },
        data: { liberadoAt: new Date(), jobId: null },
      });

      this.logger.log(`Bloqueo ${bloqueoId} liberado exitosamente tras expirar su tiempo.`);
    }
  }
}
