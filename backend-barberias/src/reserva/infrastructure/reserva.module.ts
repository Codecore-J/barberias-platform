import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReservaService } from '../application/reserva.service.js';
import { ReservaProcessor } from '../application/reserva.processor.js';
import { ExpiracionReservaService } from '../application/expiracion-reserva.service.js';
import { ReservaController } from './reserva.controller.js';
import { AgendaModule } from '../../agenda/infrastructure/agenda.module.js';
import { NotificacionModule } from '../../notificacion/infrastructure/notificacion.module.js';
// E3-04: aceptar y rechazar auditan (RESERVA_CONFIRMADA / RESERVA_RECHAZADA).
// E3-05: la expiración automática y la cancelación manual auditan también.
import { AuditoriaModule } from '../../auditoria/infrastructure/auditoria.module.js';
// Única fuente del nombre de la cola: el productor (ReservaService), el
// consumidor (ReservaProcessor) y la reconciliación la leen de aquí
// (HALLAZGO-E305-01: antes cada uno llevaba su propio literal).
import { QUEUES } from '../../shared/queues/queue.constants.js';

@Module({
  imports: [
    AgendaModule,
    NotificacionModule,
    AuditoriaModule,
    BullModule.registerQueue({
      name: QUEUES.RESERVAS,
    }),
  ],
  controllers: [ReservaController],
  providers: [ReservaService, ReservaProcessor, ExpiracionReservaService],
  exports: [ReservaService],
})
export class ReservaModule {}
