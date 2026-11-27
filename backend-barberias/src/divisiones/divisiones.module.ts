import { Module } from '@nestjs/common';
import { GeocodificacionModule } from '../geocodificacion/geocodificacion.module.js';
import { DivisionesService } from './application/divisiones.service.js';
import { DivisionesController } from './infrastructure/divisiones.controller.js';

/**
 * F6 / T-66 · catálogo de divisiones administrativas.
 *
 * `PrismaService` llega por el módulo global de la aplicación, igual que en el
 * resto de módulos de dominio.
 */
@Module({
  // F6 / T-66 · la confirmación por coordenadas usa el mismo proveedor que el
  // alta, así que el catálogo depende del módulo de geocodificación.
  imports: [GeocodificacionModule],
  controllers: [DivisionesController],
  providers: [DivisionesService],
  exports: [DivisionesService],
})
export class DivisionesModule {}
