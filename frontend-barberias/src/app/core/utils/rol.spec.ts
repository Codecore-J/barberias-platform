import { describe, expect, it } from 'vitest';
import { ETIQUETA_ROL, rolEfectivo } from './rol.js';

describe('rolEfectivo', () => {
  it('devuelve el rol del token cuando existe', () => {
    expect(rolEfectivo(['CLIENTE'])).toBe('CLIENTE');
    expect(rolEfectivo(['BARBERO'])).toBe('BARBERO');
    expect(rolEfectivo(['ADMIN_BARBERIA'])).toBe('ADMIN_BARBERIA');
    expect(rolEfectivo(['ADMINISTRADOR'])).toBe('ADMINISTRADOR');
  });

  it('aplica la precedencia del backend cuando el token trae varios roles', () => {
    expect(rolEfectivo(['CLIENTE', 'ADMINISTRADOR'])).toBe('ADMINISTRADOR');
    expect(rolEfectivo(['BARBERO', 'ADMIN_BARBERIA'])).toBe('ADMIN_BARBERIA');
  });

  it('una cuenta sin roles NO se etiqueta como CLIENTE', () => {
    expect(rolEfectivo([])).toBe('SIN_ROL');
    expect(rolEfectivo(null)).toBe('SIN_ROL');
    expect(rolEfectivo(undefined)).toBe('SIN_ROL');
  });

  it('un rol desconocido tampoco se inventa como CLIENTE', () => {
    expect(rolEfectivo(['SUPERVISOR'])).toBe('SIN_ROL');
  });

  it('cada rol tiene etiqueta legible, incluido el estado neutro', () => {
    expect(ETIQUETA_ROL.SIN_ROL).toBe('Sin rol asignado');
    expect(ETIQUETA_ROL.CLIENTE).toBe('Cliente');
  });
});
