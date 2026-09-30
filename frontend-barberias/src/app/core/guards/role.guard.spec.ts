import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { roleGuard } from './role.guard';
import { AuthService } from '../../auth/auth.service';

describe('roleGuard', () => {
  let mockAuthService: { authState: () => any };
  let mockRouter: { createUrlTree: (commands: any[]) => any };

  beforeEach(() => {
    mockAuthService = {
      authState: () => ({ user: null })
    };
    mockRouter = {
      createUrlTree: (commands: any[]) => ({ tree: commands })
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter }
      ]
    });
  });

  it('debe redirigir a /auth/login si no hay usuario autenticado', () => {
    mockAuthService.authState = () => ({ user: null });
    const guard = roleGuard(['ADMIN']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );
    expect(result).toEqual({ tree: ['/auth/login'] });
  });

  it('debe permitir acceso si el usuario tiene rol ADMINISTRADOR y se requiere ADMIN', () => {
    mockAuthService.authState = () => ({
      user: { id: '1', correo: 'admin@demo.com', roles: ['CLIENTE', 'ADMINISTRADOR'] }
    });
    const guard = roleGuard(['ADMIN']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );
    expect(result).toBe(true);
  });

  it('debe permitir acceso si el usuario tiene rol ADMIN_BARBERIA y se requiere ADMIN', () => {
    mockAuthService.authState = () => ({
      user: { id: '2', correo: 'owner@test.com', roles: ['ADMIN_BARBERIA'] }
    });
    const guard = roleGuard(['ADMIN']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );
    expect(result).toBe(true);
  });

  it('debe bloquear a CLIENTE si se requiere ADMIN y redirigir a /', () => {
    mockAuthService.authState = () => ({
      user: { id: '3', correo: 'cliente@demo.com', roles: ['CLIENTE'] }
    });
    const guard = roleGuard(['ADMIN']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );
    expect(result).toEqual({ tree: ['/'] });
  });

  it('debe permitir acceso a BARBERO cuando se requiere [ADMIN, BARBERO]', () => {
    mockAuthService.authState = () => ({
      user: { id: '4', correo: 'barbero@demo.com', roles: ['CLIENTE', 'BARBERO'] }
    });
    const guard = roleGuard(['ADMIN', 'BARBERO']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );
    expect(result).toBe(true);
  });

  it('debe bloquear a CLIENTE cuando se requiere [ADMIN, BARBERO]', () => {
    mockAuthService.authState = () => ({
      user: { id: '5', correo: 'cliente@demo.com', roles: ['CLIENTE'] }
    });
    const guard = roleGuard(['ADMIN', 'BARBERO']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );
    expect(result).toEqual({ tree: ['/'] });
  });

  it('debe bloquear a BARBERO si intenta acceder a rutas exclusivas de ADMIN y redirigirlo a su agenda', () => {
    mockAuthService.authState = () => ({
      user: { id: '6', correo: 'barbero@demo.com', roles: ['CLIENTE', 'BARBERO'] }
    });
    const guard = roleGuard(['ADMIN']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );
    expect(result).toEqual({ tree: ['/admin/agenda'] });
  });
});
