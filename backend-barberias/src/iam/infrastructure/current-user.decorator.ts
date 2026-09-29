import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UsuarioAutenticado } from '../domain/jwt.interface.js';

/**
 * Decorador de parámetro para inyectar el usuario autenticado desde `req.user`.
 *
 * Ejemplos:
 * ```ts
 * @Get('perfil')
 * obtenerPerfil(@CurrentUser() usuario: UsuarioAutenticado) { ... }
 *
 * @Get('id')
 * obtenerId(@CurrentUser('id') usuarioId: string) { ... }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: keyof UsuarioAutenticado | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: UsuarioAutenticado = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
