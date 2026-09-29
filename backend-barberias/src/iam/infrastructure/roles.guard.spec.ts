import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RolesGuard } from './roles.guard.js';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(user: any, params: any = {}, headers: any = {}): ExecutionContext {
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: () => ({
          user,
          params,
          headers,
        }),
      }),
    } as any;
  }

  it('debe permitir acceso si el endpoint no requiere roles', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({ id: '1', correo: 'test@barber.com', roles: ['CLIENTE'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso si el usuario es ADMINISTRADOR global', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['BARBERO']);
    const context = createMockContext({
      id: '1',
      correo: 'admin@barber.com',
      roles: ['ADMINISTRADOR'],
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe rechazar si el usuario no tiene ninguno de los roles requeridos', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['BARBERO', 'ADMINISTRADOR']);
    const context = createMockContext({
      id: '1',
      correo: 'cliente@barber.com',
      roles: ['CLIENTE'],
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('debe permitir acceso a un BARBERO en su propia barbería específica', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['BARBERO']);
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
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['BARBERO']);
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
