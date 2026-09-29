import { Logger } from '@nestjs/common';

const logger = new Logger('JwtConfig');

/** Fallback seguro de 256 bits (64 caracteres hex) para entornos locales de desarrollo/test */
export const DEFAULT_DEV_JWT_SECRET =
  'c4a9f2e8b7d15a3068e49f12d8a7c3b5e0f91a2b3c4d5e6f7a8b9c0d1e2f3a4b';

/**
 * Obtiene y valida el secreto criptográfico para JWT (CONF-01).
 * En producción:
 * - Prohíbe terminantemente valores por defecto o triviales.
 * - Exige una longitud mínima de 32 caracteres (256 bits).
 * - Provoca un fallo inmediato (fail-fast) durante el arranque si la configuración es insegura.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (
      !secret ||
      secret === 'default-secret-change-in-production' ||
      secret === 'super-secret-barberia-jwt-key'
    ) {
      logger.error(
        'CRÍTICO: JWT_SECRET en producción no está configurado o utiliza una clave por defecto insegura.',
      );
      throw new Error(
        'Configuración insegura: JWT_SECRET debe ser una clave criptográfica de alta entropía (mínimo 32 caracteres) en producción.',
      );
    }

    if (secret.length < 32) {
      logger.error('CRÍTICO: JWT_SECRET tiene una entropía insuficiente (< 32 caracteres).');
      throw new Error(
        'Configuración insegura: JWT_SECRET debe tener al menos 32 caracteres (256 bits) en producción.',
      );
    }
  }

  return secret || DEFAULT_DEV_JWT_SECRET;
}
