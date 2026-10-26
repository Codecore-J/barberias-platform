import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: any;

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
    service = new AnalyticsService(prisma);
  });

  it('valida que desde <= hasta', async () => {
    await expect(service.getShopAnalytics('shop-1', '2026-10-10', '2026-10-01')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza rango mayor a 366 días', async () => {
    await expect(service.getShopAnalytics('shop-1', '2025-01-01', '2026-01-10')).rejects.toBeInstanceOf(BadRequestException);
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
});
