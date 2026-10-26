import { telefonosCoinciden } from './telefono.js';

describe('telefonosCoinciden (Fase 7)', () => {
  it('coincide cuando el número es idéntico', () => {
    expect(telefonosCoinciden('+18095550000', '+18095550000')).toBe(true);
  });

  it('ignora la puntuación que agrega el proveedor', () => {
    expect(telefonosCoinciden('+18095550000', '(809) 555-0000')).toBe(true);
    expect(telefonosCoinciden('809-555-0000', '8095550000')).toBe(true);
  });

  it('tolera un prefijo de país de más en cualquiera de los dos lados', () => {
    expect(telefonosCoinciden('8095550000', '+18095550000')).toBe(true);
    expect(telefonosCoinciden('+18095550000', '8095550000')).toBe(true);
  });

  it('rechaza números distintos', () => {
    expect(telefonosCoinciden('+18095550000', '+18095551111')).toBe(false);
  });

  it('nunca acepta un residuo demasiado corto', () => {
    expect(telefonosCoinciden('1234567', '41234567')).toBe(false);
  });

  it('falla cerrado con vacíos o valores nulos', () => {
    expect(telefonosCoinciden('', '')).toBe(false);
    expect(telefonosCoinciden('', '+18095550000')).toBe(false);
    expect(telefonosCoinciden('+18095550000', 'solo letras')).toBe(false);
    expect(telefonosCoinciden(undefined as unknown as string, '8095550000')).toBe(false);
  });
});