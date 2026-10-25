import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EMAIL_PROVIDER, type IEmailProvider } from '../domain/port/email.provider.js';
import {
  WHATSAPP_PROVIDER,
  type IWhatsAppProvider,
} from '../domain/port/whatsapp.provider.js';
import {
  PATRON_EVENTOS_RESERVA,
  type EventoReserva,
} from '../domain/eventos-reserva.js';
import {
  componerMensaje,
  type CanalNotificacion,
  type MensajeNotificacion,
} from '../domain/mensajes.js';

/**
 * Fase 7 · Escucha `reserva.*` y entrega por los canales que pida la plantilla.
 *
 * Se suscribe con un patrón (no con cinco métodos) porque la reacción es la
 * misma para todos los hechos: componer el texto y entregarlo. El payload trae
 * `tipo`, que es lo que `componerMensaje` usa para elegir la plantilla.
 *
 * Cada canal se entrega por separado y con su propio `try/catch`: un proveedor
 * de WhatsApp caído no puede impedir que salga el correo, y ninguno de los dos
 * puede tumbar el proceso. `ReservaService` emite con `emit()` —sin `await`—,
 * así que una excepción aquí se perdería como *unhandled rejection*; por eso el
 * listener nunca deja escapar una.
 */
@Injectable()
export class NotificacionesListener {
  private readonly logger = new Logger(NotificacionesListener.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly email: IEmailProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: IWhatsAppProvider,
  ) {}

  @OnEvent(PATRON_EVENTOS_RESERVA)
  async alOcurrirEventoDeReserva(evento: EventoReserva): Promise<void> {
    let mensaje: MensajeNotificacion;

    try {
      mensaje = componerMensaje(evento);
    } catch (error) {
      // El patrón `reserva.*` también recibirá eventos futuros. Si uno llega sin
      // plantilla, se anota y se ignora: nunca debe ser una promesa rechazada
      // sin dueño.
      this.logger.warn(
        `Evento de reserva sin plantilla (${String(evento?.tipo)}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (mensaje.canales.includes('EMAIL')) {
      await this.entregar('EMAIL', evento, () =>
        this.email.enviar({
          destinatario: evento.correoCliente,
          asunto: mensaje.asunto,
          cuerpo: mensaje.cuerpo,
        }),
      );
    }

    if (mensaje.canales.includes('WHATSAPP')) {
      await this.entregar('WHATSAPP', evento, () =>
        this.whatsapp.enviar({
          telefono: evento.telefonoCliente,
          texto: mensaje.cuerpo,
        }),
      );
    }
  }

  private async entregar(
    canal: CanalNotificacion,
    evento: EventoReserva,
    envio: () => Promise<void>,
  ): Promise<void> {
    try {
      await envio();
    } catch (error) {
      this.logger.warn(
        `No se pudo entregar ${evento.tipo} de la reserva ${evento.reservaId} por ${canal}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
