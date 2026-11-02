import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { DecimalSerializerInterceptor } from './decimal-serializer.interceptor.js';

describe('DecimalSerializerInterceptor', () => {
  const interceptor = new DecimalSerializerInterceptor();
  const context = {} as ExecutionContext;

  it('convierte Prisma.Decimal anidados en objetos y arrays a números', async () => {
    const respuesta = {
      precio: new Prisma.Decimal('19.95'),
      pago: {
        monto: new Prisma.Decimal('0.1'),
        servicios: [{ precio: new Prisma.Decimal('0.2') }],
      },
      pagos: [new Prisma.Decimal('3.50')],
    };
    const handler = { handle: () => of(respuesta) } as CallHandler;

    const serializada = await firstValueFrom(interceptor.intercept(context, handler));

    expect(serializada).toEqual({
      precio: 19.95,
      pago: { monto: 0.1, servicios: [{ precio: 0.2 }] },
      pagos: [3.5],
    });
    expect(typeof (serializada as typeof respuesta).precio).toBe('number');
  });

  it('reconstruye la forma plana {s, e, d} dejada por ClassSerializerInterceptor', async () => {
    const respuesta = {
      servicio: { precio: { s: 1, e: 2, d: [123, 4500000] } },
      reembolso: { monto: { s: -1, e: -1, d: [7500000] } },
    };
    const handler = { handle: () => of(respuesta) } as CallHandler;

    const serializada = await firstValueFrom(interceptor.intercept(context, handler));

    expect(serializada).toEqual({ servicio: { precio: 123.45 }, reembolso: { monto: -0.75 } });
  });

  it('conserva fechas y valores nulos sin alterarlos', async () => {
    const fecha = new Date('2026-11-02T12:00:00.000Z');
    const respuesta = { creadoEn: fecha, precio: null };
    const handler = { handle: () => of(respuesta) } as CallHandler;

    const serializada = await firstValueFrom(interceptor.intercept(context, handler));

    expect(serializada).toEqual(respuesta);
    expect((serializada as typeof respuesta).creadoEn).toBe(fecha);
  });
});
