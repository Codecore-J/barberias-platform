/**
 * Política de CORS de la API (CONF-02).
 *
 * Vive fuera de `main.ts` para poder probarla sin arrancar Nest: el bug que
 * corrige este módulo solo se veía en el preflight de un origen desconocido.
 *
 * Regla: un `Origin` que no está en la lista NO es un error del servidor. Antes
 * el callback de `enableCors` devolvía `new Error(...)`, Express lo propagaba y
 * el filtro global lo convertía en **500 Internal Server Error**: el navegador
 * recibía un fallo del backend en lugar de un rechazo de CORS, y cualquier
 * preview local parecía una caída (verificado: `OPTIONS` con
 * `Origin: http://127.0.0.1:4300` → 500).
 */

/**
 * Orígenes autorizados por defecto: el frontend oficial y los puertos locales
 * de desarrollo. `FRONTEND_URL` (lista separada por comas) puede ampliarla sin
 * recompilar.
 */
export const ORIGENES_POR_DEFECTO: readonly string[] = [
  'https://barberias-platform-git-main-developerstem.vercel.app',
  'https://barberias-platform.vercel.app',
  'http://localhost:4200',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:4200',
];

/** Previews de Vercel del equipo (`barberias-platform-<hash>-developerstem…`). */
const PREVIEW_VERCEL = /^https:\/\/barberias-platform.*-developerstem\.vercel\.app$/;

/** Lista efectiva: la de por defecto más lo que declare `FRONTEND_URL`. */
export function origenesPermitidos(
  frontendUrl: string | undefined = process.env.FRONTEND_URL,
): string[] {
  const extras = (frontendUrl ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  return [...new Set([...ORIGENES_POR_DEFECTO, ...extras])];
}

/**
 * ¿Este origen puede consumir la API?
 *
 * Sin `Origin` (curl, server-to-server, healthchecks) se permite: CORS es una
 * protección del navegador y no autentica nada por sí misma. El rechazo es
 * explícito para todo lo demás.
 */
export function origenAutorizado(
  origin: string | undefined,
  permitidos: readonly string[] = origenesPermitidos(),
): boolean {
  if (!origin) return true;
  return permitidos.includes(origin) || PREVIEW_VERCEL.test(origin);
}
