import { describe, it, expect } from 'vitest';
import { resolverBarberiaId } from './current-barberia.decorator.js';

/**
 * E1-06. La causa raíz era una cuarta fuente en la cadena del decorador:
 * `params.id`, que en las rutas con `:id` es el id del recurso y no el de la
 * sede. Estos tests la fijan cerrada en el resolutor, sin necesitar base de
 * datos.
 */
describe('resolverBarberiaId (E1-06)', () => {
  it('NUNCA toma el id de la ruta con :id como si fuera la sede', () => {
    // `/catalogo/servicios/:id` con la cabecera de la sede: gana la cabecera.
    expect(
      resolverBarberiaId({
        params: { id: 'servicio-uuid' },
        headers: { 'x-barberia-id': 'sede-a' },
        query: {},
      }),
    ).toBe('sede-a');

    // Sin cabecera, `params.id` no suple a la sede: se devuelve null y el
    // decorador responde 400. Antes devolvía 'servicio-uuid' y la consulta
    // buscaba un servicio cuyo id fuera su propia barbería.
    expect(
      resolverBarberiaId({ params: { id: 'servicio-uuid' }, headers: {}, query: {} }),
    ).toBeNull();
  });

  it('prioriza params.barberiaId sobre la cabecera y la query', () => {
    expect(
      resolverBarberiaId({
        params: { barberiaId: 'sede-ruta' },
        headers: { 'x-barberia-id': 'sede-header' },
        query: { barberiaId: 'sede-query' },
      }),
    ).toBe('sede-ruta');
  });

  it('usa la cabecera antes que la query', () => {
    expect(
      resolverBarberiaId({
        params: {},
        headers: { 'x-barberia-id': 'sede-header' },
        query: { barberiaId: 'sede-query' },
      }),
    ).toBe('sede-header');
  });

  it('usa la query cuando no hay ruta ni cabecera', () => {
    expect(
      resolverBarberiaId({ params: {}, headers: {}, query: { barberiaId: 'sede-query' } }),
    ).toBe('sede-query');
  });

  it('toma la primera cabecera si llega repetida', () => {
    expect(
      resolverBarberiaId({
        params: {},
        headers: { 'x-barberia-id': ['sede-una', 'sede-dos'] },
        query: {},
      }),
    ).toBe('sede-una');
  });

  it('trata una cabecera vacía como sede no indicada', () => {
    expect(resolverBarberiaId({ params: {}, headers: { 'x-barberia-id': '   ' }, query: {} })).toBeNull();
    expect(resolverBarberiaId({ params: {}, headers: {}, query: {} })).toBeNull();
  });
});