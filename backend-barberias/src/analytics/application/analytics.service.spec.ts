import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';

/** Caché en memoria con la misma forma que usa el servicio. */
const crearCacheMock = () => {
  const datos = new Map<string, unknown>();
  return {
    datos,
    get: vi.fn(async (clave: string) => datos.get(clave)),
    set: vi.fn(async (clave: string, valor: unknown) => {
      datos.set(clave, valor);
      return valor;
    }),
    del: vi.fn(async (clave: string) => datos.delete(clave)),
  };
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: any;
  let cache: ReturnType<typeof crearCacheMock>;

  beforeEach(() => {
    prisma = {
      reserva: {
        findMany: vi.fn(),
      },
      listaEspera: {
        count: vi.fn(),
      },
      pago: {
        findMany: vi.fn(),
      },
    };
    cache = crearCacheMock();
    service = new AnalyticsService(prisma, cache as any);
  });

  it('valida que desde <= hasta', async () => {
    await expect(service.getShopAnalytics('shop-1', '2026-10-10', '2026-10-01')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza rango mayor a 366 días', async () => {
    await expect(service.getShopAnalytics('shop-1', '2025-01-01', '2026-01-10')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('valida el rango antes de tocar el caché', async () => {
    await expect(service.getShopAnalytics('shop-1', '2026-10-10', '2026-10-01')).rejects.toBeInstanceOf(BadRequestException);
    expect(cache.get).not.toHaveBeenCalled();
    expect(prisma.reserva.findMany).not.toHaveBeenCalled();
  });

  it('calcula tasas con denominador cero sin NaN', async () => {
    prisma.reserva.findMany.mockResolvedValue([]);
    prisma.listaEspera.count.mockResolvedValue(0);
    prisma.pago.findMany.mockResolvedValue([]);
    const result = await service.getShopAnalytics('shop-1');
    expect(result.retencion.tasaInasistencia).toBe(0);
    expect(result.retencion.tasaCancelacion).toBe(0);
    expect(Number.isNaN(result.retencion.tasaInasistencia)).toBe(false);
  });

  it('agrega cobros y rendimiento por barbero', async () => {
    prisma.reserva.findMany.mockResolvedValue([
      { id: 'r1', estado: 'COMPLETADA', barberoId: 'b1', recordatorioEnviado: true, barbero: { id: 'b1', nombreCompleto: 'Juan' } },
      { id: 'r2', estado: 'NO_PRESENTADO', barberoId: 'b1', recordatorioEnviado: false, barbero: { id: 'b1', nombreCompleto: 'Juan' } },
    ]);
    prisma.listaEspera.count.mockResolvedValue(3);
    prisma.pago.findMany.mockResolvedValue([
      { monto: 1000, metodoPago: 'EFECTIVO', reserva: { barberoId: 'b1' } },
      { monto: 500, metodoPago: 'TARJETA', reserva: { barberoId: 'b1' } },
    ]);
    const result = await service.getShopAnalytics('shop-1', '2026-10-01', '2026-10-31');
    expect(result.ingresos.totalRecaudado).toBe(1500);
    expect(result.ingresos.ticketPromedio).toBe(750);
    expect(result.retencion.recordatoriosEnviados).toBe(1);
    expect(result.retencion.cuposListaEsperaNotificados).toBe(3);
    expect(result.rendimientoPorBarbero[0].citasCompletadas).toBe(1);
    expect(result.rendimientoPorBarbero[0].inasistencias).toBe(1);
    expect(result.rendimientoPorBarbero[0].ingresosGenerados).toBe(1500);
  });

  it('el segundo llamado devuelve el valor cacheado sin consultar Prisma', async () => {
    prisma.reserva.findMany.mockResolvedValue([
      { id: 'r1', estado: 'COMPLETADA', barberoId: 'b1', recordatorioEnviado: true, barbero: { id: 'b1', nombreCompleto: 'Juan' } },
    ]);
    prisma.listaEspera.count.mockResolvedValue(1);
    prisma.pago.findMany.mockResolvedValue([{ monto: 800, metodoPago: 'EFECTIVO', reserva: { barberoId: 'b1' } }]);

    const primero = await service.getShopAnalytics('shop-1', '2026-10-01', '2026-10-31');

    // La clave es la pactada y el TTL son los 15 minutos del requisito.
    expect(cache.set).toHaveBeenCalledWith(
      'analytics:shop:shop-1:2026-10-01-2026-10-31',
      expect.objectContaining({ ingresos: expect.anything() }),
      15 * 60 * 1000,
    );

    // Segundo escenario: Prisma no debe volver a ser consultado.
    prisma.reserva.findMany.mockClear();
    prisma.listaEspera.count.mockClear();
    prisma.pago.findMany.mockClear();

    const segundo = await service.getShopAnalytics('shop-1', '2026-10-01', '2026-10-31');

    expect(segundo).toEqual(primero);
    expect(prisma.reserva.findMany).not.toHaveBeenCalled();
    expect(prisma.listaEspera.count).not.toHaveBeenCalled();
    expect(prisma.pago.findMany).not.toHaveBeenCalled();
  });

  it('usa una clave distinta por rango de fechas', async () => {
    prisma.reserva.findMany.mockResolvedValue([]);
    prisma.listaEspera.count.mockResolvedValue(0);
    prisma.pago.findMany.mockResolvedValue([]);

    await service.getShopAnalytics('shop-1', '2026-10-01', '2026-10-07');
    await service.getShopAnalytics('shop-1', '2026-10-01', '2026-10-31');

    const claves = cache.set.mock.calls.map(([clave]: [string]) => clave);
    expect(claves).toEqual([
      'analytics:shop:shop-1:2026-10-01-2026-10-07',
      'analytics:shop:shop-1:2026-10-01-2026-10-31',
    ]);
    expect(prisma.reserva.findMany).toHaveBeenCalledTimes(2);
  });

  it('una caché caída no impide calcular: se degrada a Prisma', async () => {
    cache.get.mockRejectedValueOnce(new Error('redis caído'));
    cache.set.mockRejectedValueOnce(new Error('redis caído'));
    prisma.reserva.findMany.mockResolvedValue([]);
    prisma.listaEspera.count.mockResolvedValue(0);
    prisma.pago.findMany.mockResolvedValue([]);

    const result = await service.getShopAnalytics('shop-1', '2026-10-01', '2026-10-31');

    expect(result.resumenCitas.total).toBe(0);
    expect(prisma.reserva.findMany).toHaveBeenCalledTimes(1);
  });

  it('getShopsOverview: ADMIN_BARBERIA solo ve sus sedes vinculadas', async () => {
    prisma.usuarioRol = {
      findMany: vi.fn().mockResolvedValue([{ barberiaId: 'shop-1' }]),
    };
    prisma.barberia = {
      findMany: vi.fn().mockResolvedValue([{ id: 'shop-1', nombre: 'Sede 1', estado: 'ACTIVO' }]),
    };
    prisma.reserva.findMany.mockResolvedValue([
      { estado: 'COMPLETADA', recordatorioEnviado: true },
      { estado: 'INASISTENCIA', recordatorioEnviado: false },
    ]);
    prisma.pago.findMany.mockResolvedValue([{ monto: 200 }]);
    const user = { id: 'u1', roles: ['ADMIN_BARBERIA'], rolesDetallados: [] };
    const result = await service.getShopsOverview(user, '2026-10-01', '2026-10-31', false);
    expect(result.sedes.length).toBe(1);
    expect(result.sedes[0].barberiaId).toBe('shop-1');
    expect(result.totalesGlobales.totalCitas).toBe(2);
  });

  it('getShopsOverview: BARBERO o CLIENTE de otra sede no filtra sus métricas', async () => {
    // El usuario administra shop-1, pero solo es barbero en shop-2 (y cliente en
    // ninguna): el overview no debe devolver ni procesar la sede ajena.
    const vinculos = [
      { barberiaId: 'shop-1', rol: { nombre: 'ADMIN_BARBERIA' } },
      { barberiaId: 'shop-2', rol: { nombre: 'BARBERO' } },
    ];
    const sedes = [
      { id: 'shop-1', nombre: 'Sede 1', estado: 'ACTIVO' },
      { id: 'shop-2', nombre: 'Sede 2', estado: 'ACTIVO' },
    ];

    prisma.usuarioRol = {
      findMany: vi.fn(async ({ where }: any) => {
        expect(where.rol).toEqual({ nombre: 'ADMIN_BARBERIA' });
        expect(where.barberiaId).toEqual({ not: null });
        return vinculos
          .filter((v) => v.rol.nombre === where.rol.nombre && v.barberiaId)
          .map((v) => ({ barberiaId: v.barberiaId }));
      }),
    };
    prisma.barberia = {
      findMany: vi.fn(async ({ where }: any) =>
        sedes.filter((s) => where?.id?.in?.includes(s.id)),
      ),
    };
    prisma.reserva.findMany.mockResolvedValue([
      { estado: 'COMPLETADA', recordatorioEnviado: true },
    ]);
    prisma.pago.findMany.mockResolvedValue([{ monto: 100 }]);

    const user = { id: 'u-multi', roles: ['ADMIN_BARBERIA'], rolesDetallados: [] };
    const result = await service.getShopsOverview(user, '2026-10-01', '2026-10-31', false);

    expect(result.sedes.map((s) => s.barberiaId)).toEqual(['shop-1']);
    expect(result.sedes[0].ingresos).toBe(100);
    expect(prisma.barberia.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['shop-1'] } } }),
    );
  });

  it('getShopsOverview: deriva `activa` del estado real de la sede', async () => {
    // El global consulta primero los ids y después el detalle de cada sede.
    let llamadas = 0;
    prisma.barberia = {
      findMany: vi.fn(async ({ select }: any) => {
        llamadas += 1;
        if (llamadas === 1) {
          expect(select).toEqual({ id: true });
          return [{ id: 'shop-1' }, { id: 'shop-2' }];
        }
        // Regresión del 400 de producción: `activa` no es columna de `barberias`.
        expect(select).toEqual({ id: true, nombre: true, estado: true });
        expect(select).not.toHaveProperty('activa');
        return [
          { id: 'shop-1', nombre: 'Sede 1', estado: 'ACTIVO' },
          { id: 'shop-2', nombre: 'Sede 2', estado: 'INACTIVO' },
        ];
      }),
    };
    prisma.reserva.findMany.mockResolvedValue([]);
    prisma.pago.findMany.mockResolvedValue([]);
    const user = { id: 'admin', roles: ['ADMINISTRADOR'], rolesDetallados: [] };
    const result = await service.getShopsOverview(user, '2026-10-01', '2026-10-31', true);

    expect(result.sedes.map((s) => ({ id: s.barberiaId, activa: s.activa }))).toEqual([
      { id: 'shop-1', activa: true },
      { id: 'shop-2', activa: false },
    ]);
  });

  it('getShopsOverview: ADMINISTRADOR global ve todas las sedes', async () => {
    prisma.barberia = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'shop-1', nombre: 'Sede 1', estado: 'ACTIVO' },
        { id: 'shop-2', nombre: 'Sede 2', estado: 'ACTIVO' },
      ]),
    };
    prisma.reserva.findMany.mockResolvedValue([]);
    prisma.pago.findMany.mockResolvedValue([]);
    const user = { id: 'admin', roles: ['ADMINISTRADOR'], rolesDetallados: [] };
    const result = await service.getShopsOverview(user, '2026-10-01', '2026-10-31', true);
    expect(result.sedes.length).toBe(2);
  });

  it('getShopsOverview: el segundo llamado sale del caché y no repite las agregaciones', async () => {
    prisma.usuarioRol = {
      findMany: vi.fn().mockResolvedValue([{ barberiaId: 'shop-1' }]),
    };
    prisma.barberia = {
      findMany: vi.fn().mockResolvedValue([{ id: 'shop-1', nombre: 'Sede 1', estado: 'ACTIVO' }]),
    };
    prisma.reserva.findMany.mockResolvedValue([{ estado: 'COMPLETADA', recordatorioEnviado: true }]);
    prisma.pago.findMany.mockResolvedValue([{ monto: 500 }]);

    const user = { id: 'u1', roles: ['ADMIN_BARBERIA'], rolesDetallados: [] };
    const primero = await service.getShopsOverview(user, '2026-10-01', '2026-10-31', false);

    expect(cache.set).toHaveBeenCalledWith(
      'analytics:overview:u1:2026-10-01-2026-10-31',
      expect.objectContaining({ sedes: expect.any(Array) }),
      15 * 60 * 1000,
    );

    prisma.usuarioRol.findMany.mockClear();
    prisma.barberia.findMany.mockClear();
    prisma.reserva.findMany.mockClear();
    prisma.pago.findMany.mockClear();

    const segundo = await service.getShopsOverview(user, '2026-10-01', '2026-10-31', false);

    expect(segundo).toEqual(primero);
    expect(prisma.usuarioRol.findMany).not.toHaveBeenCalled();
    expect(prisma.reserva.findMany).not.toHaveBeenCalled();
  });

  it('getShopsOverview: la clave incluye al usuario para no filtrar sedes ajenas', async () => {
    prisma.usuarioRol = { findMany: vi.fn().mockResolvedValue([{ barberiaId: 'shop-1' }]) };
    prisma.barberia = {
      findMany: vi.fn().mockResolvedValue([{ id: 'shop-1', nombre: 'Sede 1', estado: 'ACTIVO' }]),
    };
    prisma.reserva.findMany.mockResolvedValue([]);
    prisma.pago.findMany.mockResolvedValue([]);

    await service.getShopsOverview({ id: 'u1', roles: [], rolesDetallados: [] }, '2026-10-01', '2026-10-31', false);
    await service.getShopsOverview({ id: 'u2', roles: [], rolesDetallados: [] }, '2026-10-01', '2026-10-31', false);

    const claves = cache.set.mock.calls.map(([clave]: [string]) => clave);
    expect(claves).toEqual([
      'analytics:overview:u1:2026-10-01-2026-10-31',
      'analytics:overview:u2:2026-10-01-2026-10-31',
    ]);
  });
});
