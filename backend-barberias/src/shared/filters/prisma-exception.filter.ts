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
)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientValidationError
      | Prisma.PrismaClientUnknownRequestError,
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

    // 3. Error desconocido de Prisma (puede incluir fallos directos de PostgreSQL como 40001)
    return this.handleUnknownError(exception, response);
  }

  private handleKnownRequestError(
    error: Prisma.PrismaClientKnownRequestError,
    response: Response,
  ) {
    // Código PostgreSQL 40001 (Serialization Failure) o P2034 (Transaction failed due to write conflict)
    const isSerializationConflict =
      error.code === 'P2034' ||
      error.message?.includes('40001') ||
      (error.meta as any)?.code === '40001';

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
    error: Prisma.PrismaClientUnknownRequestError,
    response: Response,
  ) {
    if (error.message?.includes('40001')) {
      this.logger.warn(`Postgres 40001 interceptado en UnknownRequestError: ${error.message}`);
      return response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: 'CONCURRENCY_CONFLICT',
        message:
          'Conflicto de concurrencia detectado. La transacción no pudo serializarse. Por favor, intente nuevamente.',
      });
    }

    this.logger.error(`Error desconocido de Prisma: ${error.message}`);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Error inesperado en la base de datos.',
    });
  }
}
