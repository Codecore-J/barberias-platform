import { SetMetadata } from '@nestjs/common';

export const AUTENTICADO_KEY = 'autenticado';

/**
 * Declara que la ruta es para cualquier usuario con sesion valida, sin exigir
 * un rol concreto. Es la politica explicita para las rutas que hoy solo
 * requerian autenticacion (E1-01).
 *
 * E1-05 sustituye estos casos por el rol o decorador que corresponda en cada
 * ruta. No usar para rutas de administracion: annotate con @Roles.
 *
 * Ejemplo de uso:
 * `@Autenticado()`
 */
export const Autenticado = () => SetMetadata(AUTENTICADO_KEY, true);