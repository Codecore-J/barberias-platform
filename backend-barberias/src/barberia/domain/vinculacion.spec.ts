import { describe, expect, it } from 'vitest';
import {
  ESTADOS_VINCULACION,
  LIMITE_VINCULACIONES,
  MOTIVO_RECHAZO_VINCULACION_MIN,
  estadoDeResolucion,
  esVinculacionResoluble,
} from './vinculacion.js';

/**
 * E3-12 · las reglas puras que deciden si una vinculación se puede resolver y en
 * qué estado queda (D10). El vocabulario es cerrado: la base lo fija con un
 * CHECK, así que un estado fuera de la lista no puede llegar ni a la consulta.
 */
describe('vinculación · reglas de la resolución (D10 · E3-12)', () => {
  it('el vocabulario de estados es el de D10 y solo ese', () => {
    expect(Object.values(ESTADOS_VINCULACION)).toEqual([
      'ACTIVO',
      'PENDIENTE_APROBACION',
      'DESVINCULADO',
    ]);
  });

  it('el límite de D10 es 5: la sexta es la que espera aprobación', () => {
    expect(LIMITE_VINCULACIONES).toBe(5);
  });

  it('solo una vinculación PENDIENTE_APROBACION se puede resolver', () => {
    expect(esVinculacionResoluble(ESTADOS_VINCULACION.PENDIENTE_APROBACION)).toBe(true);
    expect(esVinculacionResoluble(ESTADOS_VINCULACION.ACTIVO)).toBe(false);
    expect(esVinculacionResoluble(ESTADOS_VINCULACION.DESVINCULADO)).toBe(false);
    expect(esVinculacionResoluble('PENDIENTE')).toBe(false);
    expect(esVinculacionResoluble('')).toBe(false);
  });

  it('aprobar deja la vinculación ACTIVO; rechazar, DESVINCULADO', () => {
    expect(estadoDeResolucion(true)).toBe(ESTADOS_VINCULACION.ACTIVO);
    expect(estadoDeResolucion(false)).toBe(ESTADOS_VINCULACION.DESVINCULADO);
  });

  it('el motivo del rechazo no puede ser una palabra suelta', () => {
    expect(MOTIVO_RECHAZO_VINCULACION_MIN).toBeGreaterThan(3);
  });
});
