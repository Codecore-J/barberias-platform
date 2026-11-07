#!/usr/bin/env node
/**
 * Genera `public/assets/env.js` a partir de la variable de entorno `API_URL`.
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
 * ── Reglas de seguridad ──────────────────────────────────────────────────────
 * · Sin `API_URL` el script NO toca el archivo. Un `npm start` local, un build
 *   de CI o un `ng build` a mano siguen usando el fallback de compilación y no
 *   ensucian el árbol de trabajo.
 * · Con `API_URL` (Vercel), el archivo se sobrescribe con un valor validado.
 *   En Vercel el workspace es efímero, así que no hay nada que ensuciar.
 * · Se rechazan valores que no sean http(s) —o relativos— para que un error de
 *   tecleo no deje la app apuntando a `undefined/api/v1`.
 *
 * Uso:
 *   API_URL=https://barberias-api-p3br.onrender.com/api/v1 \
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

if (!crudo) {
  console.log(
    `[env.js] API_URL no definida: se conserva public/assets/env.js (fallback ${CANONICA}).`,
  );
  process.exit(0);
}

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

const escapada = sinBarra.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const contenido = `// GENERADO en tiempo de build por scripts/generate-runtime-env.mjs — NO editar a mano.
// Fuente: variable de entorno API_URL. Si se cambia aquí sin cambiar la variable,
// el siguiente despliegue la sobrescribe.
window.__env = window.__env || {};
window.__env.API_URL = "${escapada}";
`;

mkdirSync(dirname(DESTINO), { recursive: true });
writeFileSync(DESTINO, contenido, 'utf8');

console.log(`[env.js] API_URL de runtime configurada → ${sinBarra}`);
