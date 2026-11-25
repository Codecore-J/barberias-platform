import { describe, expect, it } from 'vitest';

import { puedeAbrirFichaDeCliente } from './agenda-ficha';

/**
 * F3-05 · en un walk-in, `cliente.id` es el OPERADOR que tecleó el turno
 * (T-05), no el cliente. Abrir su ficha desde la agenda expone datos del staff
 * y hace creer que el turno es suyo. El flag `esWalkIn` de F3-01 es la única
 * señal fiable: el nombre visible ya es el invitado, pero el id sigue siendo
 * el de la cuenta.
 */
describe('puedeAbrirFichaDeCliente (F3-05)', () => {
  it('ROJO: un turno walk-in nunca abre la ficha', () => {
    expect(puedeAbrirFichaDeCliente({ esWalkIn: true })).toBe(false);
  });

  it('control: un turno normal sí la abre', () => {
    expect(puedeAbrirFichaDeCliente({ esWalkIn: false })).toBe(true);
  });

  it('control: un turno anterior al flag se comporta como normal', () => {
    expect(puedeAbrirFichaDeCliente({})).toBe(true);
  });

  it('sin turno no hay ficha que abrir', () => {
    expect(puedeAbrirFichaDeCliente(null)).toBe(false);
    expect(puedeAbrirFichaDeCliente(undefined)).toBe(false);
  });
});
