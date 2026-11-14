#!/usr/bin/env node
/**
 * Genera `public/assets/env.js` a partir de las variables de entorno `API_URL`
 * y `PRIMEUI_LICENSE`.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 * El frontend resuelve su backend en TRES pasos (ver `core/constants/api.constants.ts`):
 *
 *   1. `window.__env.API_URL`  → lo escribe este script (build de Vercel) o
 *                                `entrypoint.sh` (imagen Docker).
 *   2. Fallback de compilación → constante de `api.constants.ts`.
 *
 * Hasta ahora, el paso 1 NUNCA se rellenaba en Vercel: `public/assets/env.js` se
 * versiona vacío (`window.__env = {}`) y el hosting estático no lo reescribe. Es
 * decir, definir `API_URL` en el panel de Vercel no tenía NINGÚN efecto sobre el
 * bundle publicado: el cliente seguía usando la constante compilada. Este script
 * cierra ese hueco.
 *
 * ── Licencia de PrimeUI ──────────────────────────────────────────────────────
 * PrimeNG 22 se usa bajo la licencia Community (gratuita para quien cumpla los
 * criterios) o Commercial de PrimeUI, y verifica la clave al arrancar. La clave
 * se entrega como `window.__PRIMEUI_LICENSE__` —la lee `app.config.ts`— y NO se
 * versiona: este archivo la escribe en build a partir de `PRIMEUI_LICENSE`, que
 * solo existe en el panel de Vercel o en el `docker run -e`.
 *
 * ── Reglas de seguridad ──────────────────────────────────────────────────────
 * · Sin ninguna de las dos variables el script NO toca el archivo. Un `npm start`
 *   local, un build de CI o un `ng build` a mano siguen usando el fallback de
 *   compilación y no ensucian el árbol de trabajo.
 * · Con `API_URL` (Vercel), el archivo se sobrescribe con un valor validado.
 *   En Vercel el workspace es efímero, así que no hay nada que ensuciar.
 * · Se rechazan valores que no sean http(s) —o relativos— para que un error de
 *   tecleo no deje la app apuntando a `undefined/api/v1`.
 * · La clave se escapa como string JS y nunca se imprime en el log.
 *
 * Uso:
 *   API_URL=https://barberias-api-p3br.onrender.com/api/v1 \
 *   PRIMEUI_LICENSE=<clave> \
 *     node scripts/generate-runtime-env.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO = resolve(AQUI, '..', 'public', 'assets', 'env.js');

/** URL canónica de producción, la misma que documenta `api.constants.ts`. */
const CANONICA = 'https://barberias-api-p3br.onrender.com/api/v1';

const crudo = (process.env.API_URL ?? '').trim();
const licenciaCruda = (process.env.PRIMEUI_LICENSE ?? '').trim();

if (!crudo && !licenciaCruda) {
  console.log(
    `[env.js] Sin API_URL ni PRIMEUI_LICENSE: se conserva public/assets/env.js (fallback ${CANONICA}).`,
  );
  process.exit(0);
}

/** Escapa un valor para que quede como literal JS entre comillas dobles. */
const aLiteralJs = (valor) => valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const lineas = [
  '// GENERADO en tiempo de build por scripts/generate-runtime-env.mjs — NO editar a mano.',
  '// Fuente: variables de entorno API_URL y PRIMEUI_LICENSE. Si se cambia aquí sin',
  '// cambiar la variable, el siguiente despliegue la sobrescribe.',
  'window.__env = window.__env || {};',
];

if (crudo) {
  // Sin barra final: los consumidores componen `${API_URL}/shops/...`.
  const sinBarra = crudo.replace(/\/+$/, '');

  const esAbsoluta = /^https?:\/\/[^\s"'<>]+$/i.test(sinBarra);
  const esRelativa = /^\/[^\s"'<>]*$/.test(sinBarra);

  if (!esAbsoluta && !esRelativa) {
    console.error(
      `[env.js] API_URL inválida: "${crudo}". Debe ser http(s)://host/ruta o una ruta relativa /api/v1.`,
    );
    process.exit(1);
  }

  lineas.push(`window.__env.API_URL = "${aLiteralJs(sinBarra)}";`);
}

if (licenciaCruda) {
  lineas.push(`window.__PRIMEUI_LICENSE__ = "${aLiteralJs(licenciaCruda)}";`);
}

mkdirSync(dirname(DESTINO), { recursive: true });
writeFileSync(DESTINO, `${lineas.join('\n')}\n`, 'utf8');

if (crudo) {
  console.log(`[env.js] API_URL de runtime configurada → ${crudo.replace(/\/+$/, '')}`);
}

if (licenciaCruda) {
  // Nunca se imprime la clave: solo que existe.
  console.log('[env.js] Licencia de PrimeUI inyectada en window.__PRIMEUI_LICENSE__.');
}
