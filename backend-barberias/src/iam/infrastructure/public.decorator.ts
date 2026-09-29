import { SetMetadata } from '@nestjs/common';

/**
 * Decorador @Public() — marca un endpoint como público.
 * El JwtAuthGuard lo detecta y omite la verificación del token.
 * Úsalo en: register, login, y cualquier ruta sin autenticación.
 */
export const Public = () => SetMetadata('isPublic', true);
