import { Module } from '@nestjs/common';
import { ServiciosController } from './infrastructure/servicios.controller.js';
import { ServiciosService } from './application/servicios.service.js';
import { CombosController } from './infrastructure/combos.controller.js';
import { CombosService } from './application/combos.service.js';
// V3 · catálogo híbrido: categorías de la sede + servicios propios del barbero.
import { CategoriasController } from './infrastructure/categorias.controller.js';
import { CategoriasService } from './application/categorias.service.js';
import { ServiciosBarberoController } from './infrastructure/servicios-barbero.controller.js';
import { ServiciosBarberoService } from './application/servicios-barbero.service.js';

@Module({
  controllers: [
    ServiciosController,
    CombosController,
    CategoriasController,
    ServiciosBarberoController,
  ],
  providers: [ServiciosService, CombosService, CategoriasService, ServiciosBarberoService],
  exports: [ServiciosService, CombosService, CategoriasService, ServiciosBarberoService],
})
export class CatalogoModule {}
