import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { firstValueFrom, throwError } from 'rxjs';

const mocks = vi.hoisted(() => {
  const alcance = { setTag: vi.fn(), setContext: vi.fn(), setUser: vi.fn() };
  return {
    alcance,
    capturar: vi.fn(),
    conScope: vi.fn((callback: (scope: unknown) => void) => callback(alcance)),
    getClient: vi.fn(() => ({}) as unknown),
  };
});

vi.mock('@sentry/node', () => ({
  captureException: mocks.capturar,
  withScope: mocks.conScope,
  getClient: mocks.getClient,
}));

import { SentryInterceptor } from './sentry.interceptor.js';

const crearContexto = (peticion: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => peticion }),
  }) as never;

const crearHandler = (error: unknown) => ({
  handle: () => throwError(() => error),
});

describe('SentryInterceptor (Paso 15)', () => {
  let interceptor: InstanceType<typeof SentryInterceptor>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClient.mockReturnValue({});
    interceptor = new SentryInterceptor();
  });

  it('envía a Sentry un 500 con la ruta, el método y el usuario autenticado', async () => {
    const error = new Error('la base de datos no responde');
    const contexto = crearContexto({
      method: 'GET',
      originalUrl: '/api/v1/shops/shop-1/analytics?desde=2026-10-01',
      user: { id: 'u-123' },
    });

    await expect(
      firstValueFrom(interceptor.intercept(contexto, crearHandler(error) as never)),
    ).rejects.toBe(error);

    expect(mocks.capturar).toHaveBeenCalledWith(error);
    expect(mocks.alcance.setTag).toHaveBeenCalledWith('http.method', 'GET');
    // La query no se envía: puede llevar correos o códigos de invitación.
    expect(mocks.alcance.setTag).toHaveBeenCalledWith(
      'http.route',
      '/api/v1/shops/shop-1/analytics',
    );
    expect(mocks.alcance.setContext).toHaveBeenCalledWith('peticion', {
      metodo: 'GET',
      ruta: '/api/v1/shops/shop-1/analytics',
      estado: 500,
    });
    expect(mocks.alcance.setUser).toHaveBeenCalledWith({ id: 'u-123' });
  });

  it('reporta una HttpException con código 5xx', async () => {
    const error = new InternalServerErrorException('fallo interno');
    const contexto = crearContexto({ method: 'POST', originalUrl: '/api/v1/reservas' });

    await expect(
      firstValueFrom(interceptor.intercept(contexto, crearHandler(error) as never)),
    ).rejects.toBe(error);

    expect(mocks.capturar).toHaveBeenCalledWith(error);
    expect(mocks.alcance.setContext).toHaveBeenCalledWith('peticion', {
      metodo: 'POST',
      ruta: '/api/v1/reservas',
      estado: 500,
    });
  });

  it('ignora los 4xx: son decisiones del cliente, no fallos del sistema', async () => {
    const error = new BadRequestException('desde > hasta');
    const contexto = crearContexto({ method: 'GET', originalUrl: '/api/v1/shops/x/analytics' });

    await expect(
      firstValueFrom(interceptor.intercept(contexto, crearHandler(error) as never)),
    ).rejects.toBe(error);

    expect(mocks.capturar).not.toHaveBeenCalled();
    expect(mocks.conScope).not.toHaveBeenCalled();
  });

  it('captura excepciones que no son HTTP (errores de programación)', async () => {
    const error = new TypeError('no puedo leer properties de undefined');
    const contexto = crearContexto({ method: 'GET', url: '/api/v1/health' });

    await expect(
      firstValueFrom(interceptor.intercept(contexto, crearHandler(error) as never)),
    ).rejects.toBe(error);

    expect(mocks.capturar).toHaveBeenCalledWith(error);
    expect(mocks.alcance.setContext).toHaveBeenCalledWith('peticion', {
      metodo: 'GET',
      ruta: '/api/v1/health',
      estado: 500,
    });
  });

  it('no hace nada si Sentry no está inicializado', async () => {
    mocks.getClient.mockReturnValue(undefined);
    const error = new Error('boom');
    const contexto = crearContexto({ method: 'GET', originalUrl: '/api/v1/x' });

    await expect(
      firstValueFrom(interceptor.intercept(contexto, crearHandler(error) as never)),
    ).rejects.toBe(error);

    expect(mocks.capturar).not.toHaveBeenCalled();
  });

  it('no adjunta usuario cuando la petición es anónima', async () => {
    const error = new Error('boom');
    const contexto = crearContexto({ method: 'GET', originalUrl: '/api/v1/publico' });

    await expect(
      firstValueFrom(interceptor.intercept(contexto, crearHandler(error) as never)),
    ).rejects.toBe(error);

    expect(mocks.alcance.setUser).not.toHaveBeenCalled();
  });
});
