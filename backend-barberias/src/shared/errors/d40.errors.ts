import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * D40 (docs/BACKLOG_BARBERIAS_V1.md §6): el contrato de errores de negocio es
 * `{ statusCode, codigo, mensaje }`. Códigos en inglés SCREAMING_SNAKE, mensajes
 * en español y aptos para mostrar al usuario.
 *
 * Mapa de estados: 400 validación, 401 sin sesión, 403 sin permiso, 404 no
 * existe, 409 conflicto (concurrencia o ESTADO_INVALIDO) y 422 regla de negocio
 * violada. Estos helpers cubren los tres que usa el dominio de reservas; se
 * siguen usando las clases de Nest para 404/409 para no perder el `instanceof`
 * que ya verifican los tests.
 */

/** 403 · el solicitante existe, pero no tiene permiso de negocio (D40). */
export function errorDePermiso(codigo: string, mensaje: string): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, codigo, mensaje });
}

/** 400 · la petición es válida pero referencia algo que no aplica (D40). */
export function errorDeSolicitud(codigo: string, mensaje: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, codigo, mensaje });
}

/**
 * 409 · conflicto: concurrencia o transición de estado no permitida (D40).
 * `ESTADO_INVALIDO` y `SOLICITUD_EXPIRADA` viajan por aquí (E3-04).
 */
export function errorDeConflicto(codigo: string, mensaje: string): ConflictException {
  return new ConflictException({ statusCode: 409, codigo, mensaje });
}

/** 422 · regla de negocio violada (D40). */
export function reglaDeNegocio(
  codigo: string,
  mensaje: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({ statusCode: 422, codigo, mensaje });
}
