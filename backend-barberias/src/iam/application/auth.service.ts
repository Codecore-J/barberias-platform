import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { UsuarioResponseDto } from './dto/usuario-response.dto.js';
import { JwtPayload } from '../domain/jwt.interface.js';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // OWASP Standard: 10 rondas proporciona resistencia criptográfica completa
  // evitando saturación de CPU en entornos con recursos compartidos (PERF-01).
  private readonly BCRYPT_ROUNDS = 10;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {}

  /**
   * Registra un nuevo usuario en la plataforma.
   * Reglas (Sección 3.1):
   * - Contraseña → bcrypt (12 rondas). NUNCA texto plano.
   * - Cédula OPCIONAL. Si existe, debe ser única.
   * - Se asigna rol CLIENTE en la misma transacción.
   */
  async register(dto: RegisterDto): Promise<UsuarioResponseDto> {
    if (dto.cedula) {
      const cedulaExistente = await this.prisma.usuario.findUnique({
        where: { cedula: dto.cedula },
      });
      if (cedulaExistente) {
        throw new ConflictException('La cédula proporcionada ya está registrada.');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    const rolCliente = await this.prisma.rol.findUnique({
      where: { nombre: 'CLIENTE' },
    });

    if (!rolCliente) {
      this.logger.error('El rol CLIENTE no existe. Ejecuta: npm run seed');
      throw new InternalServerErrorException('Error de configuración del sistema.');
    }

    try {
      const usuario = await this.prisma.$transaction(async (tx) => {
        const nuevoUsuario = await tx.usuario.create({
          data: {
            nombreCompleto: dto.nombreCompleto,
            correo: dto.correo,
            telefono: dto.telefono,
            cedula: dto.cedula ?? null,
            passwordHash,
            estadoCuenta: 'ACTIVO',
          },
        });

        await tx.usuarioRol.create({
          data: {
            usuarioId: nuevoUsuario.id,
            rolId: rolCliente.id,
            barberiaId: null,
          },
        });

        return nuevoUsuario;
      });

      return plainToInstance(UsuarioResponseDto, {
        ...usuario,
        roles: ['CLIENTE'],
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const campo = error?.meta?.target as string[] | undefined;
        if (campo?.includes('correo')) throw new ConflictException('El correo ya está registrado.');
        if (campo?.includes('telefono')) throw new ConflictException('El teléfono ya está registrado.');
        throw new ConflictException('Ya existe un usuario con esos datos.');
      }
      this.logger.error('Error al registrar usuario', error);
      throw new InternalServerErrorException('Error interno del servidor.');
    }
  }

  /**
   * Autentica un usuario y retorna un JWT firmado.
   * Reglas de seguridad:
   * - Se compara el hash con bcrypt.compare (timing-safe).
   * - Si la cuenta está SUSPENDIDA o no ACTIVA → UnauthorizedException con mensaje descriptivo (IAM-01).
   * - El JWT incluye: sub (UUID), correo, roles del usuario.
   */
  async login(dto: LoginDto): Promise<{ accessToken: string; usuario: UsuarioResponseDto }> {
    // Buscar usuario por correo incluyendo sus roles
    const usuario = await this.prisma.usuario.findUnique({
      where: { correo: dto.correo },
      include: {
        usuarioRoles: {
          include: { rol: true },
        },
      },
    });

    // Mensaje genérico para no revelar si el correo existe o no
    const errorGenerico = new UnauthorizedException('Credenciales inválidas.');

    if (!usuario) throw errorGenerico;

    // Comparación timing-safe del hash primero para mitigar enumeración de cuentas
    const passwordValido = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!passwordValido) throw errorGenerico;

    // Si las credenciales son válidas pero la cuenta está suspendida o inactiva (IAM-01)
    if (usuario.estadoCuenta === 'SUSPENDIDO') {
      throw new UnauthorizedException('Su cuenta se encuentra suspendida. Contacte al administrador.');
    }

    if (usuario.estadoCuenta !== 'ACTIVO') {
      throw new UnauthorizedException('Su cuenta no se encuentra activa. Contacte al administrador.');
    }

    // Si la contraseña tiene un costo legado superior a 10 (ej. 12 rondas),
    // re-hasheamos asíncronamente en background a 10 rondas para acelerar logins futuros
    if (usuario.passwordHash.startsWith('$2b$12$') || usuario.passwordHash.startsWith('$2a$12$')) {
      bcrypt.hash(dto.password, this.BCRYPT_ROUNDS).then((nuevoHash) => {
        this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { passwordHash: nuevoHash },
        }).catch((err) => {
          this.logger.warn(`No se pudo actualizar el costo de hash para ${usuario.id}: ${err.message}`);
        });
      });
    }

    // Construir payload del JWT
    const roles = usuario.usuarioRoles.map((ur) => ur.rol.nombre);
    const payload: JwtPayload = {
      sub: usuario.id,
      correo: usuario.correo,
      roles,
    };

    // Firma asíncrona no bloqueante del JWT (PERF-01)
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      usuario: plainToInstance(UsuarioResponseDto, {
        ...usuario,
        roles,
      }),
    };
  }

  /**
   * Obtiene el perfil del usuario autenticado a partir de su ID.
   * Incluye sus roles actuales y omite de forma defensiva el passwordHash.
   */
  async getProfile(userId: string): Promise<UsuarioResponseDto> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
      include: {
        usuarioRoles: {
          include: { rol: true },
        },
      },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    const roles = usuario.usuarioRoles.map((ur) => ur.rol.nombre);

    return plainToInstance(UsuarioResponseDto, {
      ...usuario,
      roles,
    });
  }

  /**
   * Genera un token seguro para recuperación de contraseña (SEC-01).
   * Reglas de Seguridad:
   * - Retorno genérico e idéntico sin importar si el usuario existe (previene enumeración).
   * - Token criptográfico SHA-256 de un solo uso con expiración de 15 minutos.
   * - Invalida tokens previos pendientes del usuario.
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<{ message: string; debugToken?: string }> {
    const genericResponse = {
      message:
        'Si el correo electrónico está registrado, recibirás un enlace con instrucciones para restablecer tu contraseña.',
    };

    const usuario = await this.prisma.usuario.findUnique({
      where: { correo: dto.correo.toLowerCase().trim() },
    });

    if (!usuario || usuario.estadoCuenta !== 'ACTIVO') {
      return genericResponse;
    }

    // Invalidar tokens previos no utilizados para este usuario
    await this.prisma.tokenRecuperacion.updateMany({
      where: { usuarioId: usuario.id, usado: false },
      data: { usado: true },
    });

    // Generar token seguro criptográfico
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiraAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    await this.prisma.tokenRecuperacion.create({
      data: {
        usuarioId: usuario.id,
        tokenHash,
        expiraAt,
        usado: false,
      },
    });

    // Registrar notificación en la base de datos
    await this.prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        canal: 'EMAIL',
        tipo: 'RECUPERACION_PASSWORD',
        contenido: `Has solicitado restablecer tu contraseña. Utiliza el siguiente token en los próximos 15 minutos: ${rawToken}`,
        estado: 'PENDIENTE',
      },
    });

    this.logger.log(
      `Solicitud de recuperación de contraseña generada para usuario ${usuario.id} (${usuario.correo})`,
    );

    return {
      ...genericResponse,
      ...(process.env.NODE_ENV !== 'production' && { debugToken: rawToken }),
    };
  }

  /**
   * Valida el token de recuperación y actualiza la contraseña del usuario (SEC-01).
   * Reglas de Seguridad:
   * - Valida hash SHA-256 del token, expiración y uso previo.
   * - Transacción atómica que actualiza la contraseña, quema el token y registra auditoría.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(dto.token.trim())
      .digest('hex');

    const tokenRecord = await this.prisma.tokenRecuperacion.findUnique({
      where: { tokenHash },
      include: { usuario: true },
    });

    if (!tokenRecord || tokenRecord.usado) {
      throw new BadRequestException(
        'El enlace de recuperación es inválido o ya ha sido utilizado.',
      );
    }

    if (tokenRecord.expiraAt < new Date()) {
      throw new BadRequestException(
        'El enlace de recuperación ha expirado. Por favor solicita uno nuevo.',
      );
    }

    if (tokenRecord.usuario.estadoCuenta !== 'ACTIVO') {
      throw new BadRequestException('La cuenta de usuario asociada no está activa.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, this.BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      // 1. Actualizar contraseña del usuario
      await tx.usuario.update({
        where: { id: tokenRecord.usuarioId },
        data: { passwordHash },
      });

      // 2. Marcar token como consumido
      await tx.tokenRecuperacion.update({
        where: { id: tokenRecord.id },
        data: { usado: true },
      });

      // 3. Registrar auditoría de seguridad
      await tx.auditoria.create({
        data: {
          usuarioId: tokenRecord.usuarioId,
          accion: 'RECUPERACION_PASSWORD_EXITOSA',
          entidad: 'Usuario',
          entidadId: tokenRecord.usuarioId,
          contexto: {
            tokenId: tokenRecord.id,
            fecha: new Date().toISOString(),
          },
        },
      });
    });

    this.logger.log(
      `Contraseña restablecida exitosamente para el usuario ${tokenRecord.usuarioId}`,
    );

    return {
      message:
        'Tu contraseña ha sido restablecida exitosamente. Ya puedes iniciar sesión con tu nueva credencial.',
    };
  }
}

