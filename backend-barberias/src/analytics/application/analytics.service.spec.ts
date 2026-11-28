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
        // F8 · el overview agrega por sede en la base con `groupBy`.
        groupBy: vi.fn(),
        count: vi.fn(),
      },
      listaEspera: {
        count: vi.fn(),
      },
      pago: {
        findMany: vi.fn(),
        // F8 · ingresos por sede en una sola consulta.
        groupBy: vi.fn(),
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
    prisma.reserva.groupBy.mockResolvedValue([
      { barberiaId: 'shop-1', estado: 'COMPLETADA', recordatorioEnviado: true, _count: { _all: 1 } },
      { barberiaId: 'shop-1', estado: 'INASISTENCIA', recordatorioEnviado: false, _count: { _all: 1 } },
    ]);
    prisma.pago.groupBy.mockResolvedValue([{ barberiaId: 'shop-1', _sum: { monto: 200 } }]);
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
    prisma.reserva.groupBy.mockResolvedValue([
      { barberiaId: 'shop-1', estado: 'COMPLETADA', recordatorioEnviado: true, _count: { _all: 1 } },
    ]);
    prisma.pago.groupBy.mockResolvedValue([{ barberiaId: 'shop-1', _sum: { monto: 100 } }]);

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
    prisma.reserva.groupBy.mockResolvedValue([]);
    prisma.pago.groupBy.mockResolvedValue([]);
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
    prisma.reserva.groupBy.mockResolvedValue([]);
    prisma.pago.groupBy.mockResolvedValue([]);
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
    prisma.reserva.groupBy.mockResolvedValue([
      { barberiaId: 'shop-1', estado: 'COMPLETADA', recordatorioEnviado: true, _count: { _all: 1 } },
    ]);
    prisma.pago.groupBy.mockResolvedValue([{ barberiaId: 'shop-1', _sum: { monto: 500 } }]);

    const user = { id: 'u1', roles: ['ADMIN_BARBERIA'], rolesDetallados: [] };
    const primero = await service.getShopsOverview(user, '2026-10-01', '2026-10-31', false);

    expect(cache.set).toHaveBeenCalledWith(
      'analytics:overview:u1:2026-10-01-2026-10-31',
      expect.objectContaining({ sedes: expect.any(Array) }),
      15 * 60 * 1000,
    );

    prisma.usuarioRol.findMany.mockClear();
    prisma.barberia.findMany.mockClear();
    prisma.reserva.groupBy.mockClear();
    prisma.pago.groupBy.mockClear();

    const segundo = await service.getShopsOverview(user, '2026-10-01', '2026-10-31', false);

    expect(segundo).toEqual(primero);
    expect(prisma.usuarioRol.findMany).not.toHaveBeenCalled();
    expect(prisma.reserva.groupBy).not.toHaveBeenCalled();
  });

  it('getShopsOverview: la clave incluye al usuario para no filtrar sedes ajenas', async () => {
    prisma.usuarioRol = { findMany: vi.fn().mockResolvedValue([{ barberiaId: 'shop-1' }]) };
    prisma.barberia = {
      findMany: vi.fn().mockResolvedValue([{ id: 'shop-1', nombre: 'Sede 1', estado: 'ACTIVO' }]),
    };
    prisma.reserva.groupBy.mockResolvedValue([]);
    prisma.pago.groupBy.mockResolvedValue([]);

    await service.getShopsOverview({ id: 'u1', roles: [], rolesDetallados: [] }, '2026-10-01', '2026-10-31', false);
    await service.getShopsOverview({ id: 'u2', roles: [], rolesDetallados: [] }, '2026-10-01', '2026-10-31', false);

    const claves = cache.set.mock.calls.map(([clave]: [string, unknown]) => clave);
    expect(claves).toEqual([
      'analytics:overview:u1:2026-10-01-2026-10-31',
      'analytics:overview:u2:2026-10-01-2026-10-31',
    ]);
  });

  /**
   * F8 · el overview de sedes hacía 4N+2 consultas: por cada sede leía sus
   * reservas TRES veces (totales, inasistencias y cancelaciones) y sus pagos una
   * vez. Con 13 sedes eran 54 consultas y con 50 pasaban de 200, todas en serie
   * dentro del bucle.
   *
   * La agregación tiene que ocurrir en la base con DOS `groupBy` —reservas por
   * sede/estado/recordatorio y pagos por sede—: así el número de consultas deja
   * de depender de cuántas sedes haya.
   */
  it('el overview agrega en la base: consultas constantes aunque haya 25 sedes', async () => {
    const sedes = Array.from({ length: 25 }, (_, i) => ({
      id: `shop-${i}`,
      nombre: `Sede ${i}`,
      estado: 'ACTIVO',
    }));
    prisma.barberia = { findMany: vi.fn().mockResolvedValue(sedes) };
    prisma.reserva.groupBy.mockResolvedValue([]);
    prisma.pago.groupBy.mockResolvedValue([]);

    await service.getShopsOverview(
      { id: 'admin', roles: ['ADMINISTRADOR'], rolesDetallados: [] },
      '2026-10-01',
      '2026-10-31',
      true,
    );

    // Ni una lectura por sede: la base agrega y el servicio solo reparte.
    expect(prisma.reserva.findMany).not.toHaveBeenCalled();
    expect(prisma.pago.findMany).not.toHaveBeenCalled();
    expect(prisma.reserva.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.pago.groupBy).toHaveBeenCalledTimes(1);
  });

  /**
   * F8 · el arreglo de rendimiento no puede cambiar las cifras. Las tasas
   * globales se calculan sobre los MISMOS estados cerrados que antes y un pago
   * de una sede no se atribuye a otra.
   */
  it('el overview saca de los recuentos las mismas tasas y totales por sede', async () => {
    prisma.barberia = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'shop-1', nombre: 'Sede 1', estado: 'ACTIVO' },
        { id: 'shop-2', nombre: 'Sede 2', estado: 'INACTIVO' },
      ]),
    };
    prisma.reserva.groupBy.mockResolvedValue([
      { barberiaId: 'shop-1', estado: 'COMPLETADA', recordatorioEnviado: true, _count: { _all: 2 } },
      { barberiaId: 'shop-1', estado: 'INASISTENCIA', recordatorioEnviado: false, _count: { _all: 1 } },
      { barberiaId: 'shop-1', estado: 'CANCELADA', recordatorioEnviado: false, _count: { _all: 1 } },
      { barberiaId: 'shop-2', estado: 'PENDIENTE', recordatorioEnviado: false, _count: { _all: 3 } },
    ]);
    prisma.pago.groupBy.mockResolvedValue([
      { barberiaId: 'shop-1', _sum: { monto: 150.5 } },
      { barberiaId: 'shop-2', _sum: { monto: 20 } },
    ]);

    const result = await service.getShopsOverview(
      { id: 'admin', roles: ['ADMINISTRADOR'], rolesDetallados: [] },
      '2026-10-01',
      '2026-10-31',
      true,
    );

    expect(result.sedes).toEqual([
      {
        barberiaId: 'shop-1',
        nombre: 'Sede 1',
        activa: true,
        ingresos: 150.5,
        totalCitas: 4,
        citasCompletadas: 2,
        tasaInasistencia: 25,
        recordatoriosEnviados: 2,
      },
      {
        barberiaId: 'shop-2',
        nombre: 'Sede 2',
        activa: false,
        ingresos: 20,
        totalCitas: 3,
        citasCompletadas: 0,
        tasaInasistencia: 0,
        recordatoriosEnviados: 0,
      },
    ]);
    // Cerradas: 4 de shop-1 (+0 de shop-2, que solo tiene PENDIENTE).
    // Inasistencias 1/4 y canceladas 1/4.
    expect(result.totalesGlobales).toEqual({
      ingresosConsolidados: 170.5,
      totalCitas: 7,
      tasaGlobalInasistencia: 25,
      tasaGlobalCancelacion: 25,
    });
  });
});
