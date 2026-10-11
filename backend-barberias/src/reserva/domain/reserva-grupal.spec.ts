import { describe, expect, it } from 'vitest';
import {
  calcularBloqueGrupal,
  contarParticipantes,
  MAX_PARTICIPANTES_POR_GRUPO,
  mensajeDeProblema,
  validarGrupoGrupal,
  type ParticipanteDelGrupo,
  type ParticipanteParaValidar,
} from './reserva-grupal.js';

/**
 * E4-01 · calculadora del bloque grupal (D42/D46, §5.4).
 *
 * El bloque es Σ duraciones de TODOS los participantes + UN SOLO margen de la
 * sede. Estos tests son la evidencia de la aceptación «2 servicios de 30 min +
 * 10 min de margen = 70 min» y del ejemplo del diseño «35 + 30 + 30 + 10 = 105».
 */

/** Participante con servicios de una duración dada, para armar casos rápido. */
function participante(
  duraciones: number[],
  esAdultoResponsable = false,
  precio = 0,
): ParticipanteDelGrupo {
  return {
    nombre: esAdultoResponsable ? 'Adulto' : 'Niño',
    esAdultoResponsable,
    servicios: duraciones.map((duracionEstimada) => ({
      duracionEstimada,
      precio,
    })),
  };
}

describe('E4-01 · calcularBloqueGrupal', () => {
  it('2 servicios de 30 min + 10 min de margen = 70 min totales', () => {
    const bloque = calcularBloqueGrupal(
      [participante([30], true), participante([30])],
      10,
    );

    expect(bloque.duracionServicios).toBe(60);
    expect(bloque.margenGrupal).toBe(10);
    expect(bloque.duracionTotal).toBe(70);
  });

  it('ejemplo del diseño (1 adulto + 2 niños): 35 + 30 + 30 + un margen de 10 = 105', () => {
    const bloque = calcularBloqueGrupal(
      [participante([35], true), participante([30]), participante([30])],
      10,
    );

    expect(bloque.duracionServicios).toBe(95);
    expect(bloque.margenGrupal).toBe(10);
    expect(bloque.duracionTotal).toBe(105);
  });

  it('aplica el margen UNA sola vez, nunca un margen por participante ni por servicio', () => {
    // Cuatro servicios repartidos en tres participantes: si el margen se
    // aplicara por persona el total sería 80 + 30 = 110, y por servicio 140.
    const bloque = calcularBloqueGrupal(
      [
        participante([20, 20], true),
        participante([20]),
        participante([20]),
      ],
      10,
    );

    expect(bloque.duracionTotal).toBe(90);
    expect(bloque.duracionTotal).toBe(bloque.duracionServicios + bloque.margenGrupal);
  });

  it('con margen 0 el bloque es exactamente Σ duraciones', () => {
    const bloque = calcularBloqueGrupal(
      [participante([45], true), participante([15])],
      0,
    );

    expect(bloque.duracionServicios).toBe(60);
    expect(bloque.margenGrupal).toBe(0);
    expect(bloque.duracionTotal).toBe(60);
  });

  it('suma los precios de TODOS los participantes en el total a pagar (§5.4)', () => {
    const bloque = calcularBloqueGrupal(
      [participante([35], true, 40), participante([30], false, 25), participante([30], false, 25)],
      10,
    );

    expect(bloque.precioTotal).toBe(90);
  });

  it('un mismo servicio tomado por dos participantes se cobra y dura dos veces', () => {
    const bloque = calcularBloqueGrupal(
      [participante([30], true, 20), participante([30], false, 20)],
      10,
    );

    expect(bloque.duracionServicios).toBe(60);
    expect(bloque.precioTotal).toBe(40);
  });
});

describe('E4-01 · contarParticipantes (D46)', () => {
  it('el adulto responsable CUENTA como persona y los niños son el resto', () => {
    expect(contarParticipantes([{ esAdultoResponsable: true }, { esAdultoResponsable: false }, { esAdultoResponsable: false }])).toEqual({
      personas: 3,
      ninos: 2,
      adultos: 1,
    });
  });

  it('sin niños, el grupo tiene una persona y ningún niño', () => {
    expect(contarParticipantes([{ esAdultoResponsable: true }])).toEqual({
      personas: 1,
      ninos: 0,
      adultos: 1,
    });
  });
});

describe('E4-01 · validarGrupoGrupal', () => {
  const adulto: ParticipanteParaValidar = {
    nombre: 'Adulto',
    esAdultoResponsable: true,
    servicios: ['s1'],
  };
  const nino = (nombre = 'Niño'): ParticipanteParaValidar => ({
    nombre,
    esAdultoResponsable: false,
    servicios: ['s2'],
  });

  const SIN_LIMITES = { maxPersonasTotal: null, maxNinos: null };
  const LIMITES_3_2 = { maxPersonasTotal: 3, maxNinos: 2 };

  it('VERDE: 1 adulto + 2 niños que caben en max_personas_total = 3 y max_ninos = 2', () => {
    expect(validarGrupoGrupal([adulto, nino('A'), nino('B')], LIMITES_3_2)).toBeNull();
  });

  it('VERDE (borde exacto): personas = max_personas_total y ninos = max_ninos', () => {
    expect(validarGrupoGrupal([adulto, nino('A'), nino('B')], { maxPersonasTotal: 3, maxNinos: 2 })).toBeNull();
    expect(validarGrupoGrupal([adulto, nino('A')], { maxPersonasTotal: 2, maxNinos: 1 })).toBeNull();
  });

  it('ROJO: 1 adulto + 3 niños con max_ninos = 2 → CAPACIDAD sobre maxNinos', () => {
    const problema = validarGrupoGrupal(
      [adulto, nino('A'), nino('B'), nino('C')],
      { maxPersonasTotal: 5, maxNinos: 2 },
    );

    expect(problema).toEqual({
      tipo: 'CAPACIDAD',
      campo: 'maxNinos',
      limite: 2,
      solicitado: 3,
    });
    expect(mensajeDeProblema(problema!)).toContain('2');
  });

  it('ROJO: 4 personas con max_personas_total = 3 → CAPACIDAD sobre maxPersonasTotal', () => {
    const problema = validarGrupoGrupal(
      [adulto, nino('A'), nino('B'), nino('C')],
      { maxPersonasTotal: 3, maxNinos: 9 },
    );

    expect(problema).toEqual({
      tipo: 'CAPACIDAD',
      campo: 'maxPersonasTotal',
      limite: 3,
      solicitado: 4,
    });
  });

  it('un límite nulo de la sede NO desactiva el tope duro de plataforma (8)', () => {
    const grupo: ParticipanteParaValidar[] = [adulto];
    for (let i = 0; i < MAX_PARTICIPANTES_POR_GRUPO; i++) {
      grupo.push(nino(`Niño ${i}`));
    }

    const problema = validarGrupoGrupal(grupo, SIN_LIMITES);

    expect(problema).toEqual({
      tipo: 'CAPACIDAD',
      campo: 'MAX_PARTICIPANTES_POR_GRUPO',
      limite: MAX_PARTICIPANTES_POR_GRUPO,
      solicitado: MAX_PARTICIPANTES_POR_GRUPO + 1,
    });
  });

  it('VERDE: un límite nulo significa «sin límite propio de la sede», no «sin validación»', () => {
    expect(validarGrupoGrupal([adulto, nino('A'), nino('B')], SIN_LIMITES)).toBeNull();
  });

  it('ROJO: dos adultos → ADULTOS', () => {
    expect(
      validarGrupoGrupal([adulto, { ...nino('Otro adulto'), esAdultoResponsable: true }], LIMITES_3_2),
    ).toEqual({ tipo: 'ADULTOS', adultos: 2 });
  });

  it('ROJO: ningún adulto responsable → ADULTOS con 0', () => {
    expect(validarGrupoGrupal([nino('A'), nino('B')], LIMITES_3_2)).toEqual({
      tipo: 'ADULTOS',
      adultos: 0,
    });
  });

  it('ROJO: grupo sin servicios en un participante → PARTICIPANTE_SIN_SERVICIOS', () => {
    expect(
      validarGrupoGrupal([adulto, { nombre: 'Niño sin corte', esAdultoResponsable: false, servicios: [] }], LIMITES_3_2),
    ).toEqual({ tipo: 'PARTICIPANTE_SIN_SERVICIOS', indice: 1 });
  });

  it('ROJO: solo el adulto (sin niños) → GRUPO_INCOMPLETO', () => {
    expect(validarGrupoGrupal([adulto], SIN_LIMITES)).toEqual({ tipo: 'GRUPO_INCOMPLETO' });
  });

  it('ROJO: un participante sin nombre → PARTICIPANTE_SIN_NOMBRE', () => {
    expect(
      validarGrupoGrupal([adulto, { nombre: '   ', esAdultoResponsable: false, servicios: ['s1'] }], LIMITES_3_2),
    ).toEqual({ tipo: 'PARTICIPANTE_SIN_NOMBRE', indice: 1 });
  });

  it('la capacidad de la sede se evalúa aunque el tope de plataforma no se alcance', () => {
    // 3 personas caben en el tope de 8, pero no en una sede con max_personas_total = 2.
    expect(
      validarGrupoGrupal([adulto, nino('A'), nino('B')], { maxPersonasTotal: 2, maxNinos: null }),
    ).toEqual({ tipo: 'CAPACIDAD', campo: 'maxPersonasTotal', limite: 2, solicitado: 3 });
  });
});
