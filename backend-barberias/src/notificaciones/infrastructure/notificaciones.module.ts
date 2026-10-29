import { Module } from '@nestjs/common';
import { NotificacionesListener } from '../application/notificaciones.listener.js';
import { RecordatoriosCronService } from '../application/recordatorios-cron.service.js';
import { WhatsappWebhookService } from '../application/whatsapp-webhook.service.js';
import { NotificacionesAdaptadoresModule } from './notificaciones-adaptadores.module.js';
import { NotificacionesWebhookController } from './notificaciones-webhook.controller.js';
// El webhook responde sobre la MISMA reserva que ya existe, por la vía que usa
// la sede (aceptar / cancelar): por eso este módulo sí depende de `ReservaModule`.
import { ReservaModule } from '../../reserva/infrastructure/reserva.module.js';

/**
 * Fase 7 · Notificaciones event-driven, retención y webhook.
 *
 * Este módulo NO lo importa `ReservaModule`: el desacople es el bus. El servicio
 * de reservas inyecta `EventEmitter2` y publica hechos; aquí alguien los escucha.
 *
 * Los adaptadores de entrega (correo y WhatsApp) viven en
 * `NotificacionesAdaptadoresModule`, que se importa y se reexporta aquí: es la
 * misma selección por entorno de siempre, pero compartida con `OtpService`
 * (V2.1) sin arrastrar el grafo de este módulo hacia `IamModule`.
 *
 * Convivir con `NotificacionModule` (singular, BullMQ) es intencional: aquel
 * conserva el despacho con reintentos y el histórico en `notificaciones`. Este
 * cubre el camino nuevo —eventos de dominio, recordatorio de 2 h y respuesta
 * desde el chat—.
 *
 * `ScheduleModule.forRoot()` y `EventEmitterModule.forRoot()` viven en
 * `AppModule`, junto al resto de la infraestructura transversal.
 */
@Module({
  imports: [ReservaModule, NotificacionesAdaptadoresModule],
  controllers: [NotificacionesWebhookController],
  providers: [NotificacionesListener, RecordatoriosCronService, WhatsappWebhookService],
  // Se reexporta el módulo, no los tokens: Nest solo valida como exportable lo
  // que declared el propio módulo, y los dos adaptadores viven en el suyo.
  exports: [NotificacionesAdaptadoresModule],
})
export class NotificacionesModule {}