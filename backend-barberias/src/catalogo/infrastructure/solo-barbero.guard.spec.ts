import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SoloBarberoGuard } from './solo-barbero.guard.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * `RolesGuard` concede al ADMINISTRADOR global acceso transversal a cualquier
 * `@Roles` (E1-04). La regla del catálogo (D16 corregido) dice que solo el
 * BARBERO lo escribe, así que este guard es el que hace efectivo el 403 de los
 * administradores. Sin él, `@Roles('BARBERO')` no bastaría.
 */
function contexto(user: Partial<UsuarioAutenticado> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('SoloBarberoGuard', () => {
  const guard = new SoloBarberoGuard();

  it('deja pasar al BARBERO', () => {
    expect(guard.canActivate(contexto({ id: 'u1', roles: ['BARBERO'] }))).toBe(true);
  });

  it('deja pasar a quien tiene BARBERO entre sus roles', () => {
    expect(guard.canActivate(contexto({ id: 'u1', roles: ['ADMINISTRADOR', 'BARBERO'] }))).toBe(
      true,
    );
  });

  it.each([['ADMINISTRADOR'], ['ADMIN_BARBERIA'], ['CLIENTE']])(
    'deniega a %s aunque el RolesGuard global lo dejara pasar',
    (rol) => {
      expect(() => guard.canActivate(contexto({ id: 'u1', roles: [rol] }))).toThrow(
        ForbiddenException,
      );
    },
  );

  it('deniega sin sesión', () => {
    expect(() => guard.canActivate(contexto(undefined))).toThrow(ForbiddenException);
  });
});
