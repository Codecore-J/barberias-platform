import { Module } from '@nestjs/common';
import { AnalyticsService } from './application/analytics.service.js';
import { AnalyticsController } from './infrastructure/analytics.controller.js';
import { SharedModule } from '../shared/shared.module.js';

@Module({
  imports: [SharedModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
