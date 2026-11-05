import { HttpErrorResponse } from '@angular/common/http';

/**
 * Traducción única de los errores de NestJS a texto para el usuario.
 *
 * El backend responde `{ mensaje, codigo }` en las reglas de negocio y
 * `{ message, error, statusCode }` en los errores por defecto de Nest. En los
 * 400 de validación `message` es un ARRAY de strings, así que se une antes de
 * pintarlo: `String(array)` habría mostrado «a,b,c» de golpe.
 *
 * Vive aquí y no en el interceptor porque hay dos consumidores con necesidades
 * distintas: el interceptor necesita además un texto por código de estado, y
 * los servicios solo quieren el mensaje para pintarlo dentro de su formulario.
 */
export function extraerMensaje(error: HttpErrorResponse): { mensaje: string; titulo?: string } {
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
 * Mensaje de negocio del backend, con respaldo propio del servicio.
 *
 * Prioriza `mensaje` (reglas de negocio: límite de sedes, motivo obligatorio…)
 * y solo después `message`, que Nest rellena con textos de validación o
 * genéricos. Antes algunos servicios leían únicamente `message` y por eso un
 * 422 con `{ codigo: 'LIMITE_BARBERIAS', mensaje: '…' }` se pintaba como
 * «Error al crear la barbería».
 *
 * Acepta cualquier forma del error porque no todos los `catchError` reciben un
 * `HttpErrorResponse`: también hay `Error` de JavaScript y objetos sueltos.
 */
export function mensajeDeError(error: unknown, respaldo: string): string {
  const cuerpo: any = (error as any)?.error ?? {};
  const propio: any = error as any;

  const crudo =
    cuerpo?.mensaje ??
    cuerpo?.message ??
    (typeof cuerpo?.error === 'string' ? cuerpo.error : undefined) ??
    (typeof propio?.message === 'string' ? propio.message : undefined);

  const mensaje = Array.isArray(crudo)
    ? crudo.filter(Boolean).join(' · ')
    : typeof crudo === 'string'
      ? crudo
      : '';

  const limpio = mensaje.trim();
  return limpio ? limpio : respaldo;
}
