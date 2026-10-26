// Runtime config (Paso 18).
//
// Este es el valor POR DEFECTO: viaja dentro del build y solo sirve para que
// la SPA no truene si nadie sobrescribe el archivo (ng serve, despliegue
// estático, tests). Al arrancar el contenedor, entrypoint.sh lo REESCRIBE con
// la variable de entorno API_URL de ese contenedor, de modo que la misma
// imagen conecta a cualquier backend sin recompilar.
//
// Debe cargarse antes de Angular: index.html lo incluye en <head>.
window.__env = {
  API_URL: 'http://localhost:3000/api/v1',
};