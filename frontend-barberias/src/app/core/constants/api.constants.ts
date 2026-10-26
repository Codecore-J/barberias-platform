import { isDevMode } from '@angular/core';

/**
 * Runtime config (Paso 18).
 *
 * `window.__env` lo define `/assets/env.js`: en el contenedor lo escribe
 * `entrypoint.sh` con la variable de entorno `API_URL` al arrancar nginx, y
 * fuera de contenedor vale el archivo por defecto del build. Así la URL del
 * backend se decide EN TIEMPO DE EJECUCIÓN y no queda soldada al compilar
 * (que era justo el problema de tenerla hardcodeada aquí).
 */
interface RuntimeEnv {
  API_URL?: string;
}

const runtimeEnv: RuntimeEnv | undefined =
  typeof window !== 'undefined'
    ? (window as unknown as { __env?: RuntimeEnv }).__env
    : undefined;

/**
 * Fallback de compilación, usado cuando no hay `env.js` (tests unitarios,
 * build estática sin entrypoint): exactamente el comportamiento anterior.
 */
const API_URL_POR_DEFECTO = isDevMode()
  ? 'http://localhost:3000/api/v1'
  : 'https://barberias-api-p3br.onrender.com/api/v1';

/** Sin barra final: los consumidores componen `${API_URL}/shops/...`. */
const normalizar = (url: string): string => url.replace(/\/+$/, '');

export const API_URL = normalizar(runtimeEnv?.API_URL || API_URL_POR_DEFECTO);