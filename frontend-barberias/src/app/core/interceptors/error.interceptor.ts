import {
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../../shared/ui/toast/toast.service';

/**
 * Fase 1 · marca una petición para que su fallo NO se anuncie con un toast.
 *
 * Sirve para las llamadas de fondo (sondeos del layout, precargas) y para las
 * que ya pintan el error dentro de su propio formulario: si el aviso saliera
 * además en la esquina, el usuario vería el mismo mensaje dos veces.
 */
export const SILENCIAR_TOAST = new HttpContextToken<boolean>(() => false);

/**
 * Fase 1 · traducción única de los errores de NestJS a texto para el usuario.
 *
 * El backend responde `{ mensaje, codigo }` en las reglas de negocio y
 * `{ message, error, statusCode }` en los errores por defecto de Nest. En los
 * 400 de validación `message` es un ARRAY de strings, así que se une antes de
 * pintarlo: `String(array)` habría mostrado «a,b,c» de golpe.
 */
function extraerMensaje(error: HttpErrorResponse): { mensaje: string; titulo?: string } {
  const cuerpo: any = error.error ?? {};

  const crudo =
    cuerpo.mensaje ??
    cuerpo.message ??
    (typeof cuerpo.error === 'string' ? cuerpo.error : undefined);

  const mensaje = Array.isArray(crudo)
    ? crudo.filter(Boolean).join(' · ')
    : typeof crudo === 'string'
      ? crudo
      : '';

  if (mensaje.trim()) return { mensaje: mensaje.trim() };

  if (error.status === 0) {
    return {
      mensaje: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
      titulo: 'Sin conexión',
    };
  }
  if (error.status === 403) return { mensaje: 'No tienes permisos para realizar esta acción.' };
  if (error.status === 404) return { mensaje: 'El recurso solicitado no existe.' };
  if (error.status === 409) {
    return { mensaje: 'La operación choca con el estado actual. Recarga e inténtalo otra vez.' };
  }
  if (error.status >= 500) {
    return {
      mensaje: 'Ocurrió un error en el servidor. Si persiste, avisa al administrador.',
      titulo: 'Error interno',
    };
  }
  return { mensaje: 'No se pudo completar la operación.' };
}

/**
 * Fase 1 · interceptor global de errores HTTP.
 *
 * Centraliza el anuncio de 4xx/5xx para que cada servicio deje de repetir el
 * mismo `catchError` que solo servía para mostrar un mensaje. Ahora el error
 * viaja al toast desde un único sitio y el `catchError` local se reserva para
 * lo que de verdad necesita lógica propia (cargar una lista vacía, marcar un
 * estado de carga, etc.).
 *
 * Dos exclusiones deliberadas:
 *
 *   · 401 — lo gestiona `authInterceptor`, que cierra la sesión y redirige.
 *     Un toast «no autorizado» encima del login solo confundiría.
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
      if (error instanceof HttpErrorResponse) {
        const silenciado = req.context.get(SILENCIAR_TOAST);
        const esSesion = error.status === 401;

        if (!silenciado && !esSesion && error.status >= 400) {
          const { mensaje, titulo } = extraerMensaje(error);
          toast.error(mensaje, titulo);
        }
      }
      return throwError(() => error);
    }),
  );
};
