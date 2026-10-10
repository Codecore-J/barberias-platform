import { describe, expect, it } from 'vitest';
import { DisponibilidadService } from './disponibilidad.service.js';
import { ZONA_POR_DEFECTO, TiempoService } from '../../shared/time/tiempo.service.js';

/**
 * E2-04 / H36 · disponibilidad en la zona de la SEDE.
 *
 * La jornada se compone en `America/Santo_Domingo` (UTC-4), no con la zona del
 * proceso: una sede de 18:00 a 23:59 locales tiene sus últimos slots a las
 * 23:00–23:30 locales (03:00–03:30 UTC del día siguiente) y NINGUNO cruza la
 * medianoche. Estas pruebas deben pasar igual bajo `TZ=UTC` y bajo
 * `TZ=America/Santo_Domingo`.
 */
describe('DisponibilidadService · zona horaria de la sede (E2-04)', () => {
  const tz = ZONA_POR_DEFECTO;
  const tiempo = new TiempoService();

  /** `TIME` tal como lo escribe `parseTime` (1970-01-01 en UTC). */
  function time(h: number, m: number): Date {
    const d = new Date('1970-01-01T00:00:00Z');
    d.setUTCHours(h, m, 0, 0);
    return d;
  }

  function prismaConJornada(horaInicio: Date, horaFin: Date) {
    return {
      barberia: { findUnique: async () => ({ zonaHoraria: tz }) },
      // 2026-10-10 es sábado → día 6 en la convención de `horarios.dia_semana`.
      horario: { findFirst: async () => ({ horaInicio, horaFin }) },
      excepcionHorario: { findFirst: async () => null },
      bloqueosAgenda: { findMany: async () => [] },
      reserva: { findMany: async () => [] },
    } as any;
  }

  function servicioConJornada(horaInicio: Date, horaFin: Date) {
    return new DisponibilidadService(prismaConJornada(horaInicio, horaFin));
  }

  it('un turno de 18:00 a 23:59 locales no produce ningún slot que cruce la medianoche', async () => {
    const service = servicioConJornada(time(18, 0), time(23, 59));

    const slots = await service.calcularDisponibilidad({
      barberiaId: 'sede',
      fecha: '2026-10-10',
      duracionTotal: 30,
      margenRequerido: 0,
    });

    // 18:00 … 23:00 locales = 11 slots de 30 min; el de 23:30 terminaría a las
    // 00:00 locales y por eso NO cabe.
    expect(slots).toHaveLength(11);

    // El cierre (23:59 locales del 2026-10-10) es la 03:59 UTC del día 11.
    const finJornada = tiempo.aInstante('2026-10-10', '23:59', tz);
    for (const slot of slots) {
      expect(slot.fin.getTime()).toBeLessThanOrEqual(finJornada.getTime());
    }

    const ultimo = slots[slots.length - 1];
    expect(ultimo.inicio.toISOString()).toBe('2026-10-11T03:00:00.000Z');
    expect(ultimo.fin.toISOString()).toBe('2026-10-11T03:30:00.000Z');
  });

  it('el slot de las 21:00 locales se compone como 01:00 UTC del día siguiente', async () => {
    const service = servicioConJornada(time(18, 0), time(23, 59));

    const slots = await service.calcularDisponibilidad({
      barberiaId: 'sede',
      fecha: '2026-10-10',
      duracionTotal: 30,
      margenRequerido: 0,
    });

    const slot21 = slots.find(
      (s) => s.inicio.toISOString() === '2026-10-11T01:00:00.000Z',
    );
    expect(slot21).toBeDefined();
    expect(slot21!.fin.toISOString()).toBe('2026-10-11T01:30:00.000Z');
  });

  it('sin fecha usa HOY en la zona de la sede, no el día UTC del proceso', async () => {
    // Sábado 2026-10-10 a las 23:00 UTC: en la sede ya es el día 10 a las 19:00,
    // así que la consulta sin fecha debe caer en el sábado (turno 18:00-23:59).
    const relojFijo = new TiempoService(() => new Date('2026-10-10T23:00:00.000Z'));
    const serviceFijo = new DisponibilidadService(
      prismaConJornada(time(18, 0), time(23, 59)),
      relojFijo,
    );

    const slots = await serviceFijo.calcularDisponibilidad({
      barberiaId: 'sede',
      duracionTotal: 30,
      margenRequerido: 0,
    });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].inicio.toISOString()).toBe('2026-10-10T22:00:00.000Z');
  });
});
