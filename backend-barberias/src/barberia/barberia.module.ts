import { Module } from '@nestjs/common';
import { BarberiaService } from './application/barberia.service.js';
import { BarberiaController } from './infrastructure/barberia.controller.js';
import { SharedModule } from '../shared/shared.module.js';

@Module({
  imports: [SharedModule],
  controllers: [BarberiaController],
  providers: [BarberiaService],
  exports: [BarberiaService],
})
export class BarberiaModule {}
