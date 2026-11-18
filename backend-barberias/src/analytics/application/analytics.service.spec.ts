import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { TiempoService } from '../../shared/time/tiempo.service.js';

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
        count: vi.fn(),
      },
      listaEspera: {
        count: vi.fn(),
      },
      pago: {
        findMany: vi.fn(),
        // T-15 · el home de plataforma agrega el día con `aggregate`.
        aggregate: vi.fn(),
      },
      barberia: { count: vi.fn() },
      cierreCaja: { count: vi.fn() },
      usuario: { count: vi.fn() },
    };
    cache = crearCacheMock();
    service = new AnalyticsService(prisma, cache as any, new TiempoService());
  });

  /**
   * T-15 · métricas del día de la PLATAFORMA.
   *
   * Lo que se fija: que el día se acota en local con rango semiabierto, que un
   * cobro ANULADO no suma, y que «sin datos» devuelve `0` y no `null` — la
   * pantalla tiene que poder distinguir «cero real» de «no cargó».
   */
  describe('metricasPlataformaHoy', () => {
    beforeEach(() => {
      prisma.barberia.count.mockResolvedValue(3);
      prisma.reserva.count.mockResolvedValue(12);
      prisma.pago.aggregate.mockResolvedValue({ _sum: { monto: 1250.5 } });
      prisma.cierreCaja.count.mockResolvedValue(1);
      prisma.usuario.count.mockResolvedValue(48);
    });

    it('devuelve los cinco contadores del día', async () => {
      const resultado = await service.metricasPlataformaHoy();

      expect(resultado).toMatchObject({
        sedesActivas: 3,
        citasHoy: 12,
        recaudadoHoy: 1250.5,
        cajasAbiertas: 1,
        usuariosActivos: 48,
      });
      expect(resultado.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    /**
     * T-42 · el día se decide en la zona de la SEDE, no en la del proceso.
     *
     * 02:30 UTC del 17 es 22:30 del 16 en `America/Santo_Domingo`: para el
     * operador «hoy» sigue siendo el 16, y una cita etiquetada 16 tiene que
     * contar. Con el reloj del proceso en UTC —o en Europe/Madrid— la ventana
     * se iba al 17 y «Citas hoy» devolvía 0 con citas reales en el día.
     */
    it('acota el día en la zona de la sede con rango semiabierto [hoy, mañana)', async () => {
      service = new AnalyticsService(
        prisma,
        cache as any,
        new TiempoService(() => new Date('2026-11-17T02:30:00.000Z')),
      );

      const resultado = await service.metricasPlataformaHoy();

      expect(resultado.fecha).toBe('2026-11-16');
      expect(prisma.reserva.count).toHaveBeenCalledWith({
        where: {
          fechaCita: {
            gte: new Date('2026-11-16T00:00:00.000Z'),
            lt: new Date('2026-11-17T00:00:00.000Z'),
          },
        },
      });
    });

    it('fecha el dinero en instantes de la sede, no en medianoches del proceso', async () => {
      service = new AnalyticsService(
        prisma,
        cache as any,
        new TiempoService(() => new Date('2026-11-17T02:30:00.000Z')),
      );

      await service.metricasPlataformaHoy();

      // Santo Domingo es UTC-4 todo el año: el 16 local empieza a las 04:00 UTC.
      const args = prisma.pago.aggregate.mock.calls[0][0];
      expect(args.where.registradoAt.gte.toISOString()).toBe('2026-11-16T04:00:00.000Z');
      expect(args.where.registradoAt.lt.toISOString()).toBe('2026-11-17T04:00:00.000Z');
    });

    it('un cobro de las 23:30 locales sigue siendo «hoy»', async () => {
      // 03:30 UTC del 18 = 23:30 del 17 local: el día no se adelanta al 18.
      service = new AnalyticsService(
        prisma,
        cache as any,
        new TiempoService(() => new Date('2026-11-18T03:30:00.000Z')),
      );

      const resultado = await service.metricasPlataformaHoy();
      const args = prisma.pago.aggregate.mock.calls[0][0];

      expect(resultado.fecha).toBe('2026-11-17');
      expect(args.where.registradoAt.gte.toISOString()).toBe('2026-11-17T04:00:00.000Z');
      expect(args.where.registradoAt.lt.toISOString()).toBe('2026-11-18T04:00:00.000Z');
    });

    it('no cuenta los cobros anulados y fecha el ingreso por registrado_at', async () => {
      await service.metricasPlataformaHoy();

      const args = prisma.pago.aggregate.mock.calls[0][0];
      expect(args.where.estadoPago).toEqual({ not: 'ANULADO' });
      expect(args.where.registradoAt.gte).toBeInstanceOf(Date);
      expect(args.where.registradoAt.lt).toBeInstanceOf(Date);
      expect(args._sum).toEqual({ monto: true });
    });

    it('sin datos devuelve 0, nunca null', async () => {
      prisma.barberia.count.mockResolvedValue(0);
      prisma.reserva.count.mockResolvedValue(0);
      prisma.pago.aggregate.mockResolvedValue({ _sum: { monto: null } });
      prisma.cierreCaja.count.mockResolvedValue(0);
      prisma.usuario.count.mockResolvedValue(0);

      const resultado = await service.metricasPlataformaHoy();

      expect(resultado.recaudadoHoy).toBe(0);
      expect(resultado.citasHoy).toBe(0);
      for (const valor of [
        resultado.sedesActivas,
        resultado.citasHoy,
        resultado.recaudadoHoy,
        resultado.cajasAbiertas,
        resultado.usuariosActivos,
      ]) {
        expect(typeof valor).toBe('number');
      }
    });
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

    const claves = cache.set.mock.calls.map(([clave]: [string, unknown]) => clave);
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

    const claves = cache.set.mock.calls.map(([clave]: [string, unknown]) => clave);
    expect(claves).toEqual([
      'analytics:overview:u1:2026-10-01-2026-10-31',
      'analytics:overview:u2:2026-10-01-2026-10-31',
    ]);
  });
});
