import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificacionService } from '../application/notificacion.service.js';
import { NotificacionProcessor } from '../application/notificacion.processor.js';
import { NotificacionController } from './notificacion.controller.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notificaciones',
    }),
  ],
  controllers: [NotificacionController],
  providers: [NotificacionService, NotificacionProcessor],
  exports: [NotificacionService],
})
export class NotificacionModule {}
