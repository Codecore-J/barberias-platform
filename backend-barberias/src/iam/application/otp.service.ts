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
import {
  errorDeConflicto,
  errorDePermiso,
  errorDeSolicitud,
} from '../../shared/errors/d40.errors.js';
import { EMAIL_PROVIDER, type IEmailProvider } from '../../notificaciones/domain/port/email.provider.js';
import {
  WHATSAPP_PROVIDER,
  type IWhatsAppProvider,
} from '../../notificaciones/domain/port/whatsapp.provider.js';

/** Resultado de corregir el contacto de una cuenta pendiente de verificar. */
export interface ContactoActualizado {
  mensaje: string;
  telefono: string;
  correo: string;
  canalesInvalidados: TipoOtp[];
}

/**
 * V2.1 · Verificación de correo y teléfono por código de 6 dígitos.
 *
 * Tres operaciones:
 *
 *  - `enviar`: invalida los códigos anteriores NO usados del mismo canal,
 *    crea uno nuevo con 10 minutos de vida y lo entrega por el proveedor del
 *    canal (WhatsApp para `TELEFONO`, correo para `CORREO`).
 *  - `verificar`: busca el código vivo del canal, lo consume en una sola
 *    pasada y levanta la bandera del usuario.
 *  - `actualizarContacto` (T-21): corrige el teléfono o el correo de una cuenta
 *    que aún no ha verificado ese canal —la «cuenta zombie» que nació con el
 *    número mal tecleado y a la que, sin esto, ningún código podría llegar
 *    nunca— e invalida de paso los códigos vivos del canal viejo.
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
   * T-21 · Corrige el contacto de una cuenta que todavía no ha verificado ese
   * canal e invalida los códigos vivos del contacto anterior.
   *
   * La puerta es el ESTADO DE VERIFICACIÓN, no un rol: mientras el canal siga
   * sin confirmar, la cuenta es un usuario que no puede operar (el
   * `VerificacionGuard` le cierra la agenda) y cuyo único camino de salida es
   * recibir un código en un destino que él controle. Si el canal YA está
   * verificado, cambiar el destino por esta vía permitiría secuestrar la cuenta
   * con un token robado y un número ajeno: ahí responde 403 y el cambio pasa
   * por la sede.
   *
   * Invalidar los códigos anteriores es el otro medio de la operación: el
   * código que salió hacia el número equivocado no debe seguir siendo válido
   * cuando el contacto cambia, o quien lo recibió conservaría la llave de una
   * cuenta que ya no es suya.
   */
  async actualizarContacto(
    usuarioId: string,
    datos: { telefono?: string; correo?: string },
  ): Promise<ContactoActualizado> {
    if (!datos.telefono && !datos.correo) {
      throw errorDeSolicitud('CONTACTO_REQUERIDO', 'Indica el teléfono o el correo nuevo.');
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        id: true,
        correo: true,
        telefono: true,
        correoVerificado: true,
        telefonoVerificado: true,
        estadoCuenta: true,
      },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    // Una cuenta suspendida no corrige nada: si pudiera, el bloqueo se
    // esquivaría cambiando el destino de los códigos.
    if (usuario.estadoCuenta !== 'ACTIVO') {
      throw errorDePermiso(
        'CUENTA_NO_ACTIVA',
        'Tu cuenta no está activa, así que no puedes cambiar el contacto.',
      );
    }

    const cambios: { telefono?: string; correo?: string } = {};
    const canalesInvalidados: TipoOtp[] = [];

    if (datos.telefono !== undefined && datos.telefono !== usuario.telefono) {
      if (usuario.telefonoVerificado) {
        throw errorDePermiso(
          'CONTACTO_YA_VERIFICADO',
          'Tu teléfono ya está verificado. Para cambiarlo, pide ayuda a la sede.',
        );
      }
      cambios.telefono = datos.telefono;
      canalesInvalidados.push(TipoOtp.TELEFONO);
    }

    if (datos.correo !== undefined && datos.correo !== usuario.correo) {
      if (usuario.correoVerificado) {
        throw errorDePermiso(
          'CONTACTO_YA_VERIFICADO',
          'Tu correo ya está verificado. Para cambiarlo, pide ayuda a la sede.',
        );
      }
      cambios.correo = datos.correo;
      canalesInvalidados.push(TipoOtp.CORREO);
    }

    // Corregir a lo que ya estaba no es un error del usuario: no se escribe
    // nada, no se invalida nada y la respuesta lo dice sin dramatizar.
    if (canalesInvalidados.length === 0) {
      return {
        mensaje: 'El contacto indicado ya es el de tu cuenta.',
        telefono: usuario.telefono,
        correo: usuario.correo,
        canalesInvalidados,
      };
    }

    try {
      const actualizado = await withSerializableTransaction(this.prisma, async (tx) => {
        await tx.otpConfirmacion.updateMany({
          where: { usuarioId, tipo: { in: canalesInvalidados }, usado: false },
          data: { usado: true, actualizadoEn: new Date() },
        });

        return tx.usuario.update({
          where: { id: usuarioId },
          data: cambios,
          select: { telefono: true, correo: true },
        });
      });

      this.logger.log(
        `Contacto corregido para ${usuarioId} (${canalesInvalidados.join(', ')}); códigos anteriores invalidados.`,
      );

      return {
        mensaje: 'Contacto actualizado.',
        telefono: actualizado.telefono,
        correo: actualizado.correo,
        canalesInvalidados,
      };
    } catch (error: any) {
      // `telefono` y `correo` son UNIQUE: un destino que ya pertenece a otra
      // cuenta no se puede tomar prestado. Es 409, no 500.
      if (error?.code === 'P2002') {
        const campos = (error?.meta?.target as string[] | undefined) ?? [];
        throw errorDeConflicto(
          'CONTACTO_EN_USO',
          campos.includes('correo')
            ? 'Ese correo ya está registrado en otra cuenta.'
            : 'Ese teléfono ya está registrado en otra cuenta.',
        );
      }
      throw error;
    }
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
