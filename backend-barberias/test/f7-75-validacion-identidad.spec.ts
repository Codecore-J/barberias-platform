import { describe, expect, it } from 'vitest';
import {
  esCedulaDominicanaValida,
  esTelefonoDominicanoValido,
  normalizarTelefonoRD,
} from '../src/shared/identidad.validator.js';

/**
 * F7 / T-75 · formatos dominicanos de teléfono y cédula.
 *
 * Teléfono: 10 dígitos con prefijo 809, 829 o 849. Se acepta también la forma
 * internacional `+18094728320` y se normaliza al formato local.
 *
 * Cédula: 11 dígitos con dígito verificador (Luhn adaptado a RD: pesos 1 y 2
 * alternados desde la izquierda).
 *
 * En rojo falla porque el módulo no existe.
 */
describe('T-75 · teléfono dominicano', () => {
  it('acepta los tres prefijos con 10 dígitos', () => {
    expect(esTelefonoDominicanoValido('8094728320')).toBe(true);
    expect(esTelefonoDominicanoValido('8294728320')).toBe(true);
    expect(esTelefonoDominicanoValido('8494728320')).toBe(true);
  });

  it('acepta la forma internacional +1 y la normaliza', () => {
    expect(esTelefonoDominicanoValido('+18094728320')).toBe(true);
    expect(normalizarTelefonoRD('+1 (809) 472-8320')).toBe('8094728320');
    expect(normalizarTelefonoRD('18094728320')).toBe('8094728320');
  });

  it('rechaza prefijos que no son dominicanos', () => {
    expect(esTelefonoDominicanoValido('3054728320')).toBe(false);
    expect(esTelefonoDominicanoValido('7874728320')).toBe(false);
  });

  it('rechaza longitudes distintas de 10 y todo ceros', () => {
    expect(esTelefonoDominicanoValido('809472832')).toBe(false);
    expect(esTelefonoDominicanoValido('80947283200')).toBe(false);
    expect(esTelefonoDominicanoValido('0000000000')).toBe(false);
  });
});

describe('T-75 · cédula dominicana', () => {
  it('acepta una cédula con dígito verificador correcto', () => {
    expect(esCedulaDominicanaValida('00100000009')).toBe(true);
    expect(esCedulaDominicanaValida('001-0000000-9')).toBe(true);
  });

  it('rechaza un dígito verificador incorrecto', () => {
    expect(esCedulaDominicanaValida('00100000000')).toBe(false);
    expect(esCedulaDominicanaValida('00100000008')).toBe(false);
  });

  it('rechaza longitudes distintas de 11 y todo ceros', () => {
    expect(esCedulaDominicanaValida('0010000000')).toBe(false);
    expect(esCedulaDominicanaValida('001000000091')).toBe(false);
    expect(esCedulaDominicanaValida('00000000000')).toBe(false);
  });
});
