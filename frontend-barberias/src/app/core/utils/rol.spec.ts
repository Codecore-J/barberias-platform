import { describe, expect, it } from 'vitest';
import { ETIQUETA_ROL, esAdminDeSede, rolEfectivo } from './rol.js';

/**
 * T-30 · los combos son solo del ADMIN_BARBERIA.
 *
 * El backend ya lo exige (`@Roles('ADMIN_BARBERIA')` + `OperadorBarberiaGuard`),
 * pero el panel ofrecía crear y editar combos al BARBERO y al ADMINISTRADOR
 * global: la pantalla prometía una escritura que la API deniega con 403.
 */
describe('esAdminDeSede', () => {
  it('solo el ADMIN_BARBERIA gestiona los combos', () => {
    expect(esAdminDeSede('ADMIN_BARBERIA')).toBe(true);
    expect(esAdminDeSede('ADMINISTRADOR')).toBe(false);
    expect(esAdminDeSede('BARBERO')).toBe(false);
    expect(esAdminDeSede('CLIENTE')).toBe(false);
    expect(esAdminDeSede('SIN_ROL')).toBe(false);
  });
});

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
