import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AgendaService } from '../application/agenda.service.js';
import { DisponibilidadService } from '../application/disponibilidad.service.js';
import { AgendaController } from './agenda.controller.js';
import { BloqueosProcessor } from '../application/bloqueos.processor.js';
import { SharedModule } from '../../shared/shared.module.js';

@Module({
  imports: [
    SharedModule,
    BullModule.registerQueue({
      name: 'agenda-bloqueos',
    }),
  ],
  controllers: [AgendaController],
  providers: [AgendaService, BloqueosProcessor, DisponibilidadService],
  exports: [AgendaService, DisponibilidadService],
})
export class AgendaModule {}
