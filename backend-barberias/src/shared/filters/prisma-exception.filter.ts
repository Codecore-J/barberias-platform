import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Filtro global para normalizar excepciones de Prisma ORM y PostgreSQL.
 * Regla de Oro 2 (Skill de Arquitectura):
 * - Intercepción de errores de concurrencia y serialización (Postgres 40001, Prisma P2034) → HTTP 409 Conflict.
 * - Errores de restricciones únicas (Prisma P2002) → HTTP 409 Conflict.
 * - Registros no encontrados (Prisma P2025) → HTTP 404 Not Found.
 * - Violaciones de claves foráneas (Prisma P2003) → HTTP 400 Bad Request.
 */
@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientValidationError
      | Prisma.PrismaClientUnknownRequestError
      | Prisma.PrismaClientInitializationError
      | Prisma.PrismaClientRustPanicError,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // 1. Error conocido de Prisma (KnownRequestError)
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handleKnownRequestError(exception, response);
    }

    // 2. Error de validación interna de Prisma
    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.warn(`Error de validación Prisma: ${exception.message}`);
      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Datos de consulta o mutación incompatibles con el esquema de base de datos.',
      });
    }

    // 3. Error de inicialización / conexión de cliente Prisma
    if (exception instanceof Prisma.PrismaClientInitializationError) {
      this.logger.error(`Error de inicialización de conexión Prisma: ${exception.message}`);
      return response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        code: 'DATABASE_UNAVAILABLE',
        message:
          'El servicio de base de datos no se encuentra disponible temporalmente. Por favor, reintente en unos momentos.',
      });
    }

    // 4. Error desconocido o pánico de Prisma (puede incluir fallos directos de PostgreSQL como 40001, 40P01, etc.)
    return this.handleUnknownError(exception, response);
  }

  private handleKnownRequestError(
    error: Prisma.PrismaClientKnownRequestError,
    response: Response,
  ) {
    const errorMsg = error.message ?? '';
    const metaCode = (error.meta as any)?.code;

    // Código PostgreSQL 40001 (Serialization Failure), 40P01 (Deadlock), 55P03 (Lock not available)
    // o P2034 (Transaction failed due to write conflict)
    const isSerializationConflict =
      error.code === 'P2034' ||
      errorMsg.includes('40001') ||
      metaCode === '40001' ||
      errorMsg.includes('40P01') ||
      metaCode === '40P01' ||
      errorMsg.includes('55P03') ||
      metaCode === '55P03' ||
      errorMsg.includes('could not serialize') ||
      errorMsg.includes('deadlock detected');

    if (isSerializationConflict) {
      this.logger.warn(
        `[40001/P2034] Conflicto de concurrencia serializable interceptado: ${error.message}`,
      );
      return response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: 'CONCURRENCY_CONFLICT',
        message:
          'Conflicto de concurrencia detectado. El recurso u horario solicitado fue modificado o reservado simultáneamente. Por favor, intente nuevamente.',
      });
    }

    switch (error.code) {
      // P2024: Timed out fetching a new connection from the connection pool
      case 'P2024': {
        this.logger.warn(
          `[P2024] Saturación del pool de conexiones Prisma: ${error.message}`,
        );
        return response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          code: 'CONCURRENCY_POOL_TIMEOUT',
          message:
            'El servicio se encuentra bajo alta demanda simultánea. Por favor, reintente en unos segundos.',
        });
      }

      // P2028: Transaction API error (Transaction already closed / timeout)
      case 'P2028': {
        this.logger.warn(
          `[P2028] Timeout o cierre de transacción por concurrencia: ${error.message}`,
        );
        return response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          code: 'TRANSACTION_TIMEOUT_CONFLICT',
          message:
            'La operación no pudo completarse a tiempo debido a alta contención concurrente. Por favor, intente nuevamente.',
        });
      }

      // P2002: Unique constraint failed
      case 'P2002': {
        const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'datos duplicados';
        return response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          code: 'UNIQUE_CONSTRAINT_VIOLATION',
          message: `Ya existe un registro con esos datos únicos (${target}).`,
        });
      }

      // P2025: Record to update/delete not found
      case 'P2025': {
        return response.status(HttpStatus.NOT_FOUND).json({
          statusCode: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          code: 'RECORD_NOT_FOUND',
          message: 'El recurso solicitado no fue encontrado o no existe.',
        });
      }

      // P2003: Foreign key constraint failed
      case 'P2003': {
        return response.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          code: 'FOREIGN_KEY_VIOLATION',
          message: 'Operación no permitida: referencia a una entidad no existente o con dependencias activas.',
        });
      }

      default: {
        this.logger.error(`Error no mapeado de Prisma [${error.code}]: ${error.message}`);
        return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal Server Error',
          message: 'Error interno en la capa de persistencia.',
        });
      }
    }
  }

  private handleUnknownError(
    error: Prisma.PrismaClientUnknownRequestError | Prisma.PrismaClientRustPanicError,
    response: Response,
  ) {
    const msg = error.message ?? '';
    const isConcurrency =
      msg.includes('40001') ||
      msg.includes('40P01') ||
      msg.includes('55P03') ||
      msg.includes('57014') ||
      msg.includes('deadlock') ||
      msg.includes('could not serialize') ||
      msg.includes('lock timeout') ||
      msg.includes('statement timeout') ||
      msg.includes('connection pool') ||
      msg.includes('Transaction already closed') ||
      msg.includes('Transaction timed out');

    if (isConcurrency) {
      this.logger.warn(`Conflicto de concurrencia interceptado en UnknownRequestError: ${msg}`);
      return response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: 'CONCURRENCY_CONFLICT',
        message:
          'Conflicto de concurrencia detectado. La transacción no pudo completarse por contención simultánea. Por favor, intente nuevamente.',
      });
    }

    this.logger.error(`Error desconocido de Prisma: ${msg}`);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Error inesperado en la base de datos.',
    });
  }
}
