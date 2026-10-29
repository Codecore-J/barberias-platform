import { Module } from '@nestjs/common';
import { HorarioService } from '../application/horario.service.js';
import { HorarioController } from './horario.controller.js';
import { HorarioBarberoController } from './horario-barbero.controller.js';
import { SharedModule } from '../../shared/shared.module.js';

@Module({
  imports: [SharedModule],
  controllers: [HorarioController, HorarioBarberoController],
  providers: [HorarioService],
  exports: [HorarioService],
})
export class HorarioModule {}
