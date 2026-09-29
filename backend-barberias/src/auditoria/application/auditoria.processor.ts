import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service.js';

@Processor('auditoria-purga')
export class AuditoriaProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditoriaProcessor.name);

  constructor(private readonly auditoriaService: AuditoriaService) {
    super();
  }

  async process(job: Job<{ diasRetencion?: number }>): Promise<any> {
    this.logger.log(`Procesando job de mantenimiento [${job.name}]`);

    if (job.name === 'purga-auditoria-diaria') {
      const dias = job.data?.diasRetencion ?? 365;
      const res = await this.auditoriaService.purgarAuditoriasAntiguas(dias);
      return res;
    }
  }
}
