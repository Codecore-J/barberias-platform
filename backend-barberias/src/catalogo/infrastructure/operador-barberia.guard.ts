import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ROL_ADMIN_BARBERIA, ROL_BARBERO } from '../../iam/domain/roles.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * Roles que OPERAN el catálogo de una sede (D16, Especificación §2/§3.1).
 *
 * En V1 el catálogo pertenece a la BARBERÍA y lo mantiene su personal: el
 * BARBERO y el ADMIN_BARBERIA —en la práctica el único responsable/operador de
 * la sede en muchos casos—. El ADMINISTRADOR de plataforma solo supervisa y el
 * CLIENTE solo compra.
 */
export const ROLES_OPERADOR_CATALOGO = [ROL_BARBERO, ROL_ADMIN_BARBERIA] as const;

/**
 * `RolesGuard` concede al ADMINISTRADOR global acceso transversal a cualquier
 * `@Roles` por la jerarquía de E1-04, así que `@Roles('BARBERO',
 * 'ADMIN_BARBERIA')` por sí solo no bloquea al admin de plataforma. Este guard,
 * que corre después de los globales, exige uno de los roles de operación sin
 * jerarquías: administrar la plataforma no es administrar el catálogo de una
 * sede.
 *
 * La lectura no lo lleva: los administradores siguen supervisando el catálogo,
 * y el CLIENTE sigue viendo la vitrina pública.
 */
@Injectable()
export class OperadorBarberiaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request?.user as UsuarioAutenticado | undefined;

    const esOperador = user?.roles?.some((rol) =>
      (ROLES_OPERADOR_CATALOGO as readonly string[]).includes(rol),
    );

    if (esOperador) {
      return true;
    }

    throw new ForbiddenException(
      'El catálogo lo gestionan el BARBERO y el ADMIN_BARBERIA de la sede: el ADMINISTRADOR global y el CLIENTE solo pueden consultarlo.',
    );
  }
}
