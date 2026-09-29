import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator.js';
import { UsuarioAutenticado } from '../domain/jwt.interface.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si no se declararon roles requeridos, el endpoint está abierto (según su JwtAuthGuard)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: UsuarioAutenticado = request.user;

    if (!user || !user.roles) {
      throw new ForbiddenException('Acceso denegado: usuario no autenticado o sin roles asignados.');
    }

    // Regla de jerarquía: ADMINISTRADOR tiene acceso transversal global
    if (user.roles.includes('ADMINISTRADOR')) {
      return true;
    }

    // Extraer barberiaId del contexto (si aplica a la ruta)
    const barberiaId =
      request.params?.barberiaId ??
      request.headers?.['x-barberia-id'] ??
      request.query?.barberiaId ??
      null;

    // Si la ruta está acotada a una barbería y el usuario tiene roles detallados
    if (barberiaId && user.rolesDetallados && user.rolesDetallados.length > 0) {
      const tieneRolEnBarberia = user.rolesDetallados.some(
        (rd) =>
          requiredRoles.includes(rd.nombre) &&
          (rd.barberiaId === barberiaId || rd.barberiaId === null),
      );

      if (tieneRolEnBarberia) {
        return true;
      }

      throw new ForbiddenException(
        `No posees los permisos requeridos (${requiredRoles.join(', ')}) para esta barbería.`,
      );
    }

    // Validación estándar para roles globales
    const tieneRolGlobal = requiredRoles.some((rol) => user.roles.includes(rol));

    if (!tieneRolGlobal) {
      throw new ForbiddenException(
        `Acceso denegado: se requiere uno de los siguientes roles: ${requiredRoles.join(', ')}.`,
      );
    }

    return true;
  }
}
