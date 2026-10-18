import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../../auth/auth.service';
import { PARAM_RETURN_URL, returnUrlSeguro } from '../utils/return-url.util';

/**
 * H75 · el guard no solo manda al login: tiene que decir A DÓNDE iba la
 * persona. El destino se comprueba sobre un `Router` real (con
 * `provideRouter([])`), no sobre un doble, porque lo que importa es que el
 * valor sobreviva a la creación del `UrlTree`: un doble que devuelva
 * `{ tree: [...] }` no probaría nada del viaje.
 */
function interceptar(url: string) {
  return TestBed.runInInjectionContext(() =>
    authGuard({} as never, { url } as RouterStateSnapshot),
  );
}

describe('authGuard · H75 (la ruta pedida sobrevive al login)', () => {
  let sesion: { autenticado: boolean; token: string | null };

  beforeEach(() => {
    sesion = { autenticado: false, token: null };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            authState: () => ({
              user: null,
              isAuthenticated: sesion.autenticado,
              isLoading: false,
              error: null,
            }),
            getToken: () => sesion.token,
          },
        },
      ],
    });
  });

  it('deja pasar a quien ya tiene sesión', () => {
    sesion.autenticado = true;
    expect(interceptar('/unirse/imperial-ab12')).toBe(true);
  });

  it('deja pasar a quien tiene token aunque el /me todavía no haya respondido', () => {
    sesion.token = 'token-en-local-storage';
    expect(interceptar('/unirse/imperial-ab12')).toBe(true);
  });

  it('manda al login y guarda la ruta pedida en returnUrl', () => {
    const resultado = interceptar('/unirse/imperial-ab12');

    expect(resultado instanceof UrlTree).toBe(true);
    const arbol = resultado as UrlTree;
    expect(arbol.root.children['primary'].segments.map((s) => s.path)).toEqual([
      'auth',
      'login',
    ]);
    expect(arbol.queryParams[PARAM_RETURN_URL]).toBe('/unirse/imperial-ab12');
  });

  it('conserva la query y el fragmento de la ruta pedida', () => {
    const pedida = '/reservar?sede=imperial&paso=2#horarios';
    const arbol = interceptar(pedida) as UrlTree;

    expect(arbol.queryParams[PARAM_RETURN_URL]).toBe(pedida);
  });

  it('la ruta no se pierde al codificar la URL de login y sigue siendo válida al volver', () => {
    const router = TestBed.inject(Router);
    const arbol = interceptar('/unirse/imperial-ab12') as UrlTree;

    const urlDelLogin = router.serializeUrl(arbol);
    expect(urlDelLogin.startsWith('/auth/login')).toBe(true);

    // El viaje de ida y vuelta: lo que el login leerá de la barra de direcciones
    // es exactamente la ruta que se interceptó, y la lista blanca la acepta.
    const devuelta = router.parseUrl(urlDelLogin).queryParams[PARAM_RETURN_URL];
    expect(devuelta).toBe('/unirse/imperial-ab12');
    expect(returnUrlSeguro(devuelta)).toBe('/unirse/imperial-ab12');
  });
});
