import { existsSync, readFileSync } from 'node:fs';

/**
 * FASE E2E FINAL: la suite e2e corre contra los contenedadores locales de
 * `docker-compose.yml` (Postgres + Redis), no contra Neon ni Upstash.
 *
 * `dotenv` no es dependencia del proyecto, así que el parser es deliberadamente
 * mínimo: cubre el formato `CLAVE=valor` (con comillas opcionales) de
 * `.env.test` y nada más. Las variables que el entorno YA tenga exportadas
 * (CI exporta las suyas) tienen prioridad: este loader solo rellena huecos.
 */
function cargarEnvDePruebas(): void {
  const archivo = new URL('../.env.test', import.meta.url);
  if (!existsSync(archivo)) return;

  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;

    const separador = limpia.indexOf('=');
    if (separador <= 0) continue;

    const clave = limpia.slice(0, separador).trim();
    let valor = limpia.slice(separador + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    if (process.env[clave] === undefined) {
      process.env[clave] = valor;
    }
  }
}

cargarEnvDePruebas();

export function assertSafeTestDatabase() {
  if (process.env.APP_ENV !== 'dev') {
    console.error(`TEST ABORTED: APP_ENV is set to '${process.env.APP_ENV}'. E2E/Integration tests must only run in 'dev' environment to prevent data loss in staging/production.`);
    process.exit(1);
  }
}

assertSafeTestDatabase();
