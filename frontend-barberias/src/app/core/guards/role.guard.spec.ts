import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { of, firstValueFrom } from 'rxjs';
import { roleGuard } from './role.guard';
import { AuthService } from '../../auth/auth.service';

describe('roleGuard', () => {
  let mockAuthService: {
    authState: () => any;
    getToken: () => string | null;
    cargarSesion: () => any;
  };
  let mockRouter: { createUrlTree: (commands: any[]) => any };

  beforeEach(() => {
    mockAuthService = {
      authState: () => ({ user: null }),
      getToken: () => null,
      cargarSesion: () => of(null),
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
    mockAuthService.getToken = () => null;
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

  // ── H-02 · recarga (F5) con token: esperar la sesión, no redirigir antes ──

  it('H-02: con token y user en null, ESPERA la hidratación y permite si el rol calza', async () => {
    mockAuthService.authState = () => ({ user: null });
    mockAuthService.getToken = () => 'token-valido-en-recarga';
    mockAuthService.cargarSesion = () =>
      of({ id: '7', correo: 'admin@test.com', roles: ['ADMINISTRADOR'] });

    const guard = roleGuard(['ADMINISTRADOR']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );

    // No es un UrlTree sincrónico de login: es una espera de la sesión.
    expect(typeof (result as any).subscribe).toBe('function');
    const valor = await firstValueFrom(result as any);
    expect(valor).toBe(true);
  });

  it('H-02: con token, tras hidratar evalúa los roles (CLIENTE bloqueado a /)', async () => {
    mockAuthService.authState = () => ({ user: null });
    mockAuthService.getToken = () => 'token-valido-en-recarga';
    mockAuthService.cargarSesion = () =>
      of({ id: '8', correo: 'cliente@test.com', roles: ['CLIENTE'] });

    const guard = roleGuard(['ADMIN']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );

    const valor = await firstValueFrom(result as any);
    expect(valor).toEqual({ tree: ['/'] });
  });

  it('H-02: con token, si la sesión resuelve sin usuario va al login', async () => {
    mockAuthService.authState = () => ({ user: null });
    mockAuthService.getToken = () => 'token-expirado-que-falla-en-me';
    mockAuthService.cargarSesion = () => of(null);

    const guard = roleGuard(['ADMIN']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );

    const valor = await firstValueFrom(result as any);
    expect(valor).toEqual({ tree: ['/auth/login'] });
  });

  it('H-02: sin token y sin user no se llama a cargarSesion (respuesta sincrónica)', () => {
    let llamoCargarSesion = false;
    mockAuthService.authState = () => ({ user: null });
    mockAuthService.getToken = () => null;
    mockAuthService.cargarSesion = () => {
      llamoCargarSesion = true;
      return of(null);
    };

    const guard = roleGuard(['ADMIN']);
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );

    expect(llamoCargarSesion).toBe(false);
    expect(result).toEqual({ tree: ['/auth/login'] });
  });
});
