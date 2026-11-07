import { isDevMode } from '@angular/core';

/**
 * URL base del backend — resolución en dos pasos, de más a menos específico.
 *
 *   1. `window.__env.API_URL`  (RUNTIME)
 *      En Vercel lo escribe `scripts/generate-runtime-env.mjs` durante el build a
 *      partir de la variable de entorno `API_URL` del proyecto. En la imagen
 *      Docker lo escribe `entrypoint.sh` al arrancar nginx. Permite cambiar de
 *      backend sin recompilar.
 *
 *   2. Fallback de compilación (abajo)
 *      Solo se usa cuando nadie definió `API_URL`: `npm start` en local, tests
 *      unitarios o un build estático sin configurar.
 *
 * ── Backend canónico de producción ───────────────────────────────────────────
 * `https://barberias-api-p3br.onrender.com/api/v1`
 *
 * Es el ÚNICO origen que sirve la API. El dominio del frontend
 * (`https://barberias-platform.vercel.app`) expone `/api/*` solo como proxy
 * declarado en `vercel.json`; antes de esa regla esa ruta devolvía `index.html`
 * con un 200 engañoso. El cliente Angular consume el backend DIRECTAMENTE para
 * no sumar un salto de proxy ni compartir la IP de egreso de Vercel en el rate
 * limiting del backend (`ThrottlerGuard`, 120 req/min por IP).
 *
 * ── Cold start ───────────────────────────────────────────────────────────────
 * El servicio corre en el plan gratuito de Render, que duerme la instancia tras
 * ~15 min sin tráfico; el primer request tras el sueño tarda 20-50 s. Eso NO se
 * arregla en el cliente: lo mantiene despierto el cron de
 * `.github/workflows/keep-alive.yml` (cada 10 min). El cliente solo mitiga la
 * percepción con `<app-backend-waking>`, alimentado por `EstadoConexionService`.
 */
interface RuntimeEnv {
  API_URL?: string;
}

const runtimeEnv: RuntimeEnv | undefined =
  typeof window !== 'undefined'
    ? (window as unknown as { __env?: RuntimeEnv }).__env
    : undefined;

/** Backend canónico de producción. Ver la nota de arriba. */
const API_URL_PRODUCCION = 'https://barberias-api-p3br.onrender.com/api/v1';

/** Backend local del monorepo (`npm run start:backend`). */
const API_URL_DESARROLLO = 'http://localhost:3000/api/v1';

/**
 * Fallback de compilación, usado cuando no hay `env.js` o nadie definió
 * `API_URL` (tests unitarios, build estática sin entrypoint).
 */
const API_URL_POR_DEFECTO = isDevMode() ? API_URL_DESARROLLO : API_URL_PRODUCCION;

/**
 * Normaliza la URL recibida:
 *  - recorta espacios,
 *  - elimina la barra final (los consumidores componen `${API_URL}/shops/...`),
 *  - acepta rutas relativas (`/api/v1`) para despliegues same-origin.
 */
const normalizar = (url: string): string => url.trim().replace(/\/+$/, '');

export const API_URL = normalizar(runtimeEnv?.API_URL || API_URL_POR_DEFECTO);
