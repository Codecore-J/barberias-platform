import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { OperadorBarberiaGuard } from './operador-barberia.guard.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * Regla de escritura del catálogo (D16, Especificación §2/§3.1):
 *
 *   BARBERO ✅ · ADMIN_BARBERIA ✅ · ADMINISTRADOR ❌ · CLIENTE ❌
 *
 * El caso del ADMINISTRADOR es el que importa: `RolesGuard` le concede acceso
 * transversal por jerarquía (E1-04), así que este guard es el que hace efectivo
 * su 403.
 */
function contexto(user: Partial<UsuarioAutenticado> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('OperadorBarberiaGuard', () => {
  const guard = new OperadorBarberiaGuard();

  it.each(['BARBERO', 'ADMIN_BARBERIA'])('deja escribir al %s', (rol) => {
    expect(guard.canActivate(contexto({ id: 'u1', roles: [rol] }))).toBe(true);
  });

  it.each(['ADMINISTRADOR', 'CLIENTE'])(
    'deniega a %s aunque el RolesGuard global lo dejara pasar',
    (rol) => {
      expect(() => guard.canActivate(contexto({ id: 'u1', roles: [rol] }))).toThrow(
        ForbiddenException,
      );
    },
  );

  it('acepta a quien tiene BARBERO junto con otro rol', () => {
    expect(guard.canActivate(contexto({ id: 'u1', roles: ['ADMINISTRADOR', 'BARBERO'] }))).toBe(
      true,
    );
  });

  it('deniega sin sesión', () => {
    expect(() => guard.canActivate(contexto(undefined))).toThrow(ForbiddenException);
  });
});
