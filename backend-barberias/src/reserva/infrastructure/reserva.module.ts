import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReservaService } from '../application/reserva.service.js';
import { ReservaProcessor } from '../application/reserva.processor.js';
import { ReservaController } from './reserva.controller.js';
import { AgendaModule } from '../../agenda/infrastructure/agenda.module.js';
import { NotificacionModule } from '../../notificacion/infrastructure/notificacion.module.js';
// E3-04: aceptar y rechazar auditan (RESERVA_CONFIRMADA / RESERVA_RECHAZADA).
import { AuditoriaModule } from '../../auditoria/infrastructure/auditoria.module.js';

@Module({
  imports: [
    AgendaModule,
    NotificacionModule,
    AuditoriaModule,
    BullModule.registerQueue({
      name: 'reservas-pendientes',
    }),
  ],
  controllers: [ReservaController],
  providers: [ReservaService, ReservaProcessor],
  exports: [ReservaService],
})
export class ReservaModule {}
