import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type IWhatsAppProvider,
  type MensajeWhatsApp,
} from '../domain/port/whatsapp.provider.js';

/**
 * Fase 7 · adaptador de WhatsApp REAL por HTTP, con fetch nativo.
 *
 * El mismo contrato que Resend: sin SDK ni dependencia pesada, solo un POST con
 * `Authorization: Bearer <token>` y timeout de 5 s. Ese patrón de cabecera es
 * el que comparten Meta Cloud API y gateways como Evolution API, así que la
 * URL del proveedor se configura por variable de entorno y el cuerpo se envía
 * en el formato de Meta Cloud API.
 */
export const WHATSAPP_CONFIG = Symbol('WHATSAPP_CONFIG');

export interface WhatsappConfig {
  /** `WHATSAPP_API_URL`: endpoint del proveedor. */
  apiUrl: string;
  /** `WHATSAPP_API_TOKEN`: token de la API, viaja como Bearer. */
  token: string;
}

/** Timeout de envío: igual que Resend, un proveedor colgado no retiene nada. */
export const TIMEOUT_WHATSAPP_MS = 5000;

@Injectable()
export class HttpWhatsAppProvider implements IWhatsAppProvider {
  private readonly logger = new Logger(HttpWhatsAppProvider.name);

  constructor(@Inject(WHATSAPP_CONFIG) private readonly config: WhatsappConfig) {}

  async enviar({ telefono, texto }: MensajeWhatsApp): Promise<void> {
    if (!this.config?.apiUrl || !this.config?.token) {
      throw new Error(
        'HttpWhatsAppProvider: faltan WHATSAPP_API_URL o WHATSAPP_API_TOKEN en la configuración.',
      );
    }

    const respuesta = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'text',
        text: { preview_url: false, body: texto },
      }),
      signal: AbortSignal.timeout(TIMEOUT_WHATSAPP_MS),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      throw new Error(
        `WhatsApp API rechazó el envío (${respuesta.status}): ${detalle.slice(0, 200)}`,
      );
    }

    this.logger.log(`[WhatsApp] entregado a ${telefono}`);
  }
}