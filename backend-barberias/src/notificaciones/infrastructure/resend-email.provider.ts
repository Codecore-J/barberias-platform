import { Inject, Injectable, Logger } from '@nestjs/common';
import { type IEmailProvider, type MensajeEmail } from '../domain/port/email.provider.js';

/**
 * Fase 7 · adaptador de correo REAL contra Resend, con fetch nativo de Node.
 *
 * Sin SDK: una llamada HTTP, un timeout de 5 s y nada más (el mandato de
 * «cero dependencias pesadas»). La configuración llega por inyección desde el
 * `useFactory` de `NotificacionesModule`, que es quien lee las variables de
 * entorno: aquí dentro no se toca `process.env`, así el proveedor se prueba
 * montando el objeto de config a mano.
 */
export const RESEND_CONFIG = Symbol('RESEND_CONFIG');

export interface ResendConfig {
  /** `RESEND_API_KEY`. Sin ella el adaptador falla en lugar de fingir un envío. */
  apiKey: string;
  /** `EMAIL_FROM`. Resend exige un remitente verificado en el dominio. */
  from?: string;
}

export const RESEND_API_URL = 'https://api.resend.com/emails';

/** Timeout de envío: un proveedor colgado no puede retener el proceso. */
export const TIMEOUT_ENVIO_MS = 5000;

/** Remitente por defecto de Resend si `EMAIL_FROM` no está declarado. */
const REMITENTE_POR_DEFECTO = 'onboarding@resend.com';

/** El símbolo `&` por código de punto: evita escribir la entidad a mano. */
const AMP = String.fromCharCode(38);

/** Cabecera y color por tipo de evento: la plantilla se adapta al hecho. */
const PRESENTACION: Record<string, { color: string; etiqueta: string }> = {
  'reserva.recordatorio': { color: '#b45309', etiqueta: 'Recordatorio de cita' },
  'reserva.confirmada': { color: '#15803d', etiqueta: 'Cita confirmada' },
  'reserva.creada': { color: '#1d4ed8', etiqueta: 'Solicitud recibida' },
  'reserva.cancelada': { color: '#b91c1c', etiqueta: 'Cita cancelada' },
  'reserva.inasistencia': { color: '#6b7280', etiqueta: 'Inasistencia registrada' },
};

/**
 * Escapa el texto antes de meterlo en el HTML: ningún dato de usuario cruza a
 * etiquetas (XSS por contenido: un nombre de cliente con `<script>` no debe
 * ejecutarse en el cliente de correo).
 */
function escapar(texto: string): string {
  const entidades: Record<string, string> = {
    [AMP]: `${AMP}amp;`,
    '<': `${AMP}lt;`,
    '>': `${AMP}gt;`,
    '"': `${AMP}quot;`,
    "'": `${AMP}#39;`,
  };
  return texto.replace(/[&<>"']/g, (caracter) => entidades[caracter] ?? caracter);
}

@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);

  private readonly url = RESEND_API_URL;

  constructor(@Inject(RESEND_CONFIG) private readonly config: ResendConfig) {}

  async enviar(mensaje: MensajeEmail): Promise<void> {
    if (!this.config?.apiKey) {
      throw new Error('ResendEmailProvider: falta RESEND_API_KEY en la configuración.');
    }

    const respuesta = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.from?.trim() || REMITENTE_POR_DEFECTO,
        to: [mensaje.destinatario],
        subject: mensaje.asunto,
        html: this.plantilla(mensaje),
      }),
      signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      throw new Error(
        `Resend rechazó el envío (${respuesta.status}): ${detalle.slice(0, 200)}`,
      );
    }

    this.logger.log(`[Resend] enviado a ${mensaje.destinatario}: "${mensaje.asunto}"`);
  }

  /**
   * Plantilla HTML única y autónoma (sin imágenes externas): cabecera con el
   * color del evento, tarjeta de la cita y el texto que ya redactó el dominio.
   */
  private plantilla(mensaje: MensajeEmail): string {
    const { color, etiqueta } = PRESENTACION[mensaje.tipo ?? ''] ?? {
      color: '#111827',
      etiqueta: 'Notificación de cita',
    };

    const cuerpo = escapar(mensaje.cuerpo);
    const asunto = escapar(mensaje.asunto);
    const etiquetaHtml = escapar(etiqueta);

    const tarjetaCita = mensaje.cita
      ? `<table role="presentation" cellspacing="0" cellpadding="12" style="margin:16px 0;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">
  <tr>
    <td style="color:#6b7280;">Sede</td>
    <td style="font-weight:bold;">${escapar(mensaje.cita.sede)}</td>
  </tr>
  <tr>
    <td style="color:#6b7280;">Fecha</td>
    <td>${escapar(mensaje.cita.fecha)}</td>
  </tr>
  <tr>
    <td style="color:#6b7280;">Hora</td>
    <td>${escapar(mensaje.cita.hora)}</td>
  </tr>
</table>`
      : '';

    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${asunto}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:${color};padding:20px 24px;color:#ffffff;font-size:18px;font-weight:bold;">
                ${etiquetaHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#111827;">${cuerpo}</p>
                ${tarjetaCita}
                <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">
                  Este es un aviso automático de la plataforma de barberias. Si no esperabas este correo, puedes ignorarlo.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }
}