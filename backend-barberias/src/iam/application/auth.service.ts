import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { UsuarioResponseDto } from './dto/usuario-response.dto.js';
import { JwtPayload } from '../domain/jwt.interface.js';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
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
   * - Si la cuenta no está ACTIVO → UnauthorizedException (mismo mensaje genérico).
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
    if (usuario.estadoCuenta !== 'ACTIVO') throw errorGenerico;

    // Comparación timing-safe del hash
    const passwordValido = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!passwordValido) throw errorGenerico;

    // Construir payload del JWT
    const roles = usuario.usuarioRoles.map((ur) => ur.rol.nombre);
    const payload: JwtPayload = {
      sub: usuario.id,
      correo: usuario.correo,
      roles,
    };

    const accessToken = this.jwtService.sign(payload);

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
}
