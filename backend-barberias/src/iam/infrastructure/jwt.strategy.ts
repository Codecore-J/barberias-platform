import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { JwtPayload, UsuarioAutenticado } from '../domain/jwt.interface.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      // El token se extrae del header: Authorization: Bearer <token>
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'default-secret-change-in-production',
    });
  }

  /**
   * Se ejecuta en cada request protegido.
   * Verifica que el usuario siga existiendo y esté ACTIVO.
   * Carga en tiempo real los roles asignados con su respectivo scope de barbería.
   */
  async validate(payload: JwtPayload): Promise<UsuarioAutenticado> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        correo: true,
        estadoCuenta: true,
        usuarioRoles: {
          select: {
            barberiaId: true,
            rol: {
              select: {
                nombre: true,
                ambito: true,
              },
            },
          },
        },
      },
    });

    if (!usuario || usuario.estadoCuenta !== 'ACTIVO') {
      throw new UnauthorizedException('La sesión no es válida o la cuenta está inactiva.');
    }

    const rolesDetallados = usuario.usuarioRoles.map((ur) => ({
      nombre: ur.rol.nombre,
      barberiaId: ur.barberiaId,
      ambito: ur.rol.ambito,
    }));

    const rolesUnicos = Array.from(new Set(usuario.usuarioRoles.map((ur) => ur.rol.nombre)));

    return {
      id: usuario.id,
      correo: usuario.correo,
      roles: rolesUnicos.length > 0 ? rolesUnicos : payload.roles,
      rolesDetallados,
    };
  }
}
