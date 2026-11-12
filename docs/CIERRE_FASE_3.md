# Cierre de la Fase 3 — registro de incidencias y consideraciones

**Rama:** `feat/fase-3-nucleo` · **Fecha:** 2026-11-12 · **Estado:** lista para PR, sin push
**Alcance:** rol neutro, limpieza de navegación, compilación TypeScript a cero, batch de membresías, refactor del login y cierre de higiene del repositorio.

Este documento registra las incidencias aparecidas durante desarrollo, compilación y pruebas locales, con su estado real al cierre y lo que queda pendiente antes de producción. Se mantiene como referencia para las próximas fases y para el pipeline de CI/CD.

---

## 1. Inlining de fuentes: `ETIMEDOUT` contra Google Fonts en `npm run build`

**Contexto.** Los dos primeros intentos de `npm run build` fallaron con un timeout de red al resolver `fonts.googleapis.com`. `src/index.html:10-12` enlaza Outfit y Plus Jakarta Sans desde Google Fonts, y la optimización de producción de Angular **descarga e incrusta esas hojas de estilo en tiempo de compilación** (`optimization.fonts.inline`, activo por defecto). Un build con la red caída o con salida restringida falla por una dependencia externa que nada tiene que ver con el código.

**Estado.** Con red disponible el bundle se generó limpio (11,4 s y 27,7 s en las dos ejecuciones registradas). No es un defecto del proyecto, pero **sí es un riesgo real de CI/CD**: un runner aislado sin salida a `fonts.googleapis.com` romperá el pipeline de forma intermitente y difícil de diagnosticar.

**Recomendaciones (elegir una antes de mover el build a CI):**

1. **Autohospedar las fuentes** (la opción robusta): descargar los `.woff2` a `public/fonts/`, declarar `@font-face` en `src/styles.css` y eliminar los tres `<link>` de `index.html`. Elimina la dependencia externa también en runtime.
2. **Desactivar solo el inlining** en la configuración de producción de `angular.json`:

   ```json
   "production": {
     "optimization": {
       "scripts": true,
       "styles": { "minify": true, "inlineCritical": true },
       "fonts": { "inline": false }
     }
   }
   ```

   El build deja de salir a la red; las fuentes se resuelven en el navegador del usuario.
3. Si se mantiene el inlining: garantizar salida a `fonts.googleapis.com`/`fonts.gstatic.com` en el runner y **reintentar** ante fallo (el error ya demostró ser transitorio).

**Pendiente.** Decidir entre 1 y 2; hoy el build depende de la red.

---

## 2. Higiene del repositorio y control de versiones

**Contexto.** Durante la preparación de los commits hubo dos episodios distintos, y conviene no confundirlos:

- **Scripts de parcheo temporales.** Los ajustes puntuales se aplicaron con `node -e` / heredocs efímeros que **nunca entraron en el índice de Git**; se verificó con `git status --short` antes de cada commit. En esta rama **no hubo `git amend`**: los commits se construyeron limpios desde el principio y no se reescribió historia.
- **Artefactos ajenos a la Fase 3.** El diff contra `main` arrastraba `runs-asc.txt` (1,4 MB, 20.940 líneas con el volcado de 419 ejecuciones de GitHub Actions), `tl.json` (respuesta de *rate limit* de la API de GitHub) y `tl2.json` (un array vacío), introducidos por accidente en el commit `425f053` del 2026-11-08.

**Estado.** Los tres artefactos se inspeccionaron en busca de credenciales (`ghp_`, `github_pat_`, `AKIA`, `*PASSWORD=`) con **0 coincidencias** y se eliminaron en `b4ddf4e`. Las capturas de la validación visual (`qa-fase3/`) están en `.gitignore` desde `470f159`, así que ya no aparecen como *untracked*. `git status` queda **vacío** y el diff contra `main` bajó de 26.387 a 5.443 inserciones.

**Pendiente.** Nada en esta rama. Como norma: revisar `git status --short` y `git diff --stat main...HEAD` antes de cada PR, porque un artefacto de este tipo infla el diff y puede arrastrar datos del entorno.

---

## 3. Contraseña del seed de administrador

**Contexto.** `prisma/seed-admin.ts` creaba la cuenta `admin.cremaq.production@test.com` con la contraseña fija `qa-segura-42` escrita en el código. Su refactorización de fondo vive en la rama paralela `chore/seeds-admin-qa`, todavía sin mergear.

**Estado en esta rama.** El seed **ya está parametrizado** (commit `a6a8142`, posterior a la revisión inicial que lo daba por pendiente):

```ts
const password = process.env.ADMIN_SEED_PASSWORD || 'qa-segura-42';
```

- `adminData` ya no contiene `passwordPlain`; el hash bcrypt usa `password`.
- El script carga `.env` con `process.loadEnvFile('.env')` (con `existsSync` previo), porque **`tsx` no lee `.env` por su cuenta** aunque el CLI de Prisma sí. Sin esa carga, poner la variable en `.env` no habría tenido efecto y el script habría caído siempre al literal.
- `qa-segura-42` sobrevive **solo** como respaldo para una base de desarrollo recién creada; no es la vía prevista para producción.

**Pendiente antes de producción:**

1. Mergear `chore/seeds-admin-qa` para no dejar el seed a medias entre ramas.
2. Definir `ADMIN_SEED_PASSWORD` en el entorno de despliegue y ejecutar `npx tsx prisma/seed-admin.ts` **solo** con esa variable presente.
3. Valorar un **guard explícito** que aborte el script cuando `NODE_ENV === 'production'` y falte la variable, en lugar de degradar al literal. Hoy el respaldo es silencioso: es el último resquicio de la credencial fija y la decisión (fallar o degradar) debe ser consciente.
4. Rotar la contraseña de esa cuenta si el repo es público o compartido, dado que el literal existió en el historial.

---

## 4. Cobertura de pruebas y entornos no ejecutados

### 4.1 Validación visual en navegador — realizada en esta fase

Verificado en navegador real (`http://localhost:4200`), no solo por tipos y tests:

- **Login refactorizado:** un único `<form>` en el DOM en cada momento (`#login-form`, `#recovery-form`, `#recovery-reset-form`); al abrir recuperación se desmonta el login y al cerrar vuelve; `Enter` en la contraseña dispara el `ngSubmit` y autentica sin tocar el botón; `autocomplete` correcto por campo.
- **Cabecera y menú de perfil:** los cuatro perfiles (Administrador, Barbero, Cliente y Sin Rol) renderizan sus atajos correctos; la cuenta `qa.sinrol@demo.com` muestra el badge neutro "Sin rol asignado" y nunca "Cliente"; "Gestionar Barberías" solo aparece cuando la cuenta gestiona sedes, y Cliente/Sin Rol ven "Vincularme a una barbería".
- **Batch:** una sola llamada `GET /mi-estado/membresias` y **cero** `GET /shops/:id/membership` para una cuenta con sede vinculada.

**Pendiente:** las validaciones gráficas manuales finales (regresión visual en móvil real, contraste y foco de teclado en el modal) siguen siendo una tarea de aceptación del revisor, no algo que sustituyan los tests.

### 4.2 Pruebas End-to-End — no ejecutadas en este tramo

La suite existe y está cableada: `npm run test:e2e` en `backend-barberias` (`vitest run --config ./vitest.config.e2e.ts`, con specs en `test/*.e2e-spec.ts`). **No se ejecutó completa** porque requiere PostgreSQL/Neon y Redis activos y accesibles durante toda la corrida.

Cómo cerrarla:

```bash
# 1. Infraestructura arriba (Postgres + Redis) y DATABASE_URL/REDIS_URL apuntando a ella
cd backend-barberias
npm run prisma:migrate        # esquema al día
npm run seed:demo             # datos de la demo (opcional, según el spec)
npm run test:e2e
```

**Pendiente:** ejecutarla en verde antes del merge final y, si se quiere estabilidad, levantarla en CI con servicios contenedorizados (Postgres y Redis como *services*) en lugar de depender de infraestructura local permanente.

---

## Verificación de cierre

Sobre el árbol cerrado y limpio (`git status` vacío):

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` (frontend `app` + `spec`) | 0 errores · 0 errores |
| `npx tsc --noEmit` (backend) | 0 errores |
| `npm run lint` (frontend) | 0 warnings, 0 errores · 99 archivos |
| `npm run lint` (backend) | 0 warnings, 0 errores · 343 archivos |
| `npx ng test --watch=false` | 168/168 en 19 archivos |
| `npx vitest run` (backend) | 1009 passed, 1 skipped · 85/85 archivos |
| `npm run build` | bundle OK |

El test omitido del backend es intencional: un caso de integración que exige credenciales de producción.

## Commits de la fase

```
b4ddf4e chore: elimina volcados de la API de GitHub y errores curl del árbol
470f159 chore(qa): documenta el stub de Prisma y limpia el árbol de la fase 3
a6a8142 fix(seed): lee la contraseña del admin sembrado desde el entorno
f3b5036 refactor(auth): deja un solo formulario montado en el login
8a9ebc2 feat(ui): avisa del lote ausente y llena el perfil de barbero y cuentas nuevas
3fa78c7 feat(fase-3): rol neutro, navegación sin duplicados y membresías en lote
```

## Checklist antes del merge a producción

- [ ] Mergear `chore/seeds-admin-qa` y definir `ADMIN_SEED_PASSWORD` en el entorno de despliegue.
- [ ] Decidir estrategia de fuentes (autohospedar o `fonts.inline: false`) para no depender de la red en el build.
- [ ] Rotar la contraseña de la cuenta de administrador sembrada.
- [ ] Ejecutar `npm run test:e2e` en verde con Postgres y Redis activos.
- [ ] Regresión visual manual final en móvil y teclado.
- [ ] Push de `feat/fase-3-nucleo` y apertura del PR (pendiente de autorización).
