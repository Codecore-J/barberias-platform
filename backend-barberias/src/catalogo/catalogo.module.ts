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
// T-27/T-28 · solicitudes de servicio del barbero y su resolución.
import { SolicitudesServicioController } from './infrastructure/solicitudes-servicio.controller.js';
import { SolicitudesServicioService } from './application/solicitudes-servicio.service.js';
// T-17 · la lectura de categorías del ADMINISTRADOR global se audita.
import { AuditoriaModule } from '../auditoria/infrastructure/auditoria.module.js';
// T-24 · subida de la foto del servicio a Cloudinary.
import { CloudinaryService } from '../shared/cloudinary/cloudinary.service.js';

@Module({
  imports: [AuditoriaModule],
  controllers: [
    ServiciosController,
    CombosController,
    CategoriasController,
    ServiciosBarberoController,
    SolicitudesServicioController,
  ],
  providers: [
    ServiciosService,
    CombosService,
    CategoriasService,
    ServiciosBarberoService,
    SolicitudesServicioService,
    CloudinaryService,
  ],
  exports: [ServiciosService, CombosService, CategoriasService, ServiciosBarberoService],
})
export class CatalogoModule {}
