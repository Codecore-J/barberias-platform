import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { TiempoService } from '../../shared/time/tiempo.service.js';

/**
 * F8 / T-82 · guard de regresión del N+1 del overview.
 *
 * T-80 midió con `log_min_duration_statement = 0` y encontró que el overview de
 * sedes era el único patrón N+1 del backend: por cada sede leía sus reservas
 * TRES veces y sus pagos una (4N+2 consultas; con 13 sedes, 54). La corrección
 * (`3d3f0af`) dejó la base agregando, así que el número de consultas es
 * CONSTANTE.
 *
 * Este test no mide milisegundos de pared —eso depende de la máquina—: cuenta
 * INVOCACIONES al mock de Prisma. Si alguien vuelve a meter una consulta dentro
 * del bucle de sedes, `conTreinta.consultas > conTres.consultas` y el test falla,
 * aunque con tres filas parezca rápido. `console.time` acompaña la medición para
 * poder comparar antes/después en la salida.
 */

const CACHE = { get: async () => undefined, set: async () => undefined };

function crearPrisma(numeroDeSedes: number) {
  const sedes = Array.from({ length: numeroDeSedes }, (_, indice) => ({
    id: `sede-${indice}`,
    nombre: `Sede ${indice}`,
    estado: 'ACTIVO',
  }));

  return {
    barberia: {
      findMany: vi.fn(async () => sedes),
      findUnique: vi.fn(async () => null),
    },
    reserva: { groupBy: vi.fn(async () => []) },
    pago: { groupBy: vi.fn(async () => []) },
    usuarioRol: { findMany: vi.fn(async () => []) },
  };
}

type PrismaDePrueba = ReturnType<typeof crearPrisma>;

function contarConsultas(prisma: PrismaDePrueba): number {
  return (
    prisma.barberia.findMany.mock.calls.length +
    prisma.barberia.findUnique.mock.calls.length +
    prisma.reserva.groupBy.mock.calls.length +
    prisma.pago.groupBy.mock.calls.length +
    prisma.usuarioRol.findMany.mock.calls.length
  );
}

function crearServicio(prisma: PrismaDePrueba): AnalyticsService {
  return new AnalyticsService(
    prisma as unknown as PrismaService,
    CACHE as never,
    new TiempoService(),
  );
}

async function medirOverview(numeroDeSedes: number): Promise<{ consultas: number; sedes: number }> {
  const prisma = crearPrisma(numeroDeSedes);
  const servicio = crearServicio(prisma);

  console.time(`[T-82] overview ${numeroDeSedes} sedes`);
  const overview = await servicio.getShopsOverview(
    { id: 'uuid-administrador' },
    '2026-11-01',
    '2026-11-30',
    true,
  );
  console.timeEnd(`[T-82] overview ${numeroDeSedes} sedes`);

  const consultas = contarConsultas(prisma);
  console.info(`[T-82] ${numeroDeSedes} sedes → ${consultas} consultas`);

  return { consultas, sedes: overview.sedes.length };
}

describe('AnalyticsService · overview sin N+1 (F8 / T-82)', () => {
  it('ROJO si el número de consultas crece con las sedes', async () => {
    const conTres = await medirOverview(3);
    const conTreinta = await medirOverview(30);

    expect(conTres.sedes).toBe(3);
    expect(conTreinta.sedes).toBe(30);

    // La firma del N+1 es esta desigualdad: con la corrección de T-80 las dos
    // medidas son idénticas.
    expect(conTreinta.consultas).toBe(conTres.consultas);
    // Y el techo real: sedes + reservas agrupadas + pagos agrupados (global).
    expect(conTreinta.consultas).toBeLessThanOrEqual(6);
  });

  it('las reservas y los pagos se agrupan POR SEDE en la base, no en memoria', async () => {
    const prisma = crearPrisma(3);

    await crearServicio(prisma).getShopsOverview(
      { id: 'uuid-administrador' },
      '2026-11-01',
      '2026-11-30',
      true,
    );

    // Una consulta agrupada por tabla, no una por sede.
    expect(prisma.reserva.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.pago.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.reserva.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['barberiaId', 'estado', 'recordatorioEnviado'],
      _count: { _all: true },
    });
  });
});
