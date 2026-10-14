import { describe, expect, it } from 'vitest';
import {
  LIMITE_INASISTENCIAS_POR_DEFECTO,
  PUNTUALIDAD_MARGEN_MIN,
  TOLERANCIA_MIN,
  UMBRAL_ADVERTENCIA_INASISTENCIAS,
  VENTANA_NO_PRESENTADO_MIN,
  describirEstadoFidelizacion,
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

  // ── H52 · la ventana del no presentado (§5.8) ─────────────────────────────
  it('H52: la ventana del no presentado son 5 minutos de puntualidad + 10 de tolerancia', () => {
    expect(PUNTUALIDAD_MARGEN_MIN).toBe(5);
    expect(TOLERANCIA_MIN).toBe(10);
    expect(VENTANA_NO_PRESENTADO_MIN).toBe(15);
  });
});

/**
 * H54 (E4-03/2) · la vista pública del contador: es la MISMA regla traducida al
 * lenguaje del cliente, no una segunda cuenta paralela.
 */
describe('describirEstadoFidelizacion (H54)', () => {
  const libre = (contadorNoPresentado: number) => ({
    contadorNoPresentado,
    estaRestringido: false,
    motivoRestriccion: null,
  });

  it('por debajo del umbral no hay nada que avisar', () => {
    const estado = describirEstadoFidelizacion(libre(2));

    expect(estado).toMatchObject({
      advertencia: false,
      inasistenciasParaRestriccion: LIMITE_INASISTENCIAS_POR_DEFECTO - 2,
      mensaje: null,
    });
  });

  it('a las 3 inasistencias avisa cuántas faltan para el bloqueo de la sede', () => {
    const estado = describirEstadoFidelizacion(libre(UMBRAL_ADVERTENCIA_INASISTENCIAS));

    expect(estado.advertencia).toBe(true);
    expect(estado.estaRestringido).toBe(false);
    expect(estado.mensaje).toBe('Estás a 2 inasistencias de ser suspendido en esta barbería.');
  });

  it('a UNA inasistencia usa el singular', () => {
    const estado = describirEstadoFidelizacion(libre(4));

    expect(estado.inasistenciasParaRestriccion).toBe(1);
    expect(estado.mensaje).toBe('Estás a 1 inasistencia de ser suspendido en esta barbería.');
  });

  it('con el límite alcanzado pero sin bandera no promete un número imposible', () => {
    const estado = describirEstadoFidelizacion(libre(LIMITE_INASISTENCIAS_POR_DEFECTO));

    expect(estado.inasistenciasParaRestriccion).toBe(0);
    expect(estado.mensaje).toBe('Alcanzaste el límite de inasistencias de esta barbería.');
  });

  it('restringido: el mensaje es el motivo de la sede', () => {
    const motivo = 'Bloqueo automático: alcanzaste el límite de 5 inasistencias en esta barbería.';
    const estado = describirEstadoFidelizacion({
      contadorNoPresentado: 5,
      estaRestringido: true,
      motivoRestriccion: motivo,
    });

    expect(estado).toMatchObject({
      advertencia: true,
      estaRestringido: true,
      inasistenciasParaRestriccion: 0,
      mensaje: motivo,
    });
  });

  it('restringido sin motivo guardado no deja el mensaje vacío', () => {
    const estado = describirEstadoFidelizacion({
      contadorNoPresentado: 5,
      estaRestringido: true,
      motivoRestriccion: null,
    });

    expect(estado.mensaje).toBe('Estás restringido para reservar en esta barbería.');
  });
});
