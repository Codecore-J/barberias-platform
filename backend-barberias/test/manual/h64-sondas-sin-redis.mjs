/**
 * H64 · Comprobación manual de las sondas contra el PROCESO REAL (herramienta).
 *
 * POR QUÉ EXISTE: el E2E de H64 (`test/h64-sondas-liveness.e2e-spec.ts`) levanta
 * la app en el mismo proceso del test con su propio `setGlobalPrefix`, así que
 * demuestra el comportamiento del controlador, pero no que el prefijo y las
 * exclusiones de `src/main.ts` dejen las rutas donde Render las va a pedir. Este
 * arnés lanza `dist/main.js` con un Redis inalcanzable y consulta por HTTP:
 *
 *   - `GET /api/v1/health/liveness` → debe ser 200 (sonda de vida, sin dependencias)
 *   - `GET /health/liveness`        → alias sin prefijo, también 200
 *   - `GET /api/v1/health`          → debe ser 503 (preparación: mira base, Redis y memoria)
 *
 * USO (desde `backend-barberias`, con DATABASE_URL disponible):
 *
 *   npm run build
 *   set -a; . ./.env; set +a
 *   REDIS_URL=redis://127.0.0.1:6399 node test/manual/h64-sondas-sin-redis.mjs 3998
 *
 * Salida 0 solo si la vida responde 200 y la preparación 503 con la cola caída.
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARTEFACTO = join(RAIZ, 'dist', 'main.js');
const PUERTO = String(process.argv[2] ?? '3998');

const hijo = spawn(process.execPath, [ARTEFACTO], {
  cwd: RAIZ,
  env: { ...process.env, PORT: PUERTO },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const inicio = Date.now();
let arranco = false;

const sonda = async (ruta) => {
  try {
    const res = await fetch(`http://127.0.0.1:${PUERTO}${ruta}`, {
      signal: AbortSignal.timeout(8000),
    });
    return { status: res.status, cuerpo: await res.text() };
  } catch (err) {
    return { status: null, cuerpo: String(err) };
  }
};

const revisar = async () => {
  arranco = true;
  const msArranque = Date.now() - inicio;

  const vida = await sonda('/api/v1/health/liveness');
  const vidaSinPrefijo = await sonda('/health/liveness');
  const preparacion = await sonda('/api/v1/health');
  const correcto = vida.status === 200 && preparacion.status === 503;

  console.log('\n================ H64 · PROCESO REAL ================');
  console.log(`artefacto          : ${ARTEFACTO}`);
  console.log(`REDIS_URL          : ${process.env.REDIS_URL ?? '(no definida)'}`);
  console.log(`arrancado en       : ${msArranque} ms`);
  console.log(`GET /api/v1/health/liveness      : ${vida.status} ${vida.cuerpo.slice(0, 120)}`);
  console.log(`GET /health/liveness             : ${vidaSinPrefijo.status} ${vidaSinPrefijo.cuerpo.slice(0, 80)}`);
  console.log(`GET /api/v1/health (preparación) : ${preparacion.status} ${preparacion.cuerpo.slice(0, 200)}`);
  console.log(`vida 200 y preparación 503       : ${correcto ? 'SÍ' : 'NO'}`);
  console.log('====================================================');

  hijo.kill('SIGKILL');
  process.exit(correcto ? 0 : 1);
};

hijo.stdout.setEncoding('utf8');
hijo.stdout.on('data', (bloque) => {
  if (!arranco && bloque.includes('successfully started')) {
    setTimeout(() => void revisar(), 300);
  }
});
hijo.stderr.setEncoding('utf8');
hijo.stderr.on('data', () => {});

setTimeout(() => {
  if (!arranco) {
    console.log('nunca arrancó en 30 s');
    hijo.kill('SIGKILL');
    process.exit(1);
  }
}, 30_000);
