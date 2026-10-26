import { Injectable, Logger } from '@nestjs/common';
import {
  type IWhatsAppProvider,
  type MensajeWhatsApp,
} from '../domain/port/whatsapp.provider.js';

/**
 * Fase 7 · Adaptador temporal de WhatsApp.
 *
 * El mensaje se imprime con el mismo formato que tendría el proveedor real
 * (`[WhatsApp Mock] Enviando a +1809...: "..."`) para que, durante la auditoría,
 * el log sirva de evidencia de qué se habría enviado y cuándo.
 */
@Injectable()
export class MockWhatsAppProvider implements IWhatsAppProvider {
  private readonly logger = new Logger(MockWhatsAppProvider.name);

  async enviar({ telefono, texto }: MensajeWhatsApp): Promise<void> {
    this.logger.log(`[WhatsApp Mock] Enviando a ${telefono}: "${texto}"`);
  }
}
