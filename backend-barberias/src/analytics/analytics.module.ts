import { Module } from '@nestjs/common';
import { AnalyticsService } from './application/analytics.service.js';
import { AnalyticsController } from './infrastructure/analytics.controller.js';
import { ShopsOverviewController } from './infrastructure/shops-overview.controller.js';
import { SharedModule } from '../shared/shared.module.js';

@Module({
  imports: [SharedModule],
  controllers: [AnalyticsController, ShopsOverviewController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
