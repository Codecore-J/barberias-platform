import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './interfaces/auth.interface';
import { TenantService } from '../core/services/tenant.service';
import { API_URL } from '../core/constants/api.constants.js';
import { PARAM_RETURN_URL } from '../core/utils/return-url.util';

/**
 * H75 · al volver del login, el destino pedido manda sobre el destino por rol.
 *
 * El caso que motivó la corrección: alguien escanea el QR de una sede (regla
 * 1.10), no tiene sesión, el `authGuard` lo manda al login y —al entrar— este
 * servicio aplicaba la regla por rol, así que el cliente acababa en el
 * dashboard con la invitación perdida.
 *
 * Aquí se fija lo que el servicio decide y lo que NO decide:
 *
 *  - con un `returnUrl` válido se navega a ESA ruta (aunque el rol tuviera otro
 *    destino por defecto);
 *  - con un `returnUrl` inválido (`https://otro-sitio`, `//otro-sitio`, la
 *    propia pantalla de login) se cae al destino por rol, que es la red de
 *    seguridad contra el open redirect;
 *  - sin `returnUrl` nada cambia respecto de antes (cliente → `/`, admin con
 *    sede → `/admin/agenda`).
 *
 * El `Router` es el REAL (spy sobre `navigate`/`navigateByUrl`), para no atar la
 * prueba a la forma exacta con que se navega.
 */
describe('AuthService · H75 (el destino pedido sobrevive al login)', () => {
  let http: HttpTestingController;
  let servicio: AuthService;
  let router: Router;
  let sedesDelUsuario: { id: string }[];

  const respuesta = (roles: string[]): AuthResponseDto => ({
    accessToken: 'token-de-prueba',
    usuario: {
      id: 'u1',
      correo: 'quien@demo.com',
      nombreCompleto: 'Quien Sea',
      telefono: '3000000000',
      estadoCuenta: 'ACTIVO',
      roles,
    },
  });

  const responderLogin = (roles: string[]) =>
    http.expectOne(`${API_URL}/auth/login`).flush(respuesta(roles));

  beforeEach(() => {
    localStorage.clear();
    sedesDelUsuario = [];

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: TenantService,
          useValue: { cargarBarberias: () => of(sedesDelUsuario) },
        },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    servicio = TestBed.inject(AuthService);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('vuelve a la ruta pedida cuando el login trae un returnUrl válido', () => {
    servicio
      .login({ correo: 'cliente@demo.com', password: 'x' }, '/unirse/imperial-ab12')
      .subscribe();

    responderLogin(['CLIENTE']);

    expect(servicio.getToken()).toBe('token-de-prueba');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/unirse/imperial-ab12');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('el destino pedido manda sobre el destino por rol', () => {
    sedesDelUsuario = [{ id: 'b1' }];

    servicio
      .login({ correo: 'admin@demo.com', password: 'x' }, '/unirse/imperial-ab12')
      .subscribe();

    responderLogin(['ADMIN_BARBERIA']);

    expect(router.navigateByUrl).toHaveBeenCalledWith('/unirse/imperial-ab12');
    expect(router.navigate).not.toHaveBeenCalledWith(['/admin/agenda']);
  });

  it('conserva la query de la ruta pedida', () => {
    servicio
      .login({ correo: 'cliente@demo.com', password: 'x' }, '/unirse/imperial-ab12?desde=qr')
      .subscribe();

    responderLogin(['CLIENTE']);

    expect(router.navigateByUrl).toHaveBeenCalledWith('/unirse/imperial-ab12?desde=qr');
  });

  it('sin returnUrl el cliente sigue yendo al dashboard', () => {
    servicio.login({ correo: 'cliente@demo.com', password: 'x' }).subscribe();

    responderLogin(['CLIENTE']);

    expect(router.navigate).toHaveBeenCalledWith(['/']);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('sin returnUrl el admin con sede sigue yendo a su agenda', () => {
    sedesDelUsuario = [{ id: 'b1' }];

    servicio.login({ correo: 'admin@demo.com', password: 'x' }).subscribe();

    responderLogin(['ADMINISTRADOR']);

    expect(router.navigate).toHaveBeenCalledWith(['/admin/agenda']);
  });

  it('un returnUrl de otro sitio NO se usa: cae al destino por rol (anti open redirect)', () => {
    servicio
      .login({ correo: 'cliente@demo.com', password: 'x' }, 'https://otro-sitio.example')
      .subscribe();

    responderLogin(['CLIENTE']);

    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('un returnUrl relativo al protocolo tampoco se usa', () => {
    servicio
      .login({ correo: 'cliente@demo.com', password: 'x' }, '//otro-sitio.example')
      .subscribe();

    responderLogin(['CLIENTE']);

    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('volver al login tras entrar sería un bucle, así que no se usa', () => {
    servicio
      .login({ correo: 'cliente@demo.com', password: 'x' }, '/auth/login')
      .subscribe();

    responderLogin(['CLIENTE']);

    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('el registro manda a la verificación y conserva el destino pedido', () => {
    servicio
      .register(
        { correo: 'nuevo@demo.com', password: 'x', nombreCompleto: 'Nuevo', telefono: '300' },
        '/unirse/imperial-ab12',
      )
      .subscribe();

    http.expectOne(`${API_URL}/auth/register`).flush(respuesta(['CLIENTE']));

    // V2.1 · la cuenta nueva entra primero por /auth/verify: sin teléfono
    // confirmado el backend devuelve 403 en la creación de reservas.
    expect(router.navigate).toHaveBeenCalledWith(['/auth/verify'], {
      queryParams: { [PARAM_RETURN_URL]: '/unirse/imperial-ab12' },
    });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('sin destino, el registro va a la verificación sin query', () => {
    servicio
      .register({
        correo: 'nuevo@demo.com',
        password: 'x',
        nombreCompleto: 'Nuevo',
        telefono: '300',
      })
      .subscribe();

    http.expectOne(`${API_URL}/auth/register`).flush(respuesta(['CLIENTE']));

    expect(router.navigate).toHaveBeenCalledWith(['/auth/verify'], { queryParams: {} });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
