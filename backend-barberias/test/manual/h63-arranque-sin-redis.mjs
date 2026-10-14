/**
 * H63 · Arnés de verificación del arranque con Redis caído (herramienta manual).
 *
 * POR QUÉ EXISTE: el fallo de H63 no se veía en ningún test —la app no arrancaba,
 * así que ni el `beforeAll` de un E2E llegaba a ejecutarse— y solo se podía
 * comprobar levantando el proceso de verdad. Este arnés lanza el ARTEFACTO real
 * (`dist/main.js`, lo que sirve `npm run start:prod`), marca cada línea de log con
 * los milisegundos transcurridos, sondea HTTP y `GET /api/v1/health`, y resume:
 *
 *   - en qué ms Nest anuncia "Nest application successfully started" (o NUNCA),
 *   - en qué ms la API atiende HTTP por primera vez,
 *   - qué responde /health con la cola caída (readiness vs liveness, H64),
 *   - en qué ms aparece el error crítico del cron y si la reconciliación termina.
 *
 * USO (desde `backend-barberias`, con DATABASE_URL disponible):
 *
 *   npm run build
 *   set -a; . ./.env; set +a
 *   REDIS_URL=redis://127.0.0.1:6399 node test/manual/h63-arranque-sin-redis.mjs 30 3999
 *
 * El puerto 6399 hace de "Redis caído": cualquiera cerrado sirve. Sin
 * `REDIS_URL` se usa el Redis de `docker-compose.yml` (control verde).
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARTEFACTO = join(RAIZ, 'dist', 'main.js');

const SEGUNDOS_MAX = Number(process.argv[2] ?? 30);
const PUERTO = String(process.argv[3] ?? '3999');
// Gracia tras el primer 200: las tareas de arranque que NO deben bloquear (cron
// de purga acotado, reconciliación en segundo plano) tienen que dejar ver su
// degradación en el log DESPUÉS de que la API ya escucha.
const ESPERA_POST_HTTP_MS = Number(process.argv[4] ?? 9000);

const inicio = Date.now();
const lineas = [];

const hijo = spawn(process.execPath, [ARTEFACTO], {
  cwd: RAIZ,
  env: { ...process.env, PORT: PUERTO },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const prefijar = (flujo, salida) => {
  flujo.setEncoding('utf8');
  flujo.on('data', (bloque) => {
    for (const texto of bloque.split('\n')) {
      if (!texto.trim()) continue;
      const ms = Date.now() - inicio;
      lineas.push({ ms, texto });
      salida.write(`${String(ms).padStart(6)}ms | ${texto}\n`);
    }
  });
};

prefijar(hijo.stdout, process.stdout);
prefijar(hijo.stderr, process.stderr);

const msDeLinea = (subcadena) => {
  const hit = lineas.find((l) => l.texto.includes(subcadena));
  return hit ? hit.ms : null;
};

async function sondear(ruta) {
  try {
    const res = await fetch(`http://127.0.0.1:${PUERTO}${ruta}`, {
      signal: AbortSignal.timeout(8000),
    });
    return res.status;
  } catch {
    return null;
  }
}

async function main() {
  let msHttp = null;
  let estadoHttp = null;
  const limite = inicio + SEGUNDOS_MAX * 1000;

  // "/" responde 404 (el prefijo global es /api/v1): basta para probar que el
  // socket ya escucha y atiende HTTP.
  while (Date.now() < limite && !msHttp) {
    const codigo = await sondear('/');
    if (codigo !== null) {
      msHttp = Date.now() - inicio;
      estadoHttp = codigo;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  let msHealth = null;
  let estadoHealth = null;
  if (msHttp !== null) {
    estadoHealth = await sondear('/api/v1/health');
    msHealth = Date.now() - inicio;
    await new Promise((r) => setTimeout(r, ESPERA_POST_HTTP_MS));
  }

  console.log('\n================ RESUMEN H63 ================');
  console.log(`artefacto             : ${ARTEFACTO}`);
  console.log(`proceso hijo pid      : ${hijo.pid}`);
  console.log(`REDIS_URL en el hijo  : ${process.env.REDIS_URL ?? '(no definida)'}`);
  console.log(`HTTP listo            : ${msHttp === null ? 'NO en ' + SEGUNDOS_MAX + 's' : `sí, ${msHttp}ms (GET / → ${estadoHttp})`}`);
  console.log(`/api/v1/health        : ${estadoHealth === null ? 'no se pudo sondear' : `${estadoHealth} a los ${msHealth}ms`}`);
  console.log(`"successfully started": ${msDeLinea('successfully started') === null ? 'NUNCA (bootstrap bloqueado)' : msDeLinea('successfully started') + 'ms'}`);
  console.log(`log CRÍTICO del cron  : ${msDeLinea('CRÍTICO') === null ? 'no aparece' : msDeLinea('CRÍTICO') + 'ms'}`);
  console.log(`reconciliación hecha  : ${msDeLinea('Reconciliación de expiraciones') === null ? 'sin nada que registrar' : msDeLinea('Reconciliación de expiraciones') + 'ms'}`);
  console.log(`aviso notificación    : ${msDeLinea('No se pudo notificar la expiración') === null ? 'no aparece' : msDeLinea('No se pudo notificar la expiración') + 'ms'}`);
  console.log(`primer ECONNREFUSED   : ${msDeLinea('ECONNREFUSED') === null ? 'ninguno' : msDeLinea('ECONNREFUSED') + 'ms'}`);
  console.log(`líneas de log         : ${lineas.length}`);
  console.log('=============================================');

  hijo.kill('SIGKILL');
  process.exit(0);
}

await main();
