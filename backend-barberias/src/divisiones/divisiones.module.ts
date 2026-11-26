import { Module } from '@nestjs/common';
import { DivisionesService } from './application/divisiones.service.js';
import { DivisionesController } from './infrastructure/divisiones.controller.js';

/**
 * F6 / T-66 · catálogo de divisiones administrativas.
 *
 * `PrismaService` llega por el módulo global de la aplicación, igual que en el
 * resto de módulos de dominio.
 */
@Module({
  controllers: [DivisionesController],
  providers: [DivisionesService],
  exports: [DivisionesService],
})
export class DivisionesModule {}
