import { describe, expect, it } from 'vitest';
import {
  LIMITE_INASISTENCIAS_POR_DEFECTO,
  UMBRAL_ADVERTENCIA_INASISTENCIAS,
  evaluarInasistencia,
} from './fidelizacion.js';

/**
 * E4-03 · Rojo → Verde de la regla de inasistencias (spec 01 §5.8, D48).
 *
 * El caso «5ª inasistencia» describe el comportamiento que el servicio tenía
 * escrito con un literal; aquí se fija el contrato visible: contador, bandera y
 * motivo, y la advertencia de las 3.
 */
describe('evaluarInasistencia (E4-03)', () => {
  const libre = { estaRestringido: false, motivoRestriccion: null };

  it('incrementa el contador sin restringir antes del límite', () => {
    const resultado = evaluarInasistencia(0, libre);

    expect(resultado.contadorNoPresentado).toBe(1);
    expect(resultado.estaRestringido).toBe(false);
    expect(resultado.motivoRestriccion).toBeNull();
    expect(resultado.restringidoAhora).toBe(false);
    expect(resultado.advertencia).toBe(false);
  });

  it('en la 3ª inasistencia marca advertencia pero NO restringe', () => {
    const resultado = evaluarInasistencia(2, libre);

    expect(resultado.contadorNoPresentado).toBe(UMBRAL_ADVERTENCIA_INASISTENCIAS);
    expect(resultado.advertencia).toBe(true);
    expect(resultado.estaRestringido).toBe(false);
    expect(resultado.motivoRestriccion).toBeNull();
  });

  it('en la 5ª inasistencia restringe con el motivo del límite', () => {
    const resultado = evaluarInasistencia(4, libre);

    expect(resultado.contadorNoPresentado).toBe(LIMITE_INASISTENCIAS_POR_DEFECTO);
    expect(resultado.estaRestringido).toBe(true);
    expect(resultado.restringidoAhora).toBe(true);
    expect(resultado.motivoRestriccion).toContain('5 inasistencias');
  });

  it('respeta un límite distinto de la sede', () => {
    const resultado = evaluarInasistencia(1, libre, 2);

    expect(resultado.contadorNoPresentado).toBe(2);
    expect(resultado.estaRestringido).toBe(true);
    expect(resultado.motivoRestriccion).toContain('2 inasistencias');
  });

  it('no borra el motivo de una restricción vigente ni la vuelve a crear', () => {
    const restringido = {
      estaRestringido: true,
      motivoRestriccion: 'Bloqueo automático: alcanzaste el límite de 5 inasistencias en esta barbería.',
    };

    const resultado = evaluarInasistencia(5, restringido);

    expect(resultado.contadorNoPresentado).toBe(6);
    expect(resultado.estaRestringido).toBe(true);
    expect(resultado.restringidoAhora).toBe(false);
    expect(resultado.motivoRestriccion).toBe(restringido.motivoRestriccion);
  });
});
