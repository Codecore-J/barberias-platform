import { Module } from '@nestjs/common';
import { AnalyticsService } from './application/analytics.service.js';
import { AnalyticsCacheListener } from './application/analytics-cache.listener.js';
import { AnalyticsController } from './infrastructure/analytics.controller.js';
import { SharedModule } from '../shared/shared.module.js';

/**
 * `GET /shops/overview` NO se declara aquí: una ruta estática en su propio
 * controlador quedaba registrada después de `GET /shops/:shopId` (Express resuelve
 * por orden) y el comodín se la comía con un 400 de `ParseUUIDPipe`. Ahora vive en
 * `BarberiaController`, antes del `:shopId`; este módulo solo exporta el servicio
 * que aquel consume.
 */
@Module({
  imports: [SharedModule],
  controllers: [AnalyticsController],
  // El listener purga las claves de la sede cuando `reserva.*` cambia alguna
  // cifra del panel. `CACHE_STORE` llega del `AppCacheModule` global.
  providers: [AnalyticsService, AnalyticsCacheListener],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
