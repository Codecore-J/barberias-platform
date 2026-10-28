import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { of, firstValueFrom, type Observable } from 'rxjs';
import { authGuard } from './auth.guard';
import { AuthService } from '../../auth/auth.service';
import type { UsuarioResponseDto } from '../../auth/interfaces/auth.interface';
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
  let sesion: {
    autenticado: boolean;
    token: string | null;
    usuario: UsuarioResponseDto | null;
  };

  beforeEach(() => {
    sesion = { autenticado: false, token: null, usuario: null };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            authState: () => ({
              user: sesion.usuario,
              isAuthenticated: sesion.autenticado,
              isLoading: false,
              error: null,
            }),
            getToken: () => sesion.token,
            // V2.1 · el guard espera esta hidratación cuando hay token pero
            // el usuario todavía no llegó (F5). En el doble devuelve `null`,
            // que el guard interpreta como «sin datos todavía, deja pasar».
            cargarSesion: () => of(sesion.usuario),
          },
        },
      ],
    });
  });

  /** Usuario hidratado con el teléfono en el estado indicado. */
  const usuarioCon = (telefonoVerificado: boolean | undefined): UsuarioResponseDto => ({
    id: 'u1',
    correo: 'cliente@demo.com',
    nombreCompleto: 'Cliente Demo',
    telefono: '8095550199',
    estadoCuenta: 'ACTIVO',
    roles: ['CLIENTE'],
    telefonoVerificado,
  });

  it('V2.1 · manda a /auth/verify a quien tiene sesión sin teléfono verificado', () => {
    sesion.autenticado = true;
    sesion.token = 'token-en-local-storage';
    sesion.usuario = usuarioCon(false);

    const resultado = interceptar('/unirse/imperial-ab12');

    expect(resultado instanceof UrlTree).toBe(true);
    const arbol = resultado as UrlTree;
    expect(arbol.root.children['primary'].segments.map((s) => s.path)).toEqual([
      'auth',
      'verify',
    ]);
    expect(arbol.queryParams[PARAM_RETURN_URL]).toBe('/unirse/imperial-ab12');
  });

  it('V2.1 · deja pasar a quien ya tiene el teléfono verificado', () => {
    sesion.autenticado = true;
    sesion.token = 'token-en-local-storage';
    sesion.usuario = usuarioCon(true);

    expect(interceptar('/unirse/imperial-ab12')).toBe(true);
  });

  it('V2.1 · el personal de la sede sin teléfono verificado NO va a /auth/verify', () => {
    // Su cuenta la crea la plataforma o `npm run admin:create`, sin teléfono
    // confirmado: mandarla a verificar le cerraría su propio panel.
    sesion.autenticado = true;
    sesion.token = 'token-en-local-storage';
    sesion.usuario = { ...usuarioCon(false), roles: ['ADMINISTRADOR'] };

    expect(interceptar('/admin/usuarios')).toBe(true);
  });

  it('V2.1 · sin rol alguno sí se verifica: es una cuenta recién registrada', () => {
    sesion.autenticado = true;
    sesion.token = 'token-en-local-storage';
    sesion.usuario = { ...usuarioCon(false), roles: [] };

    const resultado = interceptar('/reservar');

    expect(resultado instanceof UrlTree).toBe(true);
    expect((resultado as UrlTree).root.children['primary'].segments.map((s) => s.path)).toEqual([
      'auth',
      'verify',
    ]);
  });

  it('deja pasar a quien ya tiene sesión', () => {
    sesion.autenticado = true;
    expect(interceptar('/unirse/imperial-ab12')).toBe(true);
  });

  it('deja pasar a quien tiene token aunque el /me todavía no haya respondido', async () => {
    sesion.token = 'token-en-local-storage';
    const resultado = interceptar('/unirse/imperial-ab12');

    // V2.1 · ya no devuelve `true` al instante: con token pero sin usuario
    // cargado, el guard ESPERA la hidratación compartida para poder mirar
    // `telefonoVerificado`. Lo que no puede hacer es mandar a login —ese era
    // el fallo H75 que cubría esta prueba— así que el resultado no es un UrlTree.
    expect(resultado instanceof UrlTree).toBe(false);
    expect(await firstValueFrom(resultado as Observable<boolean | UrlTree>)).toBe(true);
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
