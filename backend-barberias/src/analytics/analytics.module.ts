import { Module } from '@nestjs/common';
import { AnalyticsService } from './application/analytics.service.js';
import { AnalyticsCacheListener } from './application/analytics-cache.listener.js';
import { AnalyticsController } from './infrastructure/analytics.controller.js';
import { ShopsOverviewController } from './infrastructure/shops-overview.controller.js';
import { SharedModule } from '../shared/shared.module.js';

@Module({
  imports: [SharedModule],
  controllers: [AnalyticsController, ShopsOverviewController],
  // El listener purga las claves de la sede cuando `reserva.*` cambia alguna
  // cifra del panel. `CACHE_STORE` llega del `AppCacheModule` global.
  providers: [AnalyticsService, AnalyticsCacheListener],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
