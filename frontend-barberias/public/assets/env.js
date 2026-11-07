// Runtime config del frontend (Paso 18).
//
// En Vercel lo REGENERA `scripts/generate-runtime-env.mjs` durante el build a
// partir de la variable de entorno API_URL del proyecto. En la imagen Docker lo
// escribe `entrypoint.sh` al arrancar nginx.
//
// Este archivo versionado es el valor por defecto: deja API_URL sin definir para
// que Angular use el fallback de compilación (`core/constants/api.constants.ts`),
// que en producción es el backend canónico. Los entornos locales no necesitan
// configurar nada.
window.__env = window.__env || {};
