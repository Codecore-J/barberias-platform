import { mensajeDeNegocio } from './errores';

/**
 * Mensaje de negocio del backend para pintarlo DENTRO de un formulario o de una
 * pantalla, con un respaldo propio del servicio.
 *
 * La traducción vive en `errores.ts`: diccionario por `codigo` del contrato D40,
 * descarte del texto técnico (rutas, trazas de Prisma, `null`) y mensaje
 * genérico para lo no mapeado. Antes esta función copiaba el `mensaje` del
 * backend tal cual, así que un `Cannot GET /api/v1/shops/null/hours` acababa
 * dentro de una tarjeta de error.
 *
 * Se conserva el nombre porque lo usan los servicios y componentes de todas las
 * pantallas; cambiarlo obligaría a tocar sesenta importaciones sin ganar nada.
 */
export function mensajeDeError(error: unknown, respaldo: string): string {
  return mensajeDeNegocio(error, respaldo);
}
