import { ConflictException, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export interface SerializableOptions {
  /** Número máximo de reintentos automáticos ante error de contención / saturación. Por defecto: 3 */
  maxRetries?: number;
  /** Tiempo inicial en milisegundos para el backoff exponencial. Por defecto: 80ms */
  initialDelayMs?: number;
  /** Timeout máximo de la transacción en milisegundos. Por defecto: 15000ms */
  timeoutMs?: number;
  /** Tiempo máximo de espera para adquirir conexión del pool en milisegundos. Por defecto: 8000ms */
  maxWaitMs?: number;
}

/**
 * Ejecuta una operación en base de datos con nivel de aislamiento SERIALIZABLE
 * y reintento automático con backoff exponencial y jitter aleatorio ante colisiones
 * de concurrencia o saturación temporal del pool de conexiones.
 *
 * Cumple estrictamente con la Regla de Oro 2 (Skill de Arquitectura):
 * - Nivel de aislamiento `Prisma.TransactionIsolationLevel.Serializable`.
 * - Timeout extendido y maxWait configurado para evitar saturación prematura.
 * - Reintenta automáticamente en colisiones de concurrencia (Postgres 40001, 40P01, 55P03, Prisma P2034, P2024, P2028).
 * - Si se agotan los reintentos, arroja `ConflictException` (HTTP 409) con mensaje de dominio claro, nunca 500.
 */
export async function withSerializableTransaction<T>(
  prisma: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: SerializableOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelay = options.initialDelayMs ?? 80;
  const timeout = options.timeoutMs ?? 15000;
  const maxWait = options.maxWaitMs ?? 8000;
  const logger = new Logger('withSerializableTransaction');

  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout,
        maxWait,
      });
    } catch (error: any) {
      const msg = error?.message ?? '';
      const metaCode = (error?.meta as any)?.code;

      const isConcurrencyOrContentionFailure =
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2024', 'P2028'].includes(error.code)) ||
        msg.includes('40001') ||
        metaCode === '40001' ||
        msg.includes('40P01') ||
        metaCode === '40P01' ||
        msg.includes('55P03') ||
        metaCode === '55P03' ||
        msg.includes('57014') ||
        metaCode === '57014' ||
        msg.includes('could not serialize') ||
        msg.includes('deadlock') ||
        msg.includes('lock timeout') ||
        msg.includes('statement timeout') ||
        msg.includes('connection pool') ||
        msg.includes('Transaction already closed') ||
        msg.includes('Transaction timed out');

      if (isConcurrencyOrContentionFailure && attempt < maxRetries) {
        attempt++;
        const jitter = Math.random() * 50;
        const delay = initialDelay * Math.pow(2, attempt - 1) + jitter;

        logger.warn(
          `[Concurrencia/Contención: ${error?.code || 'DB'}] Fallo en intento ${attempt}/${maxRetries}. Reintentando en ${Math.round(delay)}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (isConcurrencyOrContentionFailure) {
        logger.error(
          `[Concurrencia] Se agotaron los ${maxRetries} reintentos de la transacción SERIALIZABLE por alta contención (${error?.code || '40001'}).`,
        );
        throw new ConflictException(
          'El horario o servicio se encuentra bajo alta demanda simultánea. Por favor, reintente en unos instantes.',
        );
      }

      // Cualquier otro error se propaga normalmente
      throw error;
    }
  }

  throw new ConflictException(
    'No fue posible completar la operación debido a un conflicto concurrente persistente.',
  );
}
