import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * F6 / T-61 · geocodificación inversa con Nominatim.
 *
 * La sede se crea con coordenadas y el backend deduce país, provincia y
 * municipio a partir de ellas: así las divisiones no las escribe el navegador
 * (que podría inventarlas o desincronizarlas) sino el proveedor.
 *
 * Política de uso de Nominatim (obligatoria):
 *  - `User-Agent` identificable con un contacto. Sin él, el proveedor bloquea.
 *  - Máximo una petición por segundo. Esta llamada ocurre una sola vez por
 *    creación de sede, y `POST /shops` ya está limitado a 5 peticiones por
 *    minuto (H-04), así que el ritmo queda muy por debajo del límite. No se
 *    añade una cola propia: serializar aquí daría la falsa sensación de que
 *    protege al resto de llamadores del proceso.
 *  - Timeout de 5 s: una sede no puede quedarse colgada esperando al proveedor.
 *
 * Nada de esto se llama desde un test: la suite sustituye `fetch` con
 * `vi.stubGlobal` (ver `test/t61-nominatim.spec.ts`).
 */

/** Identificación exigida por la política de uso; incluye el contacto. */
export const AGENTE_USUARIO = 'BarberiasPlatform/1.0 contacto:alexjime386@gmail.com';

/** Tope de espera de la petición HTTP, en milisegundos. */
export const TIEMPO_LIMITE_MS = 5000;

/**
 * Países con divisiones soportadas. Se amplía añadiendo su código ISO 3166-1
 * alpha-2 aquí y sus divisiones en el catálogo (T-65): el servicio es el único
 * punto que decide si un país entra.
 */
export const PAISES_SOPORTADOS: readonly string[] = ['DO'];

const URL_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

/** 422 · la ubicación está fuera de los países soportados por ahora. */
export class PaisNoSoportadoException extends UnprocessableEntityException {
  constructor(paisCodigo: string) {
    super({
      statusCode: 422,
      codigo: 'PAIS_NO_SOPORTADO',
      mensaje:
        `La ubicación está en «${paisCodigo}», un país que todavía no está soportado. ` +
        'Estamos trabajando para ampliar la cobertura.',
      paisCodigo,
    });
  }
}

/**
 * 503 · el proveedor no respondió o respondió algo inservible.
 *
 * No es culpa del usuario y no se crea nada a medias: quien llama debe abortar
 * el alta de la sede. El motivo técnico va al log, no al cuerpo de la respuesta.
 */
export class GeocodificacionNoDisponibleException extends ServiceUnavailableException {
  constructor(motivo: string) {
    super({
      statusCode: 503,
      codigo: 'GEOCODIFICACION_NO_DISPONIBLE',
      mensaje:
        'No pudimos verificar la ubicación de la sede en este momento. ' +
        'Inténtalo de nuevo en unos minutos.',
      motivo,
    });
  }
}

/** Lo que la sede necesita guardar, ya normalizado. */
export interface UbicacionGeocodificada {
  /** ISO 3166-1 alpha-2 en MAYÚSCULAS (`DO`). */
  paisCodigo: string;
  /** División 1: provincia. */
  divisionNivel1: string | null;
  /** División 2: municipio. */
  divisionNivel2: string | null;
  /** `display_name` de Nominatim, truncado a 300 caracteres. */
  direccionCompleta: string | null;
}

/** Texto limpio o `null`: Nominatim omite claves y a veces manda cadenas vacías. */
function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}

@Injectable()
export class NominatimService {
  private readonly logger = new Logger(NominatimService.name);

  /**
   * Geocodificación inversa de unas coordenadas.
   *
   * @throws PaisNoSoportadoException (422) si el país no está en la lista.
   * @throws GeocodificacionNoDisponibleException (503) si la petición falla,
   *         tarda más de 5 s o la respuesta no permite decidir el país.
   */
  async ubicacionDe(latitud: number, longitud: number): Promise<UbicacionGeocodificada> {
    const url = new URL(URL_REVERSE);
    url.searchParams.set('format', 'json');
    url.searchParams.set('lat', String(latitud));
    url.searchParams.set('lon', String(longitud));

    let respuesta: Response;
    try {
      respuesta = await fetch(url.toString(), {
        headers: {
          'User-Agent': AGENTE_USUARIO,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
      });
    } catch (error) {
      // Red caída, DNS, TLS o el timeout de `AbortSignal.timeout`. En todos los
      // casos la sede no se puede ubicar: 503 y a otra cosa.
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Nominatim no respondió: ${motivo}`);
      throw new GeocodificacionNoDisponibleException('la petición no se completó');
    }

    if (!respuesta.ok) {
      this.logger.warn(`Nominatim respondió HTTP ${respuesta.status}`);
      throw new GeocodificacionNoDisponibleException(`HTTP ${respuesta.status}`);
    }

    let cuerpo: unknown;
    try {
      cuerpo = await respuesta.json();
    } catch {
      this.logger.warn('Nominatim devolvió un cuerpo que no es JSON');
      throw new GeocodificacionNoDisponibleException('respuesta ilegible');
    }

    const direccion = (cuerpo as { address?: Record<string, unknown> } | null)?.address;
    const pais = texto(direccion?.country_code)?.toUpperCase() ?? null;

    // Sin país no se puede decidir si está soportado: es un fallo del proveedor,
    // no un 422 (el 422 acusa al usuario de estar en un país no soportado).
    if (!pais) {
      this.logger.warn('Nominatim no devolvió country_code');
      throw new GeocodificacionNoDisponibleException('la respuesta no trae país');
    }

    if (!PAISES_SOPORTADOS.includes(pais)) {
      throw new PaisNoSoportadoException(pais);
    }

    return {
      paisCodigo: pais,
      divisionNivel1: texto(direccion?.state),
      // República Dominicana: `city` es el municipio. `town` y `county` son los
      // nombres que usa Nominatim en zonas rurales y en el Distrito Nacional.
      divisionNivel2:
        texto(direccion?.city) ?? texto(direccion?.town) ?? texto(direccion?.county),
      direccionCompleta: texto((cuerpo as { display_name?: unknown }).display_name)?.slice(
        0,
        300,
      ) ?? null,
    };
  }
}
