import { describe, it, expect, vi } from 'vitest';
import { withSerializableTransaction } from './serializable-transaction.js';
import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

describe('withSerializableTransaction', () => {
  it('debe ejecutar la transacción exitosamente en el primer intento', async () => {
    const mockPrisma: any = {
      $transaction: vi.fn().mockImplementation(async (cb) => {
        return cb({});
      }),
    };

    const result = await withSerializableTransaction(mockPrisma, async (_tx) => {
      return { success: true };
    });

    expect(result).toEqual({ success: true });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('debe reintentar automáticamente ante error P2034 y resolver exitosamente', async () => {
    let callCount = 0;
    const p2034Error = new Prisma.PrismaClientKnownRequestError('Transaction conflict', {
      code: 'P2034',
      clientVersion: '5.22.0',
    });

    const mockPrisma: any = {
      $transaction: vi.fn().mockImplementation(async (cb) => {
        callCount++;
        if (callCount === 1) {
          throw p2034Error;
        }
        return cb({});
      }),
    };

    const result = await withSerializableTransaction(
      mockPrisma,
      async (_tx) => 'operacion-exitosa',
      { maxRetries: 2, initialDelayMs: 5 },
    );

    expect(result).toBe('operacion-exitosa');
    expect(callCount).toBe(2);
  });

  it('debe lanzar ConflictException si se agotan todos los reintentos por error 40001', async () => {
    const p2034Error = new Prisma.PrismaClientKnownRequestError('40001 serialization failure', {
      code: 'P2034',
      clientVersion: '5.22.0',
    });

    const mockPrisma: any = {
      $transaction: vi.fn().mockRejectedValue(p2034Error),
    };

    await expect(
      withSerializableTransaction(mockPrisma, async () => {}, {
        maxRetries: 2,
        initialDelayMs: 5,
      }),
    ).rejects.toThrow(ConflictException);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3); // 1 intento inicial + 2 reintentos
  });

  it('debe reintentar automáticamente ante saturación de pool P2024 y resolver exitosamente', async () => {
    let callCount = 0;
    const p2024Error = new Prisma.PrismaClientKnownRequestError(
      'Timed out fetching a new connection from the connection pool',
      {
        code: 'P2024',
        clientVersion: '5.22.0',
      },
    );

    const mockPrisma: any = {
      $transaction: vi.fn().mockImplementation(async (cb) => {
        callCount++;
        if (callCount === 1) {
          throw p2024Error;
        }
        return cb({});
      }),
    };

    const result = await withSerializableTransaction(
      mockPrisma,
      async (_tx) => ({ reservaId: 'res-123' }),
      { maxRetries: 2, initialDelayMs: 5 },
    );

    expect(result).toEqual({ reservaId: 'res-123' });
    expect(callCount).toBe(2);
  });

  it('debe lanzar ConflictException (409) si se agotan los reintentos por timeout de pool P2024', async () => {
    const p2024Error = new Prisma.PrismaClientKnownRequestError(
      'Timed out fetching a new connection from the connection pool',
      {
        code: 'P2024',
        clientVersion: '5.22.0',
      },
    );

    const mockPrisma: any = {
      $transaction: vi.fn().mockRejectedValue(p2024Error),
    };

    await expect(
      withSerializableTransaction(mockPrisma, async () => {}, {
        maxRetries: 2,
        initialDelayMs: 5,
      }),
    ).rejects.toThrow(ConflictException);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('debe reintentar ante P2028 (Transaction API error) y resolver', async () => {
    let callCount = 0;
    const p2028Error = new Prisma.PrismaClientKnownRequestError(
      'Transaction API error: Transaction already closed',
      {
        code: 'P2028',
        clientVersion: '5.22.0',
      },
    );

    const mockPrisma: any = {
      $transaction: vi.fn().mockImplementation(async (cb) => {
        callCount++;
        if (callCount === 1) {
          throw p2028Error;
        }
        return cb({});
      }),
    };

    const result = await withSerializableTransaction(
      mockPrisma,
      async (_tx) => 'ok',
      { maxRetries: 2, initialDelayMs: 5 },
    );

    expect(result).toBe('ok');
    expect(callCount).toBe(2);
  });
});
