import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { VerificacionGuard } from './verificacion.guard.js';
import { REQUIRE_VERIFICATION_KEY } from './require-verification.decorator.js';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';

/** V2.1 · el guard solo mira dos cosas: si la ruta lo pide y si el usuario está verificado. */
describe('VerificacionGuard', () => {
  let guard: VerificacionGuard;
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };

  const contexto = (user?: UsuarioAutenticado): ExecutionContext =>
    ({
      getHandler: () => Symbol('handler'),
      getClass: () => Symbol('class'),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const marcada = (valor: boolean) => {
    reflector.getAllAndOverride.mockReturnValue(valor);
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    guard = new VerificacionGuard(reflector as never);
  });

  it('consulta la ruta exacta y no exige nada en las rutas sin la marca', () => {
    marcada(false);

    expect(guard.canActivate(contexto({ id: 'u1', correo: 'a@b.c', roles: ['CLIENTE'] }))).toBe(
      true,
    );
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(REQUIRE_VERIFICATION_KEY, [
      expect.any(Symbol),
      expect.any(Symbol),
    ]);
  });

  it('bloquea con 403 cuando la ruta exige verificación y el teléfono no está confirmado', () => {
    marcada(true);

    const llamada = () =>
      guard.canActivate(contexto({ id: 'u1', correo: 'a@b.c', roles: ['CLIENTE'] }));

    expect(llamada).toThrow(ForbiddenException);
    try {
      llamada();
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        statusCode: 403,
        codigo: 'VERIFICACION_TELEFONO_REQUERIDA',
      });
    }
  });

  it('también bloquea si la bandera viene como false explícito', () => {
    marcada(true);

    expect(() =>
      guard.canActivate(
        contexto({ id: 'u1', correo: 'a@b.c', roles: ['CLIENTE'], telefonoVerificado: false }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('deja pasar con el teléfono verificado', () => {
    marcada(true);

    expect(
      guard.canActivate(
        contexto({ id: 'u1', correo: 'a@b.c', roles: ['CLIENTE'], telefonoVerificado: true }),
      ),
    ).toBe(true);
  });
});
