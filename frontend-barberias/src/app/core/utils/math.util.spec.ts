import { describe, expect, it } from 'vitest';
import { redondearMoneda, sumarSeguro } from './math.util';

describe('utilidades de aritmética monetaria', () => {
  describe('redondearMoneda', () => {
    it('elimina el residuo IEEE 754 al redondear 1.005 a dos decimales', () => {
      expect(redondearMoneda(1.005)).toBe(1.01);
    });

    it('acepta strings numéricos y permite elegir los decimales', () => {
      expect(redondearMoneda('12.345', 2)).toBe(12.35);
      expect(redondearMoneda('12.345', 1)).toBe(12.3);
    });

    it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 'inválido', 'NaN'])(
      'normaliza %s a cero',
      (valor) => {
        expect(redondearMoneda(valor)).toBe(0);
      },
    );

    it('devuelve cero cuando la cantidad de decimales no es válida', () => {
      expect(redondearMoneda(12.34, -1)).toBe(0);
      expect(redondearMoneda(12.34, Number.NaN)).toBe(0);
    });
  });

  describe('sumarSeguro', () => {
    it('suma números y strings sin dejar el error 0.1 + 0.2', () => {
      expect(sumarSeguro([0.1, '0.2'])).toBe(0.3);
    });

    it('ignora valores inválidos y nulos dentro de un array mixto', () => {
      expect(sumarSeguro([0.1, '0.2', null, undefined, Number.NaN, 'x'])).toBe(0.3);
    });

    it('devuelve cero para un array vacío', () => {
      expect(sumarSeguro([])).toBe(0);
    });
  });
});
