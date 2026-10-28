import { Global, Logger, Module } from '@nestjs/common';
import { CacheModule, type CacheModuleOptions } from '@nestjs/cache-manager';
import { createKeyvNonBlocking } from '@keyv/redis';
import { Keyv } from 'keyv';
import { CACHE_PURGER, crearPurgador } from './cache-purger.js';

/**
 * TTL de las agregaciones de analíticas. Quince minutos es el compromiso: el
 * dueño abre el panel y ve cifras al día sin que cada refresco cueste seis
 * consultas por sede.
 */
export const TTL_CACHE_ANALITICAS_MS = 15 * 60 * 1000;

/**
 * Token del `Keyv` de respaldo. `CACHE_MANAGER` sirve para leer y escribir, pero
 * no expone iteración de claves, y la invalidación por prefijo necesita
 * recorrerlas. Es el MISMO store que usa `CACHE_MANAGER`: no hay dos cachés.
 */
export const CACHE_STORE = 'CACHE_STORE';

let storeSingleton: Keyv | undefined;

/**
 * Elige el store una sola vez por proceso.
 *
 * Con `REDIS_URL` la caché se comparte entre instancias (lo que hace útil el
 * TTL cuando hay más de un contenedor). Sin ella —desarrollo local y CI— se usa
 * el store en memoria de Keyv, sin conexiones ni servicios externos.
 *
 * Se construye de forma perezosa (al arrancar el módulo, no al importar el
 * fichero) para que importar `AppModule` en una prueba no abra sockets.
 *
 * `createKeyvNonBlocking` es deliberado: una caché caída debe degradar a
 * *cache miss*, nunca a un 500 ni a una petición colgada. Con el adaptador
 * bloqueante, Redis ausente haría fallar o esperar cada lectura de analíticas.
 */
export function obtenerCacheStore(): Keyv {
  if (storeSingleton) return storeSingleton;

  const logger = new Logger('CacheModule');
  const url = process.env.REDIS_URL?.trim();

  if (url) {
    storeSingleton = createKeyvNonBlocking(url, { connectionTimeout: 2000 });
    logger.log('Caché de analíticas sobre Redis (REDIS_URL).');
  } else {
    storeSingleton = new Keyv();
    logger.log('Caché de analíticas en memoria (REDIS_URL no definida).');
  }

  return storeSingleton;
}

/**
 * Caché compartida de la aplicación.
 *
 * `isGlobal` en `CacheModule` deja `CACHE_MANAGER` disponible en cualquier
 * módulo sin importar nada; el `@Global()` del propio módulo hace lo mismo con
 * `CACHE_STORE`, que es el que necesitan los invalidadores.
 */
@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: (): CacheModuleOptions => ({
        stores: [obtenerCacheStore()],
        ttl: TTL_CACHE_ANALITICAS_MS,
      }),
    }),
  ],
  providers: [
    { provide: CACHE_STORE, useFactory: obtenerCacheStore },
    // La invalidación por prefijo NO puede usar `CACHE_STORE.iterator()`: en
    // Redis recorre todo el keyspace y deserializa claves de BullMQ que no son
    // JSON. El purgador filtra en Redis con `SCAN MATCH` y borra sin leer.
    {
      provide: CACHE_PURGER,
      useFactory: (store: Keyv) => crearPurgador(store),
      inject: [CACHE_STORE],
    },
  ],
  exports: [CACHE_STORE, CACHE_PURGER],
})
export class AppCacheModule {}
