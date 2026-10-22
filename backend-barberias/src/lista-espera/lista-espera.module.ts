import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ListaEsperaController } from './infrastructure/lista-espera.controller.js';
import { ListaEsperaService } from './application/lista-espera.service.js';
import { ListaEsperaMatcherService } from './application/lista-espera.matcher.service.js';
import { ListaEsperaProcessor } from './application/lista-espera.processor.js';
import { NotificacionModule } from '../notificacion/infrastructure/notificacion.module.js';
import { QUEUES } from '../shared/queues/queue.constants.js';

/**
 * E4-02 · D22 · Carril B.
 *
 * Dos piezas separadas a propósito:
 *  - `ListaEsperaService`: el alta (HTTP, síncrona).
 *  - `ListaEsperaMatcherService`: el motor reactivo (cola, asíncrono), que
 *    consume los `HUECO_LIBERADO` que emite `ReservaService`.
 *
 * `PrismaService` y `TiempoService` llegan de `SharedModule`, que es `@Global`;
 * `NotificacionModule` aporta el canal de aviso al cliente.
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUES.LISTA_ESPERA,
    }),
    NotificacionModule,
  ],
  controllers: [ListaEsperaController],
  providers: [ListaEsperaService, ListaEsperaMatcherService, ListaEsperaProcessor],
  exports: [ListaEsperaService, ListaEsperaMatcherService],
})
export class ListaEsperaModule {}
