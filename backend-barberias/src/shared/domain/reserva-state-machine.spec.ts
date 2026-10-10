import { ConflictException } from '@nestjs/common';
import {
  ACTORES,
  ESTADOS,
  ESTADOS_RESERVA,
  ESTADOS_TERMINALES,
  type ActorTransicion,
  type EstadoReserva,
} from './estados.js';
import { EFECTOS_ENTRADA, ReservaStateMachine } from './reserva-state-machine.js';

/**
 * E2-02 · Matriz ESPERADA de §5.2 escrita a mano, fila por fila, con literales.
 *
 * Es deliberadamente INDEPENDIENTE de `TRANSICIONES`: si el test leyera la tabla
 * del código, no probaría nada. Está tipada con `EstadoReserva` y
 * `ActorTransicion`, así que un literal que no pertenezca al catálogo de D08 o
 * al conjunto de actores no compila.
 *
 * `null` como origen es la fila 1 y 2 de §5.2: la CREACIÓN. Se cubre con la
 * tupla de dos filas y con el caso aparte de creación.
 */
type FilaEsperada = readonly [EstadoReserva | null, EstadoReserva, ActorTransicion];

const ESPERADAS: readonly FilaEsperada[] = [
  // Creación (§5.2 filas 1 y 2)
  [null, 'PENDIENTE', 'CLIENTE'],
  [null, 'CONFIRMADA', 'CLIENTE'],
  // PENDIENTE
  ['PENDIENTE', 'CONFIRMADA', 'STAFF'],
  ['PENDIENTE', 'RECHAZADA', 'STAFF'],
  ['PENDIENTE', 'PROPUESTA_PENDIENTE', 'STAFF'],
  ['PENDIENTE', 'EXPIRADA', 'SISTEMA'],
  ['PENDIENTE', 'CANCELADA', 'CLIENTE'],
  // PROPUESTA_PENDIENTE
  ['PROPUESTA_PENDIENTE', 'CONFIRMADA', 'CLIENTE'],
  ['PROPUESTA_PENDIENTE', 'CANCELADA', 'CLIENTE'],
  ['PROPUESTA_PENDIENTE', 'EXPIRADA', 'SISTEMA'],
  // CONFIRMADA (la cancelación aparece dos veces: cliente hasta 30 min, sede con motivo)
  ['CONFIRMADA', 'COMPLETADA', 'STAFF'],
  ['CONFIRMADA', 'NO_PRESENTADO', 'STAFF'],
  ['CONFIRMADA', 'CANCELADA', 'CLIENTE'],
  ['CONFIRMADA', 'CANCELADA', 'STAFF'],
];

const ACTORES_LISTA: readonly ActorTransicion[] = [
  ACTORES.CLIENTE,
  ACTORES.STAFF,
  ACTORES.SISTEMA,
];

const crearEjecutores = () => ({
  limpiarInformacionAdicional: vi.fn().mockResolvedValue(undefined),
  cancelarJobs: vi.fn().mockResolvedValue(undefined),
});

describe('E2-02 · ReservaStateMachine (§5.1 y §5.2)', () => {
  describe('catálogo de estados (D08, D14)', () => {
    it('son exactamente los 8 de §5.1, sin duplicados', () => {
      expect(ESTADOS_RESERVA).toHaveLength(8);
      expect(new Set(ESTADOS_RESERVA).size).toBe(8);
      expect([...ESTADOS_RESERVA].sort()).toEqual([
        'CANCELADA',
        'COMPLETADA',
        'CONFIRMADA',
        'EXPIRADA',
        'NO_PRESENTADO',
        'PENDIENTE',
        'PROPUESTA_PENDIENTE',
        'RECHAZADA',
      ]);
    });

    it('NO_ASISTIO no pertenece al catálogo (el estado válido es NO_PRESENTADO)', () => {
      expect(ESTADOS_RESERVA).not.toContain('NO_ASISTIO');
      expect(ReservaStateMachine.esTerminal('NO_ASISTIO')).toBe(false);
    });

    it('los terminales de §5.1 son los cinco declarados', () => {
      expect([...ESTADOS_TERMINALES].sort()).toEqual([
        'CANCELADA',
        'COMPLETADA',
        'EXPIRADA',
        'NO_PRESENTADO',
        'RECHAZADA',
      ]);
      for (const terminal of ESTADOS_TERMINALES) {
        expect(ReservaStateMachine.esTerminal(terminal)).toBe(true);
      }
      for (const noTerminal of [ESTADOS.PENDIENTE, ESTADOS.CONFIRMADA, ESTADOS.PROPUESTA_PENDIENTE]) {
        expect(ReservaStateMachine.esTerminal(noTerminal)).toBe(false);
      }
    });
  });

  describe('las 14 filas de §5.2', () => {
    it.each(ESPERADAS)('permite %s → %s con el actor %s', (desde, hacia, actor) => {
      expect(ReservaStateMachine.permite(desde, hacia, actor)).toBe(true);
      expect(() => ReservaStateMachine.assertTransition(desde, hacia, actor)).not.toThrow();
    });

    it('cada fila esperada existe en la tabla y no hay filas de más', () => {
      expect(TRANSICIONES_ORDENADAS()).toEqual(
        [...ESPERADAS].map(([desde, hacia, actor]) => `${desde}→${hacia}@${actor}`).sort(),
      );
    });
  });

  describe('las 64 combinaciones de 8×8, por actor (192 decisiones)', () => {
    it('permite EXACTAMENTE lo que dice la matriz, y nada más', () => {
      let permitidas = 0;
      let rechazadas = 0;

      for (const desde of ESTADOS_RESERVA) {
        for (const hacia of ESTADOS_RESERVA) {
          for (const actor of ACTORES_LISTA) {
            const esperado = ESPERADAS.some(
              ([d, h, a]) => d === desde && h === hacia && a === actor,
            );

            expect(
              ReservaStateMachine.permite(desde, hacia, actor),
              `${desde}→${hacia}@${actor} debería ${esperado ? 'permitirse' : 'rechazarse'}`,
            ).toBe(esperado);

            if (esperado) {
              permitidas += 1;
              expect(() =>
                ReservaStateMachine.assertTransition(desde, hacia, actor),
              ).not.toThrow();
            } else {
              rechazadas += 1;
              expect(() =>
                ReservaStateMachine.assertTransition(desde, hacia, actor),
              ).toThrowError(ConflictException);
            }
          }
        }
      }

      // 8×8×3 = 192 decisiones; 12 de ellas son de estado a estado (§5.2 excluye
      // las dos de creación, que no tienen `desde`).
      expect(permitidas + rechazadas).toBe(192);
      expect(permitidas).toBe(12);
    });

    it('una transición inválida responde 409 con el contrato D40', () => {
      expect.assertions(3);

      try {
        // El caso que el backlog cita como rojo de E2-02.
        ReservaStateMachine.assertTransition('CANCELADA', 'CONFIRMADA', ACTORES.STAFF);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getStatus()).toBe(409);
        expect(err.getResponse()).toMatchObject({
          statusCode: 409,
          codigo: 'ESTADO_INVALIDO',
        });
      }
    });

    it('un estado almacenado fuera del catálogo falla cerrado (409)', () => {
      expect(() =>
        ReservaStateMachine.assertTransition('NO_ASISTIO' as EstadoReserva, 'CANCELADA', ACTORES.STAFF),
      ).toThrowError(ConflictException);
    });
  });

  describe('creación de la reserva (§5.2 filas 1 y 2)', () => {
    it('MANUAL crea PENDIENTE y AUTOMATICA crea CONFIRMADA, ambas con el actor CLIENTE', () => {
      expect(() =>
        ReservaStateMachine.assertTransition(null, ESTADOS.PENDIENTE, ACTORES.CLIENTE),
      ).not.toThrow();
      expect(() =>
        ReservaStateMachine.assertTransition(null, ESTADOS.CONFIRMADA, ACTORES.CLIENTE),
      ).not.toThrow();
    });

    it('no se puede crear una reserva ya terminal ni con otro actor', () => {
      for (const terminal of ESTADOS_TERMINALES) {
        expect(ReservaStateMachine.permite(null, terminal, ACTORES.CLIENTE)).toBe(false);
      }
      expect(ReservaStateMachine.permite(null, ESTADOS.PENDIENTE, ACTORES.STAFF)).toBe(false);
      expect(ReservaStateMachine.permite(null, ESTADOS.PENDIENTE, ACTORES.SISTEMA)).toBe(false);
    });
  });

  describe('onEnter: efectos centrales al entrar en un estado (§5.2)', () => {
    it('declara el plan de cada uno de los 8 estados', () => {
      expect(Object.keys(ReservaStateMachine.planesDeEntrada()).sort()).toEqual(
        [...ESTADOS_RESERVA].sort(),
      );
    });

    it('al entrar en CANCELADA, RECHAZADA o EXPIRADA borra la información adicional y cancela jobs', () => {
      for (const estado of [ESTADOS.CANCELADA, ESTADOS.RECHAZADA, ESTADOS.EXPIRADA]) {
        expect(ReservaStateMachine.efectosDeEntrada(estado)).toEqual([
          EFECTOS_ENTRADA.LIMPIAR_INFORMACION_ADICIONAL,
          EFECTOS_ENTRADA.CANCELAR_JOBS,
        ]);
      }
    });

    it('onEnter ejecuta la limpieza dentro de la transacción y deja el job para después', async () => {
      const ejecutores = crearEjecutores();

      await ReservaStateMachine.onEnter(ESTADOS.CANCELADA, {
        reservaId: 'uuid-reserva',
        ejecutores,
      });

      expect(ejecutores.limpiarInformacionAdicional).toHaveBeenCalledWith('uuid-reserva');
      expect(ejecutores.cancelarJobs).not.toHaveBeenCalled();
    });

    it('despuesDeConfirmar cancela el job de expiración y no repite la limpieza', async () => {
      const ejecutores = crearEjecutores();

      await ReservaStateMachine.despuesDeConfirmar(ESTADOS.CANCELADA, {
        reservaId: 'uuid-reserva',
        ejecutores,
      });

      expect(ejecutores.cancelarJobs).toHaveBeenCalledWith('uuid-reserva');
      expect(ejecutores.limpiarInformacionAdicional).not.toHaveBeenCalled();
    });

    it('CONFIRMADA no limpia nada, pero sí cierra el temporizador de expiración', async () => {
      const ejecutores = crearEjecutores();

      expect(ReservaStateMachine.efectosDeEntrada(ESTADOS.CONFIRMADA)).toEqual([
        EFECTOS_ENTRADA.CANCELAR_JOBS,
      ]);

      await ReservaStateMachine.despuesDeConfirmar(ESTADOS.CONFIRMADA, {
        reservaId: 'uuid-reserva',
        ejecutores,
      });

      expect(ejecutores.cancelarJobs).toHaveBeenCalledWith('uuid-reserva');
      expect(ejecutores.limpiarInformacionAdicional).not.toHaveBeenCalled();
    });

    it('todo estado que no sea PENDIENTE ni PROPUESTA_PENDIENTE cierra el temporizador', () => {
      const cierran = ESTADOS_RESERVA.filter(
        (e) => e !== ESTADOS.PENDIENTE && e !== ESTADOS.PROPUESTA_PENDIENTE,
      );

      for (const estado of cierran) {
        expect(ReservaStateMachine.efectosDeEntrada(estado)).toContain(
          EFECTOS_ENTRADA.CANCELAR_JOBS,
        );
      }

      expect(
        ReservaStateMachine.efectosDeEntrada(ESTADOS.NO_PRESENTADO),
      ).toEqual([EFECTOS_ENTRADA.CANCELAR_JOBS]);
    });

    it('PENDIENTE y PROPUESTA_PENDIENTE no tienen efectos', async () => {
      const ejecutores = crearEjecutores();

      for (const estado of [ESTADOS.PENDIENTE, ESTADOS.PROPUESTA_PENDIENTE]) {
        await ReservaStateMachine.onEnter(estado, { reservaId: 'uuid-reserva', ejecutores });
        await ReservaStateMachine.despuesDeConfirmar(estado, {
          reservaId: 'uuid-reserva',
          ejecutores,
        });
      }

      expect(ejecutores.limpiarInformacionAdicional).not.toHaveBeenCalled();
      expect(ejecutores.cancelarJobs).not.toHaveBeenCalled();
    });
  });
});

/** Proyección de la tabla real, para comprobar que no tiene filas de más. */
function TRANSICIONES_ORDENADAS(): string[] {
  return ReservaStateMachine.transiciones()
    .map((t) => `${t.desde}→${t.hacia}@${t.actor}`)
    .sort();
}
