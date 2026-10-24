import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ROL_BARBERO } from '../../iam/domain/roles.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * D16 corregido: el catálogo (servicios y combos) lo ESCRIBE el BARBERO.
 *
 * `RolesGuard` concede al `ADMINISTRADOR` global acceso transversal a cualquier
 * `@Roles` por la jerarquía de E1-04, así que `@Roles('BARBERO')` por sí solo no
 * bastaba: el admin global habría llegado igualmente al servicio y escrito. Y el
 * `ADMIN_BARBERIA` sí quedaba fuera, pero por el motivo equivocado —el rol, no
 * la regla de negocio—.
 *
 * Este guard, que se ejecuta DESPUÉS de los globales, exige el rol literal sin
 * jerarquías: administrar plataforma no es administrar el trabajo de un barbero.
 * La lectura no lo lleva: los administradores siguen supervisando el catálogo.
 */
@Injectable()
export class SoloBarberoGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request?.user as UsuarioAutenticado | undefined;

    if (user?.roles?.includes(ROL_BARBERO)) {
      return true;
    }

    throw new ForbiddenException(
      'El catálogo lo gestiona el BARBERO de la sede: los administradores solo pueden consultarlo.',
    );
  }
}
