import { Module } from '@nestjs/common';
import { ServiciosController } from './infrastructure/servicios.controller.js';
import { ServiciosService } from './application/servicios.service.js';
import { CombosController } from './infrastructure/combos.controller.js';
import { CombosService } from './application/combos.service.js';

@Module({
  controllers: [ServiciosController, CombosController],
  providers: [ServiciosService, CombosService],
  exports: [ServiciosService, CombosService],
})
export class CatalogoModule {}
