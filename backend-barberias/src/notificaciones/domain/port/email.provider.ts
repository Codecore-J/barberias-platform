/**
 * Fase 7 · Puerto de correo (ports & adapters).
 *
 * La aplicación depende de esta interfaz, nunca de SendGrid, Resend o SES. Hoy
 * la implementa `MockEmailProvider`; cambiar de proveedor real es escribir un
 * adaptador nuevo y registrar ese token, sin tocar listener ni cron.
 *
 * El token va como `Symbol` para que el `@Inject` no dependa de una cadena.
 */
export const EMAIL_PROVIDER = Symbol('IEmailProvider');

export interface MensajeEmail {
  destinatario: string;
  asunto: string;
  cuerpo: string;
  /**
   * Hecho de dominio que originó el mensaje (`reserva.recordatorio`, …).
   * Lo usa el adaptador de Resend para elegir la cabecera y el color de la
   * plantilla HTML; el adaptador Mock solo lo registra.
   */
  tipo?: string;
  /** Datos de la cita para la tarjeta HTML: sede, fecha y hora locales. */
  cita?: { sede: string; fecha: string; hora: string };
}

export interface IEmailProvider {
  /** Entrega un correo. El adaptador decide si falla lanzando o en silencio. */
  enviar(mensaje: MensajeEmail): Promise<void>;
}
