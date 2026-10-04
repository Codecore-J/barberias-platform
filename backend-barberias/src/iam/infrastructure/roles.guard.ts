import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator.js';
import { AUTENTICADO_KEY } from './autenticado.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { UsuarioAutenticado } from '../domain/jwt.interface.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const objetivos = [context.getHandler(), context.getClass()];

    // @Public(): lo resuelve el JwtAuthGuard, aqui no hay nada que decidir.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, objetivos) === true) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, objetivos);

    // @Autenticado(): cualquier usuario con sesion, sin exigir rol concreto.
    if (this.reflector.getAllAndOverride<boolean>(AUTENTICADO_KEY, objetivos) === true) {
      return true;
    }

    // Sin @Public, @Autenticado ni @Roles, la ruta no declara su politica y
    // falla cerrado (E1-01). Antes devolvia true y dejaba la ruta abierta a
    // cualquier usuario con sesion.
    if (!requiredRoles || requiredRoles.length === 0) {
      const request = context.switchToHttp().getRequest();
      const ruta = `${request?.method ?? '?'} ${request?.originalUrl ?? request?.url ?? '?'}`;
      new Logger(RolesGuard.name).warn(
        `Ruta sin politica de acceso declarada, denegada: ${ruta}`,
      );
      throw new ForbiddenException(
        'Acceso denegado: la ruta no declara su politica de acceso.',
      );
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
