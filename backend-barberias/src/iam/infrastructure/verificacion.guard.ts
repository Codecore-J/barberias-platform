import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';
import { REQUIRE_VERIFICATION_KEY } from './require-verification.decorator.js';
import { errorDePermiso } from '../../shared/errors/d40.errors.js';

/**
 * V2.1 · Bloquea la creación de reservas y el alta en la lista de espera a
 * quien no ha confirmado su teléfono con un código OTP.
 *
 * La bandera sale del USUARIO, no del token: `JwtStrategy.validate` la lee de
 * la base en cada petición, de modo que el valor es el vigente y no el que
 * tenía el cliente cuando firmó el JWT (que podría tener semanas de antigüedad).
 *
 * Solo actúa sobre las rutas marcadas con `@RequireVerification()`: en el resto
 * devuelve `true` sin mirar nada, para que el guard no cambie el significado de
 * ninguna ruta existente.
 */
@Injectable()
export class VerificacionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const marcada = this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFICATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!marcada) return true;

    const request = context.switchToHttp().getRequest<{ user?: UsuarioAutenticado }>();
    const usuario = request.user;

    if (!usuario?.telefonoVerificado) {
      throw errorDePermiso(
        'VERIFICACION_TELEFONO_REQUERIDA',
        'Verifica tu teléfono con el código de 6 dígitos para poder reservar.',
      );
    }

    return true;
  }
}
