import { describe, expect, it } from 'vitest';
import {
  ORIGENES_POR_DEFECTO,
  origenAutorizado,
  origenesPermitidos,
} from './cors-policy.js';

/**
 * P3 · el origen no autorizado debe quedar FUERA, no tumbar la petición.
 * El bug original convertía el rechazo de CORS en un 500 del backend.
 */
describe('cors-policy', () => {
  it('permite los orígenes por defecto y los añadidos por FRONTEND_URL', () => {
    const permitidos = origenesPermitidos('https://preview.midominio.test, https://otro.midominio.test');

    expect(permitidos).toContain('https://barberias-platform.vercel.app');
    expect(permitidos).toContain('http://localhost:4200');
    expect(permitidos).toContain('https://preview.midominio.test');
    expect(permitidos).toContain('https://otro.midominio.test');
  });

  it('no duplica orígenes ni añade entradas vacías', () => {
    const permitidos = origenesPermitidos('https://barberias-platform.vercel.app, ,');

    expect(permitidos.filter((url) => url === 'https://barberias-platform.vercel.app')).toHaveLength(1);
    expect(permitidos).not.toContain('');
    expect(permitidos).toHaveLength(ORIGENES_POR_DEFECTO.length);
  });

  it('acepta los previews del equipo en Vercel', () => {
    expect(
      origenAutorizado('https://barberias-platform-abc123-developerstem.vercel.app', [
        'https://barberias-platform.vercel.app',
      ]),
    ).toBe(true);
  });

  it('rechaza un origen no listado (localhost de otro puerto incluido)', () => {
    expect(origenAutorizado('http://127.0.0.1:4300')).toBe(false);
    expect(origenAutorizado('https://sitio-ajeno.test')).toBe(false);
  });

  it('permite peticiones sin Origin (curl, server-to-server)', () => {
    expect(origenAutorizado(undefined)).toBe(true);
  });

  it('distingue mayúsculas y barra final: no normaliza por su cuenta', () => {
    expect(origenAutorizado('https://Barberias-Platform.vercel.app')).toBe(false);
    expect(origenAutorizado('https://barberias-platform.vercel.app/')).toBe(false);
  });
});
