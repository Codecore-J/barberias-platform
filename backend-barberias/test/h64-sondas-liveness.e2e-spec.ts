/**
 * H64 · Sondas de VIDA y de PREPARACIÓN separadas.
 *
 * POR QUÉ EXISTE: `render.yaml` usa `healthCheckPath: /health`, y esa ruta
 * comprueba Base de Datos **y Redis**. Medido con Redis inalcanzable y la API ya
 * sirviendo, `/health` responde 503; si el orquestador trata esa ruta como sonda
 * de vida, reinicia en bucle una instancia que está atendiendo reservas, pagos y
 * catálogos, y tira por tierra la degradación elegante del arranque (H63).
 *
 * QUÉ FIJA ESTE TEST (por HTTP real, no por metadatos):
 *   1. `GET /api/v1/health/liveness` responde **200** con Redis caído: la vida
 *      del proceso no depende de la cola.
 *   2. La sonda de preparación (`/api/v1/health`) sigue mirando Redis y devuelve
 *      **503** en ese mismo escenario: la separación es real, no un alias.
 *   3. La app **arranca** con Redis caído (H63), con un tope: si alguien vuelve a
 *      poner un `await` contra la cola en el ciclo de vida, el `beforeAll` se
 *      queda sin arrancar y este fichero falla.
 *
 * CÓMO SE SIMULA "Redis CAÍDO": se pide al sistema un puerto libre y se libera
 * antes de arrancar, así que nadie escucha en él (ECONNREFUSED inmediato, no un
 * timeout). `REDIS_URL` se asigna ANTES de importar `AppModule` porque el
 * registro de colas de BullMQ lo lee al decorarse el módulo.
 */
import { createServer } from 'node:net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const puertoMuerto = await new Promise<number>((resolver, rechazar) => {
  const sonda = createServer();
  sonda.once('error', rechazar);
  sonda.listen(0, '127.0.0.1', () => {
    const direccion = sonda.address();
    const puerto = typeof direccion === 'object' && direccion ? direccion.port : 0;
    sonda.close(() => resolver(puerto));
  });
});

process.env.REDIS_URL = `redis://127.0.0.1:${puertoMuerto}`;
const { AppModule } = await import('../src/app.module.js');

/** El mismo prefijo y las mismas exclusiones que `src/main.ts`. */
const EXCLUSIONES = ['health', 'api/v1/health', 'health/liveness', 'api/v1/health/liveness'];

describe('H64 · sondas de vida y de preparación', () => {
  let app: INestApplication;
  let msArranque = 0;

  beforeAll(async () => {
    const inicio = Date.now();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: EXCLUSIONES });
    await app.init();

    msArranque = Date.now() - inicio;
    console.log(
      `\n[H64] arranque con Redis en 127.0.0.1:${puertoMuerto} (nadie escucha): ${msArranque} ms`,
    );
  }, 60_000);

  afterAll(async () => {
    // H66 (nuevo, ver reporte): con Redis caído `app.close()` NO termina —el
    // cierre espera a las conexiones de BullMQ y ioredis sigue reintentando—, así
    // que el desmontaje se acota en vez de colgar la suite. El objetivo de este
    // fichero son las sondas; el apagado se mide aparte.
    const inicio = Date.now();
    const cerro = await Promise.race([
      app.close().then(() => true),
      new Promise<boolean>((resolver) => setTimeout(() => resolver(false), 5_000)),
    ]);
    const ms = Date.now() - inicio;

    console.log(
      `[H64] app.close() con Redis caído: ${cerro ? `${ms} ms` : 'NO terminó en 5 s (H66)'}`,
    );
  }, 20_000);

  it('H63 · la app arranca con Redis caído en un tiempo acotado', () => {
    // Antes de H63 esto no terminaba nunca (el `beforeAll` se agotaba). Un tope
    // además detecta la regresión más sutil: arrancar, pero esperando a la cola.
    expect(msArranque).toBeGreaterThan(0);
    expect(msArranque).toBeLessThan(20_000);
  });

  it('VERDE CRÍTICO · GET /api/v1/health/liveness responde 200 con Redis caído', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/liveness');

    console.log(`[H64] /api/v1/health/liveness → ${res.status} ${JSON.stringify(res.body)}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('la sonda de vida también se sirve sin el prefijo (/health/liveness)', async () => {
    const res = await request(app.getHttpServer()).get('/health/liveness').expect(200);

    expect(res.body.status).toBe('ok');
  });

  it('la sonda de vida NO toca la base de datos ni Redis', async () => {
    // Si tocara Redis, con la cola caída tardaría segundos (connectTimeout) o
    // devolvería 503; aquí tiene que ser inmediata y sin indicadores externos.
    const inicio = Date.now();
    const res = await request(app.getHttpServer()).get('/api/v1/health/liveness');
    const ms = Date.now() - inicio;

    console.log(`[H64] liveness con Redis caído: ${ms} ms`);
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(1_000);
    expect(res.body.info).toBeUndefined();
    expect(res.body.details).toBeUndefined();
  });

  it('la sonda de PREPARACIÓN sigue mirando Redis y devuelve 503 con Redis caído', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');

    console.log(
      `[H64] /api/v1/health (readiness) → ${res.status} ${JSON.stringify(res.body?.error ?? res.body?.details ?? {})}`,
    );

    expect(res.status).toBe(503);
    const redis = res.body?.error?.redis ?? res.body?.details?.redis;
    expect(redis?.status).toBe('down');

    // La preparación SÍ incluye la base de datos (la vida no): eso es lo que se
    // separa. No se afirma su estado aquí a propósito: sobre la base remota el
    // `pingCheck` de Terminus tiene un tope de 1 s que a veces se agota (ver el
    // hallazgo H65 del reporte), y este test no debe volverse intermitente por
    // una latencia ajena a H64.
    const base = res.body?.error?.database ?? res.body?.details?.database;
    expect(base).toBeDefined();
  });
});
