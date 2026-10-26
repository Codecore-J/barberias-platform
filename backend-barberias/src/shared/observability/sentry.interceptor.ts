import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Observable, catchError, throwError } from 'rxjs';

/** Desde qué código HTTP un error se considera fallo del sistema. */
export const CODIGO_MINIMO_SENTRY = 500;

interface PeticionConUsuario {
  method?: string;
  originalUrl?: string;
  url?: string;
  user?: { id?: string };
}

/**
 * Observabilidad · puente entre las excepciones de Nest y Sentry.
 *
 * Es un interceptor y no un filtro a propósito: **no reescribe la respuesta**.
 * Se limita a mirar el error y a re-lanzarlo tal cual, así que el cliente recibe
 * exactamente el mismo código y el mismo cuerpo que sin él. Un filtro tendría
 * que construir la respuesta y volvería a decidir el formato de los errores,
 * que ya está resuelto en `PrismaExceptionFilter` y en el filtro de Nest.
 *
 * Solo se reporta lo que es un fallo del sistema:
 * - `4xx` son decisiones del cliente (validación, permisos, no encontrado) y no
 *   se envían a Sentry, o la cuota se llenaría de ruido esperado.
 * - `5xx` y cualquier excepción que no sea `HttpException` sí.
 */
@Injectable()
export class SentryInterceptor implements NestInterceptor {
  intercept(contexto: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        this.reportar(error, contexto);
        return throwError(() => error);
      }),
    );
  }

  private reportar(error: unknown, contexto: ExecutionContext): void {
    if (!this.esFalloDelSistema(error)) return;
    // Sin DSN no hay cliente: en local y en el CI esto es un no-op.
    if (!Sentry.getClient()) return;

    const peticion = contexto.switchToHttp().getRequest<PeticionConUsuario>();
    const metodo = peticion?.method ?? 'UNKNOWN';
    // Sin query string: puede llevar correos, tokens de invitación o códigos.
    const ruta = (peticion?.originalUrl ?? peticion?.url ?? '').split('?')[0];
    const estado = this.codigoDe(error);

    Sentry.withScope((alcance) => {
      alcance.setTag('http.method', metodo);
      alcance.setTag('http.route', ruta);
      alcance.setContext('peticion', { metodo, ruta, estado });

      const usuarioId = peticion?.user?.id;
      if (usuarioId) {
        alcance.setUser({ id: usuarioId });
      }

      Sentry.captureException(error);
    });
  }

  private esFalloDelSistema(error: unknown): boolean {
    if (error instanceof HttpException) {
      return error.getStatus() >= CODIGO_MINIMO_SENTRY;
    }
    // Cualquier cosa que no sea una excepción HTTP es un fallo inesperado.
    return true;
  }

  private codigoDe(error: unknown): number {
    return error instanceof HttpException
      ? error.getStatus()
      : CODIGO_MINIMO_SENTRY;
  }
}
