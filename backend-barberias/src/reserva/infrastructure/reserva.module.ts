import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReservaService } from '../application/reserva.service.js';
import { CrearWalkInYCobrarService } from '../application/crear-walkin-y-cobrar.service.js';
import { ReservaProcessor } from '../application/reserva.processor.js';
import { ExpiracionReservaService } from '../application/expiracion-reserva.service.js';
import { ReservaController } from './reserva.controller.js';
// V3 · reasignación de barbero: contrato `PATCH /reservas/:id/asignar-barbero`.
import { ReservaAsignacionController } from './reserva-asignacion.controller.js';
import { AgendaModule } from '../../agenda/infrastructure/agenda.module.js';
import { NotificacionModule } from '../../notificacion/infrastructure/notificacion.module.js';
// E3-04: aceptar y rechazar auditan (RESERVA_CONFIRMADA / RESERVA_RECHAZADA).
// E3-05: la expiración automática y la cancelación manual auditan también.
import { AuditoriaModule } from '../../auditoria/infrastructure/auditoria.module.js';
// Única fuente del nombre de la cola: el productor (ReservaService), el
// consumidor (ReservaProcessor) y la reconciliación la leen de aquí
// (HALLAZGO-E305-01: antes cada uno llevaba su propio literal).
import { QUEUES } from '../../shared/queues/queue.constants.js';
// Fase 3 · el walk-in cobrado reutiliza `PagoService` dentro de su propia
// transacción. `PagoModule` solo depende de Auditoría, así que no hay ciclo.
import { PagoModule } from '../../pago/infrastructure/pago.module.js';

@Module({
  imports: [
    AgendaModule,
    NotificacionModule,
    AuditoriaModule,
    BullModule.registerQueue({
      name: QUEUES.RESERVAS,
    }),
    // E4-02 · D22 · Carril B: la cola donde `ReservaService` avisa de un bloque
    // que quedó libre. El consumidor vive en `ListaEsperaModule`; aquí solo se
    // registra para poder inyectarla en el productor.
    BullModule.registerQueue({
      name: QUEUES.LISTA_ESPERA,
    }),
    PagoModule,
  ],
  controllers: [ReservaController, ReservaAsignacionController],
  providers: [
    ReservaService,
    ReservaProcessor,
    ExpiracionReservaService,
    CrearWalkInYCobrarService,
  ],
  exports: [ReservaService],
})
export class ReservaModule {}
