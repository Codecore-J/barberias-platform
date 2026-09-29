import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaExceptionFilter } from './prisma-exception.filter.js';
import { Prisma } from '@prisma/client';
import { ArgumentsHost, HttpStatus } from '@nestjs/common';

describe('PrismaExceptionFilter', () => {
  let filter: PrismaExceptionFilter;
  let mockResponse: any;
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    filter = new PrismaExceptionFilter();
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockArgumentsHost = {
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: () => mockResponse,
      }),
    } as any;
  });

  it('debe mapear error P2034 (concurrencia de transacción) a HTTP 409 Conflict', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Transaction conflict', {
      code: 'P2034',
      clientVersion: '5.22.0',
    });

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        error: 'Conflict',
        code: 'CONCURRENCY_CONFLICT',
      }),
    );
  });

  it('debe mapear mensaje con 40001 de Postgres a HTTP 409 Conflict', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'could not serialize access due to read/write dependencies among transactions (SQLSTATE 40001)',
      {
        code: 'P2010',
        clientVersion: '5.22.0',
      },
    );

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        code: 'CONCURRENCY_CONFLICT',
      }),
    );
  });

  it('debe mapear error P2002 (violación de clave única) a HTTP 409 Conflict', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['correo'] },
    });

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        code: 'UNIQUE_CONSTRAINT_VIOLATION',
      }),
    );
  });

  it('debe mapear error P2025 (registro no encontrado) a HTTP 404 Not Found', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409 ? 404 : 404,
        code: 'RECORD_NOT_FOUND',
      }),
    );
  });

  it('debe mapear error P2024 (timeout del pool de conexiones) a HTTP 409 Conflict con CONCURRENCY_POOL_TIMEOUT', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Timed out fetching a new connection from the connection pool',
      {
        code: 'P2024',
        clientVersion: '5.22.0',
      },
    );

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        error: 'Conflict',
        code: 'CONCURRENCY_POOL_TIMEOUT',
      }),
    );
  });

  it('debe mapear error P2028 (timeout/cierre de transacción) a HTTP 409 Conflict con TRANSACTION_TIMEOUT_CONFLICT', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Transaction API error: Transaction already closed: A query cannot be executed on a closed transaction',
      {
        code: 'P2028',
        clientVersion: '5.22.0',
      },
    );

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        error: 'Conflict',
        code: 'TRANSACTION_TIMEOUT_CONFLICT',
      }),
    );
  });

  it('debe mapear error con código Postgres 40P01 (Deadlock) a HTTP 409 Conflict', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'deadlock detected between transactions (SQLSTATE 40P01)',
      {
        code: 'P2010',
        clientVersion: '5.22.0',
      },
    );

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        error: 'Conflict',
        code: 'CONCURRENCY_CONFLICT',
      }),
    );
  });

  it('debe mapear PrismaClientInitializationError a HTTP 503 Service Unavailable', () => {
    const error = new Prisma.PrismaClientInitializationError(
      'Can not reach database server at ep-steep-silence-pooler.c-6.us-east-2.aws.neon.tech:5432',
      '5.22.0',
    );

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'DATABASE_UNAVAILABLE',
      }),
    );
  });
});
