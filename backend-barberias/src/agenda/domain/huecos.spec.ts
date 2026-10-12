import { describe, expect, it } from 'vitest';
import {
  MAXIMO_ALTERNATIVAS,
  PASO_MINUTOS,
  elegirAlternativas,
  estaSolapado,
  fusionarIntervalos,
  proyectarTramosLibres,
  type Intervalo,
} from './huecos.js';

/**
 * E4-02 · tests del cálculo PURO de huecos (D47).
 *
 * Este módulo es el ÚNICO algoritmo de huecos del sistema: lo comparten las
 * alternativas del Carril A (el error de la reserva) y los huecos que la sede
 * expone en el Carril B (D22). Aquí se comprueba la proyección pura, sin
 * Prisma ni Nest, que es justo lo que garantiza D37/H41: nada se retiene.
 */

/** 2026-10-12 a las 00:00 UTC. Fecha fija: el cálculo no lee el reloj. */
const DIA = '2026-10-12';

function enMinutos(hora: number, minuto = 0): number {
  return hora * 60 + minuto;
}

/** Jornada de 09:00 a 17:00 del día fijo, como instantes UTC. */
function jornadaDe9a17(): Intervalo {
  return {
    inicio: new Date(`${DIA}T09:00:00.000Z`),
    fin: new Date(`${DIA}T17:00:00.000Z`),
  };
}

function intervalo(desde: number, hasta: number): Intervalo {
  const base = new Date(`${DIA}T00:00:00.000Z`).getTime();
  return { inicio: new Date(base + desde * 60000), fin: new Date(base + hasta * 60000) };
}

function minutosDesdeElInicio(tramo: Intervalo): number {
  const base = new Date(`${DIA}T09:00:00.000Z`).getTime();
  return (tramo.inicio.getTime() - base) / 60000;
}

describe('E4-02 · proyectarTramosLibres (la proyección de E3-02, ahora pura)', () => {
  it('con la jornada vacía devuelve tramos cada 15 minutos (D41)', () => {
    const tramos = proyectarTramosLibres(jornadaDe9a17(), [], 30, PASO_MINUTOS);

    // De 09:00 a 16:30 caben 31 inicios: 09:00, 09:15 … 16:30 (16:45 no cabe).
    expect(tramos).toHaveLength(31);
    expect(minutosDesdeElInicio(tramos[0])).toBe(0);
    expect(minutosDesdeElInicio(tramos[1])).toBe(15);
    expect(minutosDesdeElInicio(tramos[30])).toBe(450);
    // El bloque completo debe caber dentro de la jornada.
    expect(tramos.every((t) => t.fin.getTime() <= jornadaDe9a17().fin.getTime())).toBe(true);
  });

  it('un bloque ocupa la duración pedida, margen incluido (§5.4)', () => {
    const [tramo] = proyectarTramosLibres(jornadaDe9a17(), [], 105, PASO_MINUTOS);

    expect((tramo.fin.getTime() - tramo.inicio.getTime()) / 60000).toBe(105);
  });

  it('descarta los tramos que chocan con una ocupación', () => {
    // Reserva de 11:00 a 12:00.
    const ocupados = [intervalo(enMinutos(11), enMinutos(12))];
    const tramos = proyectarTramosLibres(jornadaDe9a17(), ocupados, 30, PASO_MINUTOS);

    // El primer tramo que empieza a las 12:00 ya no solapa (fin 12:30 > inicio ocupado).
    expect(tramos.some((t) => minutosDesdeElInicio(t) === enMinutos(11) - enMinutos(9))).toBe(false);
    expect(tramos.some((t) => minutosDesdeElInicio(t) === enMinutos(12) - enMinutos(9))).toBe(true);
  });

  it('un bloqueo parcial parte la jornada en dos tramos libres', () => {
    const ocupados = [intervalo(enMinutos(11), enMinutos(12))];
    const tramos = proyectarTramosLibres(jornadaDe9a17(), ocupados, 30, PASO_MINUTOS);

    const porLaManana = tramos.filter((t) => t.fin.getTime() <= intervalo(enMinutos(11), enMinutos(12)).inicio.getTime());
    const porLaTarde = tramos.filter((t) => t.inicio.getTime() >= intervalo(enMinutos(11), enMinutos(12)).fin.getTime());

    expect(porLaManana.length).toBeGreaterThan(0);
    expect(porLaTarde.length).toBeGreaterThan(0);
    expect(porLaManana.length + porLaTarde.length).toBe(tramos.length);
  });

  it('dos ocupaciones fusionadas dejan un solo hueco (D37: no se dobla el bloqueo)', () => {
    const solapados = [
      intervalo(enMinutos(10), enMinutos(11)),
      intervalo(enMinutos(10, 30), enMinutos(11, 30)),
    ];
    const fusionados = fusionarIntervalos(solapados);

    expect(fusionados).toHaveLength(1);
    expect(fusionados[0].inicio.getTime()).toBe(intervalo(enMinutos(10), enMinutos(11)).inicio.getTime());
    expect(fusionados[0].fin.getTime()).toBe(intervalo(enMinutos(10, 30), enMinutos(11, 30)).fin.getTime());
  });

  it('si el bloque no cabe en la jornada, no hay tramo', () => {
    const tramos = proyectarTramosLibres(jornadaDe9a17(), [], 481, PASO_MINUTOS);

    expect(tramos).toHaveLength(0);
  });

  it('una jornada sin horario (inicio >= fin) no proyecta nada', () => {
    const tramos = proyectarTramosLibres(
      { inicio: new Date(`${DIA}T17:00:00.000Z`), fin: new Date(`${DIA}T09:00:00.000Z`) },
      [],
      30,
      PASO_MINUTOS,
    );

    expect(tramos).toHaveLength(0);
  });
});

describe('E4-02 · elegirAlternativas (las dos alternativas que comparten carriles)', () => {
  const ahora = new Date(`${DIA}T08:00:00.000Z`);

  it('ordena por cercanía a la hora pedida y acota a 5 (§E4-02/2)', () => {
    const elegidas = elegirAlternativas({
      jornada: jornadaDe9a17(),
      ocupados: [],
      duracionRequeridaMinutos: 30,
      ahora,
      horaObjetivo: new Date(`${DIA}T13:00:00.000Z`),
      maximo: MAXIMO_ALTERNATIVAS,
    });
    expect(elegidas).toHaveLength(5);
    // E4-03: la fixture compone INSTANTES UTC (`...T13:00:00.000Z`), así que la
    // hora se lee en UTC. Con `getHours()` la prueba solo pasaba si el runner
    // corría en TZ=UTC y fallaba en la zona de la sede (UTC-4).
    expect(elegidas[0].inicio.getUTCHours()).toBe(13);
    expect(elegidas[0].inicio.getUTCMinutes()).toBe(0);
  });

  it('nunca ofrece dos sugerencias que se solapen entre sí', () => {
    const elegidas = elegirAlternativas({
      jornada: jornadaDe9a17(),
      ocupados: [],
      duracionRequeridaMinutos: 120,
      ahora,
      maximo: MAXIMO_ALTERNATIVAS,
    });
    for (let i = 0; i < elegidas.length; i++) {
      for (let j = i + 1; j < elegidas.length; j++) {
        expect(estaSolapado(elegidas[i], [elegidas[j]])).toBe(false);
      }
    }
  });

  it('sin hora objetivo ordena por cercanía a «ahora» (huecos de última hora)', () => {
    const elegidas = elegirAlternativas({
      jornada: jornadaDe9a17(),
      ocupados: [],
      duracionRequeridaMinutos: 30,
      ahora: new Date(`${DIA}T16:00:00.000Z`),
      maximo: MAXIMO_ALTERNATIVAS,
    });

    expect(elegidas[0].inicio.getUTCHours()).toBe(16);
    expect(elegidas[0].inicio.getUTCMinutes()).toBe(0);
  });

  it('no ofrece nada que ya haya pasado (D22: nunca un hueco consumido)', () => {
    const elegidas = elegirAlternativas({
      jornada: jornadaDe9a17(),
      ocupados: [],
      duracionRequeridaMinutos: 30,
      ahora: new Date(`${DIA}T17:30:00.000Z`),
      maximo: MAXIMO_ALTERNATIVAS,
    });

    expect(elegidas).toHaveLength(0);
  });

  it('un grupo grande solo recibe tramos donde cabe entero (D46)', () => {
    const ocupados = [intervalo(enMinutos(11), enMinutos(12))];
    const deUnAdulto = elegirAlternativas({
      jornada: jornadaDe9a17(),
      ocupados,
      duracionRequeridaMinutos: 35,
      ahora,
      maximo: MAXIMO_ALTERNATIVAS,
    });
    const deTresPersonas = elegirAlternativas({
      jornada: jornadaDe9a17(),
      ocupados,
      duracionRequeridaMinutos: 105,
      ahora,
      maximo: MAXIMO_ALTERNATIVAS,
    });

    expect(deUnAdulto.length).toBe(5);
    expect(deTresPersonas.length).toBe(3);
    // El grupo grande empieza más tarde o termina más tarde: nunca más temprano.
    expect(deTresPersonas[0].inicio.getTime()).toBeGreaterThanOrEqual(deUnAdulto[0].inicio.getTime());
    // Y su bloque siempre dura 105 minutos completos.
    expect(
      deTresPersonas.every((e) => (e.fin.getTime() - e.inicio.getTime()) / 60000 === 105),
    ).toBe(true);
  });

  it('con la sede llena no promete nada: lista vacía, nunca un hueco falso', () => {
    const ocupados = [intervalo(enMinutos(9), enMinutos(17))];
    const elegidas = elegirAlternativas({
      jornada: jornadaDe9a17(),
      ocupados,
      duracionRequeridaMinutos: 30,
      ahora,
      maximo: MAXIMO_ALTERNATIVAS,
    });

    expect(elegidas).toHaveLength(0);
  });

  it('es determinista: la misma entrada produce la misma salida (sin reloj propio)', () => {
    const solicitud = {
      jornada: jornadaDe9a17(),
      ocupados: [intervalo(enMinutos(11), enMinutos(12))],
      duracionRequeridaMinutos: 45,
      ahora,
      horaObjetivo: new Date(`${DIA}T14:00:00.000Z`),
      maximo: MAXIMO_ALTERNATIVAS,
    };

    expect(elegirAlternativas(solicitud)).toEqual(elegirAlternativas(solicitud));
  });
});
