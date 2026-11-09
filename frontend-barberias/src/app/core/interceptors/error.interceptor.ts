import {
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { extraerMensaje } from '../utils/error-message';
import { AuthService, ACCESS_TOKEN_KEY } from '../auth/auth.service';

/**
 * Fase 1 · marca una petición para que su fallo NO se anuncie con un toast.
 * Sirve para las llamadas de fondo (sondeos del layout, precargas) y para las
 * que ya pintan el error dentro de su propio formulario: si el aviso saliera
 * además en la esquina, el usuario vería el mismo mensaje dos veces.
 */
export const SILENCIAR_TOAST = new HttpContextToken<boolean>(() => false);

/**
 * Fase 1 · interceptor global de errores HTTP mejorado.
 *
 * Centraliza el anuncio de 4xx/5xx para que cada servicio deje de repetir el
 * mismo `catchError` que solo servía para mostrar un mensaje. Ahora el error
 * viaja al toast desde un único sitio y el `catchError` local se reserva para
 * lo que de verdad necesita lógica propia (cargar una lista vacía, marcar un
 * estado de carga, etc.).
 *
 * Exclusiones deliberadas (aunque el `authInterceptor` ya se encarga de los 401):
 *
 *   · 401 — lo gestiona `authInterceptor`, que cierra la sesión y redirige.
 *     Un toast «no autorizado» encima del login solo confundiría.
 *   · `SILENCIAR_TOAST` — llamadas de fondo o formularios con error en línea.
 *
 * Comportamiento nuevo:
 *   · 403 → muestra «No tienes permisos para realizar esta acción.»
 *            + mensaje contextual si el usuario es ADMINISTRADOR GLOBAL
 *   · 404 → muestra «El recurso solicitado no existe.»
 *   · 500+ → muestra error interno genérico
 *   · Otros 4xx → muestra el mensaje del backend o genérico
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

        // 🔧 MEJORA: Manejo específico para 403 con contexto de rol
        if (error.status === 403 && !silenciado) {
          const { mensaje } = extraerMensaje(error);

          // Verificar si es admin global para mensaje contextual
          const user = inject(AuthService).authState().user;
          const esAdminGlobal = user?.roles?.includes('ADMINISTRADOR');

          if (esAdminGlobal) {
            // Admin global puede que no tenga sede asignada o no tenga permisos
            // para esa operación específica en esa sede
            const titulo = 'Sin permisos de operación';
            const mensajeContexto =
              mensaje && mensaje.includes('permisos')
                ? mensaje
                : `No tienes permisos para realizar esta acción en la sede actual. ` +
                  (user?.barberiaAsociada
                    ? `Sede: ${user.barberiaAsociada}`
                    : 'Selecciona una sede en el panel de administración.') +
                  `. ${mensaje || ''}`.trim();

            toast.error(mensajeContexto, titulo);
          } else {
            const { mensaje: msgTitulo, titulo } = extraerMensaje(error);
            toast.error(msgTitulo || 'No tienes permisos para realizar esta acción.', titulo);
          }

          return throwError(() => error);
        }

        if (!silenciado && !esSesion && error.status >= 400) {
          const { mensaje, titulo } = extraerMensaje(error);
          toast.error(mensaje, titulo);
        }
      }
      return throwError(() => error);
    }),
  );
};