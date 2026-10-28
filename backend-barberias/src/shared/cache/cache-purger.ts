import { Logger } from '@nestjs/common';
import type { Keyv } from 'keyv';

/**
 * Invalidación del caché por prefijo.
 *
 * Existe porque `Keyv.iterator()` NO sirve para esto cuando el store es Redis:
 * recorre el keyspace completo con `SCAN` —el `KeyvRedis` ignora el namespace
 * que Keyv le pasa— y luego deserializa CADA valor con `JSON.parse`. El Redis de
 * la aplicación no solo guarda analíticas: BullMQ escribe ahí sus claves
 * (`bull:notificacion:meta`, contadores, marcadores), que no son JSON. El primer
 * valor ajeno lanza `Unexpected non-whitespace character after JSON at position
 * 6`, la purga aborta y el panel sigue sirviendo cifras viejas hasta que expira
 * el TTL de 15 minutos.
 *
 * La purga correcta filtra EN REDIS (`SCAN … MATCH <prefijo>*`) y borra sin
 * leer valores: nunca toca una clave ajena ni intenta interpretarla.
 *
 * Si no hay Redis (desarrollo local y CI usan el store en memoria de Keyv) se
 * itera el `Map`, donde todos los valores sí son nuestros y el `iterator` de
 * Keyv no puede tropezar con datos de terceros.
 */

/** Lo mínimo que se usa de un cliente node-redis. */
interface ClienteRedisMinimo {
  scan(
    cursor: string,
    opciones: { MATCH: string; COUNT: number; TYPE?: string },
  ): Promise<{ cursor: unknown; keys: string[] }>;
  del(claves: string[]): Promise<unknown>;
}

/** El adaptador `KeyvRedis` expone sus nodos por esta vía. */
interface AdaptadorRedisMinimo {
  getMasterNodes?: () => Promise<ClienteRedisMinimo[]>;
}

export interface CachePurger {
  /** Borra las entradas cuya clave empieza por `prefijo`. Devuelve cuántas borró. */
  purgarPorPrefijo(prefijo: string): Promise<number>;
}

export const CACHE_PURGER = 'CACHE_PURGER';

/** Tamaño de lote del `SCAN`: suficiente para no hacer mil viajes, corto para no bloquear. */
const LOTE_SCAN = 200;

export function crearPurgador(store: Keyv): CachePurger {
  const logger = new Logger('CachePurger');

  /** Nodos del adaptador Redis, o `null` si el store es en memoria. */
  const nodosRedis = async (): Promise<ClienteRedisMinimo[] | null> => {
    const adaptador = (store as unknown as { store?: AdaptadorRedisMinimo }).store;
    if (!adaptador || typeof adaptador.getMasterNodes !== 'function') return null;

    try {
      return await adaptador.getMasterNodes();
    } catch (error) {
      // Redis caído: la lectura ya falla como cache miss, así que la purga no
      // tiene nada que invalidar. Se anota y se devuelve vacío en vez de
      // provocar un error que el llamante tendría que distinguir.
      logger.warn(
        `No se pudo obtener el cliente Redis para la purga: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  };

  return {
    async purgarPorPrefijo(prefijo: string): Promise<number> {
      const nodos = await nodosRedis();

      if (nodos === null) return purgarEnMemoria(store, prefijo);

      let borradas = 0;
      for (const nodo of nodos) {
        let cursor = '0';
        do {
          const { cursor: siguiente, keys } = await nodo.scan(cursor, {
            MATCH: `${prefijo}*`,
            COUNT: LOTE_SCAN,
            // Solo claves de caché (strings). Descarta streams, sets y listas
            // —BullMQ usa estructuras no-string— aunque el MATCH ya las excluya.
            TYPE: 'string',
          });
          cursor = String(siguiente);

          if (keys.length > 0) {
            await nodo.del(keys);
            borradas += keys.length;
          }
        } while (cursor !== '0');
      }

      return borradas;
    },
  };
}

/**
 * Camino sin Redis: el `Map` de Keyv sólo contiene entradas nuestras, así que
 * recorrerlo con el `iterator` de Keyv es seguro.
 */
async function purgarEnMemoria(store: Keyv, prefijo: string): Promise<number> {
  const claves: string[] = [];

  for await (const [clave] of store.iterator()) {
    if (typeof clave === 'string' && clave.startsWith(prefijo)) {
      claves.push(clave);
    }
  }

  if (claves.length === 0) return 0;

  await store.deleteMany(claves);
  return claves.length;
}
