import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TipoOtp } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { errorDeSolicitud } from '../../shared/errors/d40.errors.js';
import { EMAIL_PROVIDER, type IEmailProvider } from '../../notificaciones/domain/port/email.provider.js';
import {
  WHATSAPP_PROVIDER,
  type IWhatsAppProvider,
} from '../../notificaciones/domain/port/whatsapp.provider.js';

/**
 * V2.1 · Verificación de correo y teléfono por código de 6 dígitos.
 *
 * Dos operaciones y nada más:
 *
 *  - `enviar`: invalida los códigos anteriores NO usados del mismo canal,
 *    crea uno nuevo con 10 minutos de vida y lo entrega por el proveedor del
 *    canal (WhatsApp para `TELEFONO`, correo para `CORREO`).
 *  - `verificar`: busca el código vivo del canal, lo consume en una sola
 *    pasada y levanta la bandera del usuario.
 *
 * El código se guarda en claro porque hay que REUTILIZARLO para enviarlo: su
 * protección es la ventana de 10 minutos, el `usado` de un solo disparo y el
 * techo de envíos por minuto del controlador, no el hash. La consulta de
 * validación siempre exige `usado: false` y `expiraEn > ahora`, de modo que un
 * código adivinado fuera de ventana o reutilizado devuelve el mismo 400 que
 * uno inexistente — sin decir cuál de los tres fallos fue.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  /** Vida del código: el texto enviado al usuario la menciona, así que es contrato. */
  private static readonly MINUTOS_DE_VIDA = 10;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly email: IEmailProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: IWhatsAppProvider,
  ) {}

  /**
   * Genera el código con `crypto.randomInt`, que sí es un CSPRNG: `Math.random`
   * es secuenciable y un ataque de fuerza bruta sobre 10⁶ combinaciones se
   * beneficiaría de cada sesgo. El relleno a 6 dígitos mantiene los ceros a la
   * izquierda (`004123`), que es exactamente lo que espera el DTO de validación.
   */
  private generarCodigo(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /**
   * Emite un código para el `usuarioId` en el canal indicado.
   *
   * Devuelve la ventana de vigencia para que el frontend monte el temporizador
   * de reenvío sin tener que confiar en su propio reloj.
   */
  async enviar(usuarioId: string, tipo: TipoOtp): Promise<{ mensaje: string; expiraEn: string }> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        id: true,
        correo: true,
        telefono: true,
        correoVerificado: true,
        telefonoVerificado: true,
      },
    });

    if (!usuario) {
      // El JWT ya validó que la cuenta existe y está ACTIVA; si desapareció
      // entre la petición y aquí, no hay a quién enviar.
      throw new NotFoundException('Usuario no encontrado.');
    }

    const yaVerificado =
      tipo === TipoOtp.TELEFONO ? usuario.telefonoVerificado : usuario.correoVerificado;

    if (yaVerificado) {
      // Responder sin enviar evita que un token robado dispare envíos
      // indefinidos sobre un canal que ya está confirmado.
      return {
        mensaje: 'Este canal ya está verificado.',
        expiraEn: new Date(0).toISOString(),
      };
    }

    const codigo = this.generarCodigo();
    const expiraEn = new Date(Date.now() + OtpService.MINUTOS_DE_VIDA * 60_000);

    // Invalidar y crear van juntas: si el proceso muere entre las dos, el
    // usuario se quedaría sin código vivo, y al revés tendría dos.
    await withSerializableTransaction(this.prisma, async (tx) => {
      await tx.otpConfirmacion.updateMany({
        where: { usuarioId, tipo, usado: false },
        data: { usado: true, actualizadoEn: new Date() },
      });
      await tx.otpConfirmacion.create({
        data: { usuarioId, codigo, tipo, expiraEn },
      });
    });

    await this.entregar(usuario, codigo, tipo);

    this.logger.log(`Código OTP emitido para ${usuarioId} por ${tipo} (caduca ${expiraEn.toISOString()}).`);

    return {
      mensaje: `Código enviado a tu ${tipo === TipoOtp.TELEFONO ? 'teléfono' : 'correo'}.`,
      expiraEn: expiraEn.toISOString(),
    };
  }

  /**
   * Valida el código y levanta la bandera del canal en la MISMA transacción
   * que lo consume, así dos peticiones simultáneas no pueden gastar el mismo
   * código: solo la que gana el `updateMany` con `usado: false` pasa.
   */
  async verificar(
    usuarioId: string,
    datos: { codigo: string; tipo: TipoOtp },
  ): Promise<{ verificado: boolean; tipo: TipoOtp }> {
    const ahora = new Date();

    return withSerializableTransaction(this.prisma, async (tx) => {
      const otp = await tx.otpConfirmacion.findFirst({
        where: {
          usuarioId,
          tipo: datos.tipo,
          codigo: datos.codigo,
          usado: false,
          expiraEn: { gt: ahora },
        },
        select: { id: true },
        orderBy: { creadoEn: 'desc' },
      });

      // Un solo mensaje cubre las tres causas (desconocido, vencido, ya usado)
      // a propósito: decir cuál de los tres falló le regalaría al atacante la
      // confirmación de que un código anterior llegó a existir.
      const invalido = { codigo: 'OTP_INVALIDO', mensaje: 'El código no es válido o ya expiró.' };

      if (!otp) {
        throw errorDeSolicitud(invalido.codigo, invalido.mensaje);
      }

      const consumido = await tx.otpConfirmacion.updateMany({
        where: { id: otp.id, usado: false },
        data: { usado: true, actualizadoEn: new Date() },
      });

      if (consumido.count !== 1) {
        throw errorDeSolicitud(invalido.codigo, invalido.mensaje);
      }

      await tx.usuario.update({
        where: { id: usuarioId },
        data:
          datos.tipo === TipoOtp.TELEFONO
            ? { telefonoVerificado: true }
            : { correoVerificado: true },
      });

      this.logger.log(`Verificación OTP correcta (${datos.tipo}) para ${usuarioId}.`);
      return { verificado: true, tipo: datos.tipo };
    });
  }

  /**
   * Entrega por el proveedor del canal. Un proveedor caído no puede tumbar la
   * petición ni dejar el usuario con un código que no recibió: se convierte en
   * 503 con el contrato D40 y el siguiente intento de `enviar` invalida el
   * código que quedó sin entregar.
   */
  private async entregar(
    usuario: { correo: string; telefono: string },
    codigo: string,
    tipo: TipoOtp,
  ): Promise<void> {
    const texto = `Tu código de verificación para Imperial Barbers es: ${codigo}. Expira en ${OtpService.MINUTOS_DE_VIDA} minutos.`;

    try {
      if (tipo === TipoOtp.TELEFONO) {
        await this.whatsapp.enviar({ telefono: usuario.telefono, texto });
        return;
      }

      await this.email.enviar({
        destinatario: usuario.correo,
        asunto: 'Código de verificación · Imperial Barbers',
        cuerpo: texto,
        tipo: 'otp.verificacion',
      });
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      this.logger.error(`No se pudo entregar el OTP por ${tipo}: ${detalle}`);
      throw new ServiceUnavailableException({
        statusCode: 503,
        codigo: 'OTP_ENVIO_FALLIDO',
        mensaje: 'No se pudo enviar el código en este momento. Inténtalo de nuevo.',
      });
    }
  }
}
