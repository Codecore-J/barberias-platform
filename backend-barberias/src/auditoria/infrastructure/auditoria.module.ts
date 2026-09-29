import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditoriaService } from '../application/auditoria.service.js';
import { AuditoriaProcessor } from '../application/auditoria.processor.js';
import { AuditoriaController } from './auditoria.controller.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'auditoria-purga',
    }),
  ],
  controllers: [AuditoriaController],
  providers: [AuditoriaService, AuditoriaProcessor],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
