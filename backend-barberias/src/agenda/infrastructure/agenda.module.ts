import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AgendaService } from '../application/agenda.service.js';
import { DisponibilidadService } from '../application/disponibilidad.service.js';
import { AgendaController } from './agenda.controller.js';
import { HuecosController } from './huecos.controller.js';
import { BloqueosProcessor } from '../application/bloqueos.processor.js';
import { SharedModule } from '../../shared/shared.module.js';

@Module({
  imports: [
    SharedModule,
    BullModule.registerQueue({
      name: 'agenda-bloqueos',
    }),
  ],
  // E4-02: `HuecosController` expone `GET .../disponibilidad/huecos` con los
  // mismos huecos que el carril A del error (D47).
  controllers: [AgendaController, HuecosController],
  providers: [AgendaService, BloqueosProcessor, DisponibilidadService],
  exports: [AgendaService, DisponibilidadService],
})
export class AgendaModule {}
