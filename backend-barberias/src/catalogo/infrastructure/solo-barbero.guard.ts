import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ROL_BARBERO } from '../../iam/domain/roles.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * V3 · `mis-servicios` es del BARBERO que inicia sesión, y de nadie más.
 *
 * `RolesGuard` concede al ADMINISTRADOR global cualquier `@Roles` por jerarquía
 * (E1-04) y `VinculoBarberiaGuard` acepta también al ADMIN_BARBERIA de la sede,
 * así que ninguno de los dos impide que la plataforma «publique como» un barbero.
 * Este guard exige el rol BARBERO sin jerarquías: el precio y la duración de un
 * servicio los fija quien lo presta, no quien administra.
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
      'Estos servicios son del barbero que inicia sesión: el ADMINISTRADOR global y el ADMIN_BARBERIA no publican servicios en su nombre.',
    );
  }
}
