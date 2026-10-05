import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RolesGuard } from './roles.guard.js';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ROLES_KEY } from './roles.decorator.js';
import { AUTENTICADO_KEY } from './autenticado.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/** Metadatos que el guard puede leer de un handler o de su controlador. */
type Politica = {
  isPublic?: boolean;
  autenticado?: boolean;
  roles?: string[];
};

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  /** Simula la metadata declarada por la ruta, clave a clave. */
  function mockPolitica(politica: Politica): void {
    const valores: Record<string, unknown> = {
      [IS_PUBLIC_KEY]: politica.isPublic,
      [AUTENTICADO_KEY]: politica.autenticado,
      [ROLES_KEY]: politica.roles,
    };
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
      (key: unknown) => valores[key as string],
    );
  }

  function createMockContext(user: any, params: any = {}, headers: any = {}): ExecutionContext {
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: () => ({
          user,
          params,
          headers,
          method: 'GET',
          originalUrl: '/api/v1/ruta-sin-decorador',
        }),
      }),
    } as any;
  }

  describe('E1-01: politica declarada', () => {
    it('debe denegar una ruta sin @Public, @Autenticado ni @Roles', () => {
      mockPolitica({});
      const context = createMockContext({ id: '1', correo: 'c@barber.com', roles: ['CLIENTE'] });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('debe permitir una ruta con @Autenticado', () => {
      mockPolitica({ autenticado: true });
      const context = createMockContext({ id: '1', correo: 'c@barber.com', roles: ['CLIENTE'] });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('debe permitir una ruta con @Roles si el usuario tiene ese rol', () => {
      mockPolitica({ roles: ['BARBERO', 'ADMINISTRADOR'] });
      const context = createMockContext({
        id: '1',
        correo: 'barbero@barber.com',
        roles: ['BARBERO'],
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('debe denegar una ruta con @Roles si el usuario no tiene ninguno', () => {
      mockPolitica({ roles: ['BARBERO', 'ADMINISTRADOR'] });
      const context = createMockContext({
        id: '1',
        correo: 'cliente@barber.com',
        roles: ['CLIENTE'],
      });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('debe dejar pasar una ruta @Public aunque no tenga roles', () => {
      mockPolitica({ isPublic: true });
      const context = createMockContext(undefined);

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('logistica de roles y tenant (sin cambios en E1-01)', () => {
    it('debe permitir acceso si el usuario es ADMINISTRADOR global', () => {
      mockPolitica({ roles: ['BARBERO'] });
      const context = createMockContext({
        id: '1',
        correo: 'admin@barber.com',
        roles: ['ADMINISTRADOR'],
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('debe permitir acceso a un BARBERO en su propia barbería específica', () => {
      mockPolitica({ roles: ['BARBERO'] });
      const barberiaId = 'barberia-uuid-123';
      const context = createMockContext(
        {
          id: '1',
          correo: 'barbero@barber.com',
          roles: ['BARBERO'],
          rolesDetallados: [
            { nombre: 'BARBERO', barberiaId: 'barberia-uuid-123', ambito: 'BARBERIA' },
          ],
        },
        { barberiaId },
      );

      expect(guard.canActivate(context)).toBe(true);
    });

    it('debe rechazar a un BARBERO si intenta acceder a otra barbería donde no tiene rol', () => {
      mockPolitica({ roles: ['BARBERO'] });
      const context = createMockContext(
        {
          id: '1',
          correo: 'barbero@barber.com',
          roles: ['BARBERO'],
          rolesDetallados: [
            { nombre: 'BARBERO', barberiaId: 'barberia-uuid-123', ambito: 'BARBERIA' },
          ],
        },
        { barberiaId: 'otra-barberia-distinta-456' },
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('E1-04: el comodín nulo solo aplica a roles de ámbito GLOBAL', () => {
    it('debe rechazar a un ADMIN_BARBERIA con barberiaId nulo (ya no es comodín)', () => {
      mockPolitica({ roles: ['ADMIN_BARBERIA'] });
      const context = createMockContext(
        {
          id: '1',
          correo: 'admin@barber.com',
          roles: ['ADMIN_BARBERIA'],
          rolesDetallados: [
            { nombre: 'ADMIN_BARBERIA', barberiaId: null, ambito: 'BARBERIA' },
          ],
        },
        { barberiaId: 'barberia-ajena-789' },
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('debe rechazar a un BARBERO con barberiaId nulo (ya no es comodín)', () => {
      mockPolitica({ roles: ['BARBERO'] });
      const context = createMockContext(
        {
          id: '1',
          correo: 'barbero@barber.com',
          roles: ['BARBERO'],
          rolesDetallados: [{ nombre: 'BARBERO', barberiaId: null, ambito: 'BARBERIA' }],
        },
        { barberiaId: 'barberia-ajena-789' },
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('debe seguir dejando pasar a un ADMINISTRADOR de ámbito GLOBAL con barberiaId nulo', () => {
      mockPolitica({ roles: ['ADMIN_BARBERIA'] });
      const context = createMockContext(
        {
          id: '1',
          correo: 'global@barber.com',
          roles: ['ADMINISTRADOR'],
          rolesDetallados: [{ nombre: 'ADMINISTRADOR', barberiaId: null, ambito: 'GLOBAL' }],
        },
        { barberiaId: 'barberia-ajena-789' },
      );

      expect(guard.canActivate(context)).toBe(true);
    });
  });
});