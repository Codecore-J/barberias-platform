import { describe, it, expect } from 'vitest';
import { maskName, maskEmail, maskPhone } from './anonymizer.utils.js';

describe('anonymizer.utils (T7.2)', () => {
  describe('maskName', () => {
    it('debe enmascarar correctamente nombres compuestos', () => {
      expect(maskName('Juan Carlos Pérez')).toBe('J*** C*** P***');
    });

    it('debe manejar cadenas vacías o nulas', () => {
      expect(maskName('')).toBe('Anónimo');
      expect(maskName(null)).toBe('Anónimo');
      expect(maskName(undefined)).toBe('Anónimo');
    });

    it('debe manejar iniciales o nombres de 1 letra', () => {
      expect(maskName('J P')).toBe('J P');
    });
  });

  describe('maskEmail', () => {
    it('debe enmascarar la parte de usuario conservando dominio', () => {
      expect(maskEmail('juan.perez@gmail.com')).toBe('ju***@gmail.com');
      expect(maskEmail('al@test.com')).toBe('a***@test.com');
    });

    it('debe retornar fallback si el correo es inválido o nulo', () => {
      expect(maskEmail(null)).toBe('***@***.***');
      expect(maskEmail('')).toBe('***@***.***');
      expect(maskEmail('invalido')).toBe('***@***.***');
    });
  });

  describe('maskPhone', () => {
    it('debe ocultar todos los dígitos salvo los últimos 4', () => {
      expect(maskPhone('1234567890')).toBe('******7890');
      expect(maskPhone('+18095551234')).toBe('********1234');
    });

    it('debe retornar asteriscos si el teléfono es muy corto o nulo', () => {
      expect(maskPhone(null)).toBe('***');
      expect(maskPhone('123')).toBe('****');
    });
  });
});
