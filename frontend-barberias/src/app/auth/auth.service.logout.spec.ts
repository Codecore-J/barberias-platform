import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService, ACCESS_TOKEN_KEY } from './auth.service';
import { TenantService } from '../core/services/tenant.service';
import { API_URL } from '../core/constants/api.constants.js';

/**
 * QA2-02 · el botón «Cerrar sesión» apaga el token en el servidor.
 *
 * El defecto del QA: `logout()` solo borraba `localStorage`; el JWT seguía
 * respondiendo 200 durante 24 h. La corrección llama a `POST /auth/logout`
 * antes de limpiar, y limpia SIEMPRE (red caída, 401) porque la sesión local no
 * puede quedarse abierta esperando a un backend que no contesta.
 */
describe('AuthService · QA2-02 logout', () => {
  let http: HttpTestingController;
  let servicio: AuthService;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: TenantService,
          useValue: { cargarBarberias: vi.fn(() => of([])), registrarPurgadorLocal: vi.fn() },
        },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    // Sin token en el constructor: `checkSession` no dispara GET /me y el único
    // tráfico de estas pruebas es el del logout.
    servicio = TestBed.inject(AuthService);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('pide POST /auth/logout con el token todavía presente y después limpia y navega', () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'token-viejo');

    servicio.logout();

    const peticion = http.expectOne(`${API_URL}/auth/logout`);
    expect(peticion.request.method).toBe('POST');
    // El token se borra DESPUÉS: el interceptor lo lee del almacenamiento para
    // poner el header, así que limpiar antes dejaría el logout sin autenticar.
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('token-viejo');

    peticion.flush(null, { status: 204, statusText: 'No Content' });

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(servicio.authState().isAuthenticated).toBe(false);
    expect(servicio.authState().user).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('si la petición falla, la sesión local se cierra igual', () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'token-viejo');

    servicio.logout();

    http
      .expectOne(`${API_URL}/auth/logout`)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('sin token no llama al backend y limpia localmente', () => {
    servicio.logout();

    http.expectNone(`${API_URL}/auth/logout`);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });
});
