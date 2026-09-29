import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Decorador para restringir el acceso a uno o más roles.
 * Ejemplo de uso:
 * `@Roles('ADMINISTRADOR', 'BARBERO')`
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
