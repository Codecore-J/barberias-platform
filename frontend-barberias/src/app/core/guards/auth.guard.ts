import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import type { UsuarioResponseDto } from '../../auth/interfaces/auth.interface';
import { PARAM_RETURN_URL } from '../utils/return-url.util';

/**
 * Guard principal de sesión.
 *
 * Hace dos cosas, en este orden:
 *
 *  1. Sin token se va al login, con la ruta pedida en la query (H75).
 *  2. V2.1 · con sesión pero `telefonoVerificado === false`, se manda a
 *     `/auth/verify` antes de entrar en el panel. El backend ya no deja
 *     reservar a un teléfono sin confirmar (`VerificacionGuard` responde 403
 *     `VERIFICACION_TELEFONO_REQUERIDA`); el guard es la parte visible: llegar
 *     al formulario de reserva para recibir un 403 sería peor experiencia que
 *     resolverlo al entrar.
 *
 * `/auth/verify` NO se protege con este guard a propósito: si lo hiciera, un
 * usuario sin verificar reenviaría la navegación a la misma URL en bucle. Esa
 * pantalla comprueba por su cuenta que haya token y redirige al login si no.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.authState().isAuthenticated && !authService.getToken()) {
    // H75 · la ruta pedida viaja CON la redirección. Antes se descartaba y, al
    // volver del login, `AuthService` aplicaba el destino por rol: quien escaneó
    // el QR de una sede acababa en el dashboard, con el enlace perdido.
    //
    // Va como query y no como `NavigationExtras.state` a propósito: el estado de
    // navegación vive solo en memoria de esa navegación, así que una recarga del
    // formulario de login (o abrirlo en otra pestaña) lo borraría; la query
    // sobrevive y `returnUrlSeguro` la valida al volver, porque también se puede
    // escribir a mano.
    return router.createUrlTree(['/auth/login'], {
      queryParams: { [PARAM_RETURN_URL]: state.url },
    });
  }

  /** V2.1 · destino con el que se retoma la ruta pedida tras verificar el código. */
  const aVerificacion = () =>
    router.createUrlTree(['/auth/verify'], {
      queryParams: { [PARAM_RETURN_URL]: state.url },
    });

  const decidir = (usuario: UsuarioResponseDto | null): boolean | ReturnType<typeof aVerificacion> => {
    if (usuario && !usuario.telefonoVerificado) {
      return aVerificacion();
    }
    return true;
  };

  const usuario = authService.authState().user;
  if (usuario) {
    return decidir(usuario);
  }

  // F5 con token: `user` aún es null porque `checkSession()` no respondió. Se
  // espera la hidratación compartida (la MISMA petición `GET /me` que ya
  // disparó el AuthService, sin duplicarla gracias al `shareReplay`) y recién
  // entonces se decide, igual que hace `roleGuard`.
  if (authService.getToken()) {
    return authService.cargarSesion().pipe(map(decidir));
  }

  return true;
};
