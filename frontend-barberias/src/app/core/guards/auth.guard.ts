import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { PARAM_RETURN_URL } from '../utils/return-url.util';

export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.authState().isAuthenticated || authService.getToken()) {
    return true;
  }

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
};
