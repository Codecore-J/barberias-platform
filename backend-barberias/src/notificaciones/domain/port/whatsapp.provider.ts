/**
 * Fase 7 · Puerto de WhatsApp (ports & adapters).
 *
 * Mismo contrato que el de correo: el dominio pide «avisa a este número», no
 * «llama a Twilio». El adaptador Mock escribe en el log; el real (Twilio, Meta
 * Cloud API) se enchufa sustituyendo el proveedor del token.
 */
export const WHATSAPP_PROVIDER = Symbol('IWhatsAppProvider');

export interface MensajeWhatsApp {
  /** Teléfono del destinatario tal como está registrado en `usuarios.telefono`. */
  telefono: string;
  texto: string;
}

export interface IWhatsAppProvider {
  enviar(mensaje: MensajeWhatsApp): Promise<void>;
}
