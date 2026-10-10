import { describe, expect, it } from 'vitest';
import {
  TiempoService,
  ZONA_POR_DEFECTO,
  fechaCalendarioISO,
  horaRelojHHMM,
} from './tiempo.service.js';

/**
 * E2-04 / H36 · pruebas de borde de la zona horaria de la sede.
 *
 * La sede del catálogo D15 es `America/Santo_Domingo` (UTC-4, sin horario de
 * verano). Estas pruebas se ejecutan con la suite COMPLETA bajo `TZ=UTC` y bajo
 * `TZ=America/Santo_Domingo` y deben dar el MISMO resultado: los instantes se
 * componen con la zona de la sede, nunca con la del proceso.
 *
 * Antes del cambio, `new Date(fecha); setHours(21, 0)` componía «21:00» en la
 * zona del SERVIDOR: en Render (UTC) la cita real de las 21:00 locales quedaba
 * anclada a las 21:00 UTC —4 horas tarde—, y con el proceso en la propia zona de
 * la sede `fecha.getDay()` devolvía el día anterior.
 */
describe('TiempoService (E2-04)', () => {
  const tz = ZONA_POR_DEFECTO; // America/Santo_Domingo
  const tiempo = new TiempoService();

  describe('aInstante · etiquetas locales de la sede a instante UTC', () => {
    it('una cita a las 21:00 locales cae en el día UTC SIGUIENTE a la 01:00', () => {
      expect(tiempo.aInstante('2026-10-10', '21:00', tz).toISOString()).toBe(
        '2026-10-11T01:00:00.000Z',
      );
    });

    it('una cita a las 23:59 locales cae en el día UTC siguiente a las 03:59', () => {
      expect(tiempo.aInstante('2026-10-10', '23:59', tz).toISOString()).toBe(
        '2026-10-11T03:59:00.000Z',
      );
    });

    it('una cita a las 00:00 locales cae en el MISMO día UTC a las 04:00', () => {
      expect(tiempo.aInstante('2026-10-10', '00:00', tz).toISOString()).toBe(
        '2026-10-10T04:00:00.000Z',
      );
    });

    it('el cierre a medianoche del día local es la 00:00 del día siguiente en UTC', () => {
      // `horaFin` etiquetada 00:00 pertenece al inicio del día; un turno que
      // termina a medianoche se representa como las 00:00 locales del día
      // SIGUIENTE, que es lo que se compara contra la jornada.
      const cierre = tiempo.aInstante('2026-10-11', '00:00', tz);
      expect(cierre.toISOString()).toBe('2026-10-11T04:00:00.000Z');
      // Y es exactamente 4 h después de la 20:00 local del día anterior.
      const inicio = tiempo.aInstante('2026-10-10', '20:00', tz);
      expect(cierre.getTime() - inicio.getTime()).toBe(4 * 60 * 60 * 1000);
    });
  });

  describe('desdeInstante · instante UTC a etiqueta local de la sede', () => {
    it('01:00 UTC del día 11 es la 21:00 local del día 10', () => {
      expect(
        tiempo.desdeInstante(new Date('2026-10-11T01:00:00.000Z'), tz),
      ).toEqual({ fecha: '2026-10-10', hora: '21:00' });
    });

    it('03:59 UTC del día 11 sigue siendo el día local 10 a las 23:59', () => {
      expect(
        tiempo.desdeInstante(new Date('2026-10-11T03:59:00.000Z'), tz),
      ).toEqual({ fecha: '2026-10-10', hora: '23:59' });
    });

    it('el round-trip etiqueta → instante → etiqueta se conserva', () => {
      for (const [fecha, hora] of [
        ['2026-10-10', '21:00'],
        ['2026-10-10', '23:59'],
        ['2026-10-10', '00:00'],
      ] as const) {
        const partes = tiempo.desdeInstante(tiempo.aInstante(fecha, hora, tz), tz);
        expect(partes).toEqual({ fecha, hora });
      }
    });
  });

  describe('diaSemana · día de calendario en la zona de la sede', () => {
    it('el 2026-10-05 (lunes) devuelve 1 aunque la medianoche UTC sea domingo local', () => {
      // Regresión de H36: `new Date('2026-10-05').getDay()` con el proceso en
      // America/Santo_Domingo daba 0 (domingo) porque la medianoche UTC es la
      // 20:00 del día 4 en la sede; el día de la semana quedaba corrido.
      expect(tiempo.diaSemana('2026-10-05', tz)).toBe(1);
    });

    it('el domingo local es 7 (convención de `horarios.dia_semana`)', () => {
      expect(tiempo.diaSemana('2026-10-11', tz)).toBe(7);
    });

    it('el día etiquetado no cambia con la zona del servidor', () => {
      // La zona pasada es la de la SEDE; el resultado es idéntico sin importar
      // el TZ del proceso que ejecuta la suite.
      expect(tiempo.diaSemana('2026-10-10', tz)).toBe(6);
    });
  });

  describe('reloj inyectable', () => {
    it('ahora() devuelve el instante del reloj inyectado, no el real', () => {
      const fijo = new Date('2026-10-10T12:00:00.000Z');
      const conRelojFijo = new TiempoService(() => fijo);
      expect(conRelojFijo.ahora().toISOString()).toBe(fijo.toISOString());
    });

    it('el reloj por defecto devuelve un instante real', () => {
      expect(Math.abs(tiempo.ahora().getTime() - Date.now())).toBeLessThan(1000);
    });
  });

  describe('helpers de etiqueta (sin `toISOString().slice` sobre citas)', () => {
    it('fechaCalendarioISO lee las partes UTC de un DATE', () => {
      expect(fechaCalendarioISO(new Date('2026-10-10T00:00:00.000Z'))).toBe('2026-10-10');
    });

    it('horaRelojHHMM lee las partes UTC de un TIME', () => {
      const time = new Date('1970-01-01T00:00:00Z');
      time.setUTCHours(21, 5, 0, 0);
      expect(horaRelojHHMM(time)).toBe('21:05');
    });

    it('fechaDeCalendario normaliza a la medianoche UTC de la etiqueta', () => {
      expect(tiempo.fechaDeCalendario('2026-10-10').toISOString()).toBe(
        '2026-10-10T00:00:00.000Z',
      );
    });
  });
});
