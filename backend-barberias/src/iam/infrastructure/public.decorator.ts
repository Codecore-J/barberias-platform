import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorador @Public() — marca un endpoint como público.
 * El JwtAuthGuard lo detecta y omite la verificación del token.
 * Úsalo en: register, login, y cualquier ruta sin autenticación.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
