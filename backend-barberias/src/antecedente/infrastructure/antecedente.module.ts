import { Module } from '@nestjs/common';
import { AntecedenteService } from '../application/antecedente.service.js';
import { AntecedenteController } from './antecedente.controller.js';

@Module({
  controllers: [AntecedenteController],
  providers: [AntecedenteService],
  exports: [AntecedenteService],
})
export class AntecedenteModule {}
