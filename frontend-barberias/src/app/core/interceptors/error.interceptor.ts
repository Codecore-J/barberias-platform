import {
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { mensajeParaUsuario } from '../utils/errores';

/**
 * Marca una petición para que su fallo NO se anuncie con un toast.
 *
 * Sirve para las llamadas de fondo (sondeos del layout, precargas) y para las
 * que ya pintan el error dentro de su propio formulario: si el aviso saliera
 * además en la esquina, el usuario vería el mismo mensaje dos veces.
 */
export const SILENCIAR_TOAST = new HttpContextToken<boolean>(() => false);

/**
 * Interceptor global de errores HTTP.
 *
 * El interceptor ya NO redacta mensajes: solo decide SI hay que anunciar y deja
 * el texto en `mensajeParaUsuario()`. Antes tenía su propia rama por estado, una
 * segunda rama especial para 403 que volvía a extraer el mensaje (y colaba el
 * texto crudo del backend dentro del contextual) y ningún filtro de texto
 * técnico, que es justo lo que llegaba a la pantalla.
 *
 * Exclusiones deliberadas:
 *
 *   · 401 — lo gestiona `authInterceptor`, que cierra la sesión y redirige. Un
 *     toast «no autorizado» encima del login solo confundiría.
 *   · `SILENCIAR_TOAST` — llamadas de fondo o formularios con error en línea.
 *
 * El error se re-lanza siempre: el interceptor informa, no se traga la
 * respuesta. Si lo silenciara, un `subscribe(() => this.cerrarModal())` se
 * ejecutaría como si la operación hubiera ido bien.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      const silenciado = req.context.get(SILENCIAR_TOAST);

      // El status 0 (sin red, CORS o servidor caído) también se anuncia: antes
      // se descartaba y la pantalla se quedaba muda sin explicar por qué.
      const anunciable =
        !silenciado && error.status !== 401 && (error.status === 0 || error.status >= 400);

      if (anunciable) {
        const { mensaje, titulo } = mensajeParaUsuario(error);
        toast.error(mensaje, titulo);
      }

      return throwError(() => error);
    }),
  );
};
