import { ConflictException, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export interface SerializableOptions {
  /** Número máximo de reintentos automáticos ante error 40001 / P2034. Por defecto: 3 */
  maxRetries?: number;
  /** Tiempo inicial en milisegundos para el backoff exponencial. Por defecto: 60ms */
  initialDelayMs?: number;
  /** Timeout máximo de la transacción en milisegundos. Por defecto: 10000ms */
  timeoutMs?: number;
}

/**
 * Ejecuta una operación en base de datos con nivel de aislamiento SERIALIZABLE
 * y reintento automático con backoff exponencial y jitter aleatorio.
 *
 * Cumple estrictamente con la Regla de Oro 2 (Skill de Arquitectura):
 * - Nivel de aislamiento `Prisma.TransactionIsolationLevel.Serializable`.
 * - Reintenta automáticamente en colisiones de concurrencia concurrentes (Postgres 40001 / Prisma P2034).
 * - Si se agotan los reintentos, arroja `ConflictException` (HTTP 409) con mensaje de dominio claro.
 */
export async function withSerializableTransaction<T>(
  prisma: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: SerializableOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelay = options.initialDelayMs ?? 60;
  const timeout = options.timeoutMs ?? 10000;
  const logger = new Logger('withSerializableTransaction');

  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout,
      });
    } catch (error: any) {
      const isSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.meta as any)?.code === '40001' ||
          error.message?.includes('40001'));

      if (isSerializationFailure && attempt < maxRetries) {
        attempt++;
        const jitter = Math.random() * 30;
        const delay = initialDelay * Math.pow(2, attempt - 1) + jitter;

        logger.warn(
          `[40001/P2034] Fallo de serialización en intento ${attempt}/${maxRetries}. Reintentando en ${Math.round(delay)}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (isSerializationFailure) {
        logger.error(
          `[40001] Se agotaron los ${maxRetries} reintentos de la transacción SERIALIZABLE por alta contención.`,
        );
        throw new ConflictException(
          'El horario o recurso solicitado se encuentra en alta demanda y fue tomado por otra operación. Por favor reintente.',
        );
      }

      // Cualquier otro error se propaga normalmente
      throw error;
    }
  }

  throw new ConflictException('No fue posible completar la operación debido a un conflicto concurrente persistente.');
}
