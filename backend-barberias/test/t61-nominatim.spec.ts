import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GeocodificacionNoDisponibleException,
  PaisNoSoportadoException,
  NominatimService,
  AGENTE_USUARIO,
  TIEMPO_LIMITE_MS,
} from '../src/geocodificacion/nominatim.service.js';

/**
 * F6 / T-61 · geocodificación inversa con Nominatim.
 *
 * Regla dura de esta suite: **ninguna petición real a Nominatim**. `fetch` se
 * sustituye con `vi.stubGlobal` en todas las pruebas y al final se comprueba
 * que sigue siendo un mock: si alguien quita el stub, el test falla en vez de
 * salir a la red.
 *
 * Lo que se fija:
 *  1. La petición va al endpoint `/reverse` con `format=json`, lat/lon y el
 *     `User-Agent` que exige la política de uso de Nominatim.
 *  2. Timeout de 5 s (`AbortSignal.timeout`), no un `fetch` que pueda colgar la
 *     creación de una sede.
 *  3. `country_code` se normaliza a mayúsculas; solo `DO` está soportado y
 *     cualquier otro país lanza 422 `PAIS_NO_SOPORTADO`.
 *  4. División nivel 1 = `state`; nivel 2 = `city`, luego `town`, luego
 *     `county` (en ese orden).
 *  5. Red, HTTP no-2xx, timeout o JSON inválido → 503
 *     `GEOCODIFICACION_NO_DISPONIBLE`; nunca se devuelve una ubicación a medias.
 */

const LATITUD = 18.4861;
const LONGITUD = -69.9312;

/** Respuesta típica de Nominatim para Santo Domingo. */
function respuesta(address: Record<string, unknown> = {}, displayName = 'Santo Domingo, Distrito Nacional, República Dominicana') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ display_name: displayName, address }),
  };
}

const DIRECCION_DO = {
  country_code: 'do',
  state: 'Distrito Nacional',
  city: 'Santo Domingo',
  town: 'Villa Mella',
  county: 'Distrito Nacional',
};

describe('T-61 · NominatimService', () => {
  let fetchFalso: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('llama a /reverse con format=json, coordenadas y el User-Agent exigido', async () => {
    fetchFalso.mockResolvedValue(respuesta(DIRECCION_DO));
    const servicio = new NominatimService();

    await servicio.ubicacionDe(LATITUD, LONGITUD);

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchFalso.mock.calls[0];

    expect(url).toContain('https://nominatim.openstreetmap.org/reverse');
    expect(url).toContain('format=json');
    expect(url).toContain(`lat=${LATITUD}`);
    expect(url).toContain(`lon=${LONGITUD}`);
    expect(opciones.headers['User-Agent']).toBe(
      'BarberiasPlatform/1.0 contacto:alexjime386@gmail.com',
    );
    expect(AGENTE_USUARIO).toBe('BarberiasPlatform/1.0 contacto:alexjime386@gmail.com');
  });

  it('extrae país, provincia, municipio y la dirección completa truncada', async () => {
    const larga = 'A'.repeat(400);
    fetchFalso.mockResolvedValue(respuesta(DIRECCION_DO, larga));
    const servicio = new NominatimService();

    const ubicacion = await servicio.ubicacionDe(LATITUD, LONGITUD);

    expect(ubicacion).toEqual({
      paisCodigo: 'DO',
      divisionNivel1: 'Distrito Nacional',
      divisionNivel2: 'Santo Domingo',
      direccionCompleta: 'A'.repeat(300),
    });
  });

  it('la división de nivel 2 prefiere city, luego town y luego county', async () => {
    const servicio = new NominatimService();

    fetchFalso.mockResolvedValueOnce(
      respuesta({ country_code: 'do', state: 'La Vega', city: 'La Vega', town: 'Otro', county: 'Otro más' }),
    );
    expect((await servicio.ubicacionDe(LATITUD, LONGITUD)).divisionNivel2).toBe('La Vega');

    fetchFalso.mockResolvedValueOnce(
      respuesta({ country_code: 'do', state: 'La Vega', town: 'Jarabacoa', county: 'La Vega' }),
    );
    expect((await servicio.ubicacionDe(LATITUD, LONGITUD)).divisionNivel2).toBe('Jarabacoa');

    fetchFalso.mockResolvedValueOnce(
      respuesta({ country_code: 'do', state: 'La Vega', county: 'La Vega' }),
    );
    expect((await servicio.ubicacionDe(LATITUD, LONGITUD)).divisionNivel2).toBe('La Vega');
  });

  it('sin divisiones devuelve null en vez de inventar nombres', async () => {
    fetchFalso.mockResolvedValue(respuesta({ country_code: 'do', state: 'Distrito Nacional' }));
    const servicio = new NominatimService();

    const ubicacion = await servicio.ubicacionDe(LATITUD, LONGITUD);

    expect(ubicacion.divisionNivel2).toBeNull();
  });

  it('un país fuera de la lista soportada responde 422 PAIS_NO_SOPORTADO', async () => {
    fetchFalso.mockResolvedValue(respuesta({ country_code: 'us', state: 'Florida', city: 'Miami' }));
    const servicio = new NominatimService();

    await expect(servicio.ubicacionDe(25.7617, -80.1918)).rejects.toBeInstanceOf(
      PaisNoSoportadoException,
    );

    try {
      await servicio.ubicacionDe(25.7617, -80.1918);
    } catch (error) {
      const excepcion = error as PaisNoSoportadoException;
      expect(excepcion.getStatus()).toBe(422);
      expect(excepcion.getResponse()).toMatchObject({
        statusCode: 422,
        codigo: 'PAIS_NO_SOPORTADO',
      });
    }
  });

  it('un fallo de red responde 503 GEOCODIFICACION_NO_DISPONIBLE', async () => {
    fetchFalso.mockRejectedValue(new Error('ECONNRESET'));
    const servicio = new NominatimService();

    await expect(servicio.ubicacionDe(LATITUD, LONGITUD)).rejects.toBeInstanceOf(
      GeocodificacionNoDisponibleException,
    );
  });

  it('un HTTP no-2xx responde 503 y no intenta leer el cuerpo como si fuera válido', async () => {
    fetchFalso.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => {
        throw new Error('no debería leerse');
      },
    });
    const servicio = new NominatimService();

    try {
      await servicio.ubicacionDe(LATITUD, LONGITUD);
      throw new Error('debía lanzar');
    } catch (error) {
      const excepcion = error as GeocodificacionNoDisponibleException;
      expect(excepcion).toBeInstanceOf(GeocodificacionNoDisponibleException);
      expect(excepcion.getStatus()).toBe(503);
      expect(excepcion.getResponse()).toMatchObject({
        statusCode: 503,
        codigo: 'GEOCODIFICACION_NO_DISPONIBLE',
      });
    }
  });

  it('un timeout o aborto responde 503, no una promesa colgada', async () => {
    const aborto = new Error('This operation was aborted');
    aborto.name = 'AbortError';
    fetchFalso.mockRejectedValue(aborto);
    const servicio = new NominatimService();

    await expect(servicio.ubicacionDe(LATITUD, LONGITUD)).rejects.toBeInstanceOf(
      GeocodificacionNoDisponibleException,
    );
  });

  it('usa un timeout de 5 s y no deja la petición sin límite', async () => {
    expect(TIEMPO_LIMITE_MS).toBe(5000);

    fetchFalso.mockResolvedValue(respuesta(DIRECCION_DO));
    await new NominatimService().ubicacionDe(LATITUD, LONGITUD);

    const [, opciones] = fetchFalso.mock.calls[0];
    expect(opciones.signal).toBeInstanceOf(AbortSignal);
  });

  it('una respuesta sin country_code es un fallo del proveedor: 503', async () => {
    fetchFalso.mockResolvedValue(respuesta({ state: 'Distrito Nacional' }));
    const servicio = new NominatimService();

    await expect(servicio.ubicacionDe(LATITUD, LONGITUD)).rejects.toBeInstanceOf(
      GeocodificacionNoDisponibleException,
    );
  });

  it('la suite nunca sale a la red: fetch sigue siendo un mock', () => {
    expect(vi.isMockFunction(globalThis.fetch)).toBe(true);
  });
});
