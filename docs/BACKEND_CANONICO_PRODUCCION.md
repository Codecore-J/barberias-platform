# Backend canónico de producción y estrategia de latencia

> Documento de referencia de DevOps. Define **una sola** URL oficial para la API
> en producción, cómo la resuelve el cliente Angular y qué se hace con los
> *cold starts* del plan gratuito de Render.
>
> Última revisión: 2026-11-07 · Autor: equipo de plataforma

---

## 1. Decisión oficial

| Componente | URL canónica |
|---|---|
| **API (backend canónico)** | `https://barberias-api-p3br.onrender.com/api/v1` |
| Frontend (SPA Angular) | `https://barberias-platform.vercel.app` |
| Alias de despliegue de Vercel | `https://barberias-platform-git-main-developerstem.vercel.app` |

- El **único origen que ejecuta la API** es el servicio de Render. Vercel es
  exclusivamente hosting estático de la SPA.
- El cliente Angular consume la API **de forma directa** contra el origen de
  Render. No hay proxy de la API a través del dominio de Vercel.
- El path `/api/v1/*` del dominio de Vercel **sí** está enrutado a Render (ver
  §5), pero se usa para sondas y diagnóstico desde el dominio de marca, no como
  ruta principal del cliente.

### Por qué no enrutar al cliente por el dominio de Vercel

Se evaluó y se descartó explícitamente:

1. **Latencia**: un proxy añade un salto Vercel → Render (dos handshakes TLS y
   un reenvío de body), lo que empeora los tiempos del cold start, no los mejora.
2. **Throttler**: `ThrottlerGuard` limita 120 req/min **por IP**. Si todas las
   peticiones entraran por Vercel, llegarían con la IP de egreso de Vercel y los
   usuarios compartirían un único contador → `429` en cascada. El backend ya
   confía en el proxy (`app.set('trust proxy', 1)`) para leer `X-Forwarded-For`,
   pero eso no arregla el caso de un proxy único delante de todos los clientes.
3. **CORS ya está resuelto**: `src/main.ts` incluye
   `https://barberias-platform.vercel.app` en la lista blanca y responde
   `OPTIONS` con `204` + `Access-Control-Max-Age: 86400`, así que las llamadas
   directas no pagan preflight repetido.

---

## 2. Cómo resuelve la URL el cliente Angular

Cadena de resolución (`frontend-barberias/src/app/core/constants/api.constants.ts`):

1. `window.__env.API_URL` — configuración de runtime servida en
   `/assets/env.js`.
2. Si no existe: `API_URL_PRODUCCION` (fallback compilado), que es la URL
   canónica de §1. En `ng serve` se usa `API_URL_DESARROLLO`
   (`http://localhost:3000/api/v1`).
3. `normalizar()` aplica `trim()` y elimina la barra final.

`/assets/env.js` se genera en **tiempo de build**:

- **Vercel**: `scripts/generate-runtime-env.mjs` se ejecuta en `buildCommand` y
  escribe `public/assets/env.js` a partir de la variable de entorno `API_URL`
  del proyecto. Sin `API_URL` no toca el archivo y se usa el fallback compilado
  (mismo valor, así que nunca hay ambigüedad).
- **Docker**: `entrypoint.sh` escribe el mismo archivo al arrancar nginx.

> Antes de este cambio, `API_URL` en Vercel **no tenía efecto**: nada leía la
> variable ni generaba `env.js`, y el archivo versionado quedaba vacío. La URL
> real era siempre la compilada. Ahora la variable sí manda.

---

## 3. Cold start de Render (plan gratuito)

Diagnóstico:

- El servicio está en plan `free`, región `ohio`. Render **suspende la instancia
  tras ~15 minutos sin tráfico entrante**. La primera petición después de eso
  arranca el contenedor: **20-50 s** hasta servir, y Render corta en ~100 s si
  el arranque se cuelga.
- La ruta de liveness es `GET /api/v1/health/liveness` (`render.yaml` la usa como
  `healthCheckPath`). Devuelve `{"status":"ok","uptimeSegundos":N,...}` sin tocar
  base de datos ni Redis, por lo que es la mejor sonda de "¿está despierto?".
  `uptimeSegundos` pequeño delata un reinicio reciente.
- `/api/v1/health` sí consulta PostgreSQL y Redis (readiness). Es más lenta y
  puede fallar por dependencias aunque el proceso esté vivo.

### Mitigación: keep-alive externo

`.github/workflows/keep-alive.yml` hace ping a la liveness **cada 10 minutos**
(cron `*/10 * * * *`, más `workflow_dispatch`), con 3 intentos de `--max-time 90`
y fallo del job si no hay `200`. Con 10 min < 15 min de suspensión, la instancia
no llega a dormirse. Endpoint configurable con la variable de repositorio
`API_LIVENESS_URL`.

Requisitos y límites:

- Los `schedule` de GitHub **solo se ejecutan desde la rama por defecto**
  (`main`). Mientras el workflow viva en `feature/*`, no corre.
- GitHub desactiva los crons tras **60 días sin actividad** en el repositorio.
- Las 750 h/mes del plan gratuito alcanzan para **un** servicio despierto
  24/7 (~730 h). No se puede mantener despierto un segundo servicio free.
- Riesgo asumido: si GitHub Actions se retrasa (es best-effort) más de 15 min
  bajo carga, la instancia puede dormirse igualmente. El cliente está preparado
  para ese caso (§4).

### Indicador de carga en el cliente

En vez de bloquear la UI o renderizar un spinner indefinido:

- `core/services/estado-conexion.service.ts` mantiene el estado del aviso con
  signals y cuenta las peticiones lentas en vuelo.
- `core/interceptors/cold-start.interceptor.ts` mide cada petición; si supera
  `UMBRAL_DESPERTAR_MS = 3500`, activa el aviso y lo retira al terminar todas las
  peticiones lentas (`finalize`). Un `429`/`5xx` del backend no dispara el aviso.
- `shared/ui/backend-waking/backend-waking.component.ts` muestra el banner
  (`role="status"`, anunciado por lectores de pantalla) con un botón de reintento.
- Cableado en `app.config.ts` (`withInterceptors([coldStartInterceptor, ...])`),
  `app.ts` y `app.html`.

El objetivo del banner es evitar que el usuario interprete el arranque como un
fallo y recargue, no acelerar el arranque: el cold start se resuelve en el
servidor con el keep-alive.

---

## 4. Variables de entorno en Vercel

Proyecto → Settings → Environment Variables, entorno **Production**:

| Nombre | Valor | Notas |
|---|---|---|
| `API_URL` | `https://barberias-api-p3br.onrender.com/api/v1` | Sin barra final. Se inyecta en `/assets/env.js` durante el build. |

Tras crear o cambiar la variable hay que **redeployar**: el valor se materializa
en el build, no se lee en el navegador al vuelo.

Verificación posterior (navegador o shell):

```bash
curl -sS https://barberias-platform.vercel.app/assets/env.js
# Esperado: window.__env.API_URL = "https://barberias-api-p3br.onrender.com/api/v1";
```

Si `API_URL` falta, el despliegue sigue funcionando con el fallback compilado
(misma URL). No es un fallo bloqueante, pero deja la variable sin efecto y
oculta el problema en la documentación.

---

## 5. Rewrites de `vercel.json`

Existen dos archivos y **ambos** deben mantener el orden:

- `vercel.json` (raíz del repositorio)
- `frontend-barberias/vercel.json` (proyecto tal como lo despliega Vercel)

```
1. /api/:path*  → https://barberias-api-p3br.onrender.com/api/:path*   (antes del catch-all)
2. /(.*)        → /index.html                                          (fallback SPA)
```

Motivo: con solo el catch-all, `https://barberias-platform.vercel.app/api/v1/...`
devolvía **index.html (HTTP 200, ~25 KB de HTML)**. Es decir, un `200` rápido que
no era la API. Ese falso positivo es el origen de la "inconsistencia entre los
dos endpoints": el dominio de Vercel parecía responder al instante porque
respondía la SPA.

`buildCommand` de ambos archivos ejecuta
`node scripts/generate-runtime-env.mjs && <build de Angular>`.

> `vercel.json` se valida contra un esquema estricto y JSON no admite
> comentarios: **no añadir claves como `"// rewrites"`** — Vercel rechaza el
> despliegue por propiedad desconocida. El porqué del orden se documenta aquí,
> no en el archivo.

---

## 6. Matriz de verificación

| # | Comprobación | Comando | Resultado esperado |
|---|---|---|---|
| 1 | Liveness directa | `curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' https://barberias-api-p3br.onrender.com/api/v1/health/liveness` | `200` y JSON `{"status":"ok",...}` |
| 2 | Readiness (DB + Redis) | `curl -sS https://barberias-api-p3br.onrender.com/api/v1/health` | `200` con estado de dependencias |
| 3 | CORS desde el origen Vercel | `curl -si -X OPTIONS https://barberias-api-p3br.onrender.com/api/v1/auth/login -H 'Origin: https://barberias-platform.vercel.app' -H 'Access-Control-Request-Method: POST'` | `204` + `access-control-allow-origin` |
| 4 | Runtime config en Vercel | `curl -sS https://barberias-platform.vercel.app/assets/env.js` | contiene `API_URL` |
| 5 | `/api` del dominio de marca | `curl -si https://barberias-platform.vercel.app/api/v1/health/liveness` | JSON de la API, **no** `text/html` |
| 6 | Conectividad del cliente | DevTools → Network en `/auth/login` | `201`/`200` contra `barberias-api-p3br.onrender.com`, sin errores de timeout ni de CORS |

Notas de interpretación:

- La latencia absoluta depende de la **distancia entre el cliente y Ohio**. Un
  RTT alto con `time_appconnect` alto es red, no CPU del servicio. Para juzgar
  el servidor, mirar la diferencia `time_starttransfer - time_appconnect`.
- Un `200` con `Content-Type: text/html` en el paso 5 significa que el rewrite no
  está aplicado en el despliegue vigente.

---

## 7. Runbook de incidencias

**La primera carga tarda 20-50 s y luego todo va normal**

1. `uptimeSegundos` en la liveness: si es bajo, la instancia se durmió.
2. Comprobar en GitHub → Actions que `keep-alive` corre cada 10 min y en verde.
3. Si el workflow no corre: verificar que está en `main`, que el repositorio tuvo
   actividad en los últimos 60 días y que los permisos de Actions permiten
   `schedule`.

**La API responde `429`**

El throttler es por IP (120 req/min). Revisar si hay un proxy propio delante o
varias pestañas con sondeo agresivo. No se resuelve aumentando el límite sin
medir antes.

**Errores de CORS en el navegador**

El origen debe estar en la lista blanca de `backend-barberias/src/main.ts`. Los
alias de preview de Vercel cambian de host; si se necesita previsualizar contra
producción, añadir el origen exacto y redesplegar el backend.

**El dominio de Vercel responde HTML en `/api/...`**

Falta el rewrite de §5, o el deployment activo es anterior a que existiera.
Redeployar el proyecto del frontend.

**Rollback**

El cliente no depende de la variable para funcionar: si `API_URL` se rompe, basta
con borrarla y redeployar para volver al fallback compilado, que apunta al mismo
origen canónico.

---

## 8. Pendientes que requieren acceso a los paneles

Estos pasos no se pueden ejecutar desde el repositorio; requieren consola web o
credenciales de despliegue:

- [ ] Crear `API_URL` en Vercel (Production) y redeployar.
- [ ] Mergear el workflow `keep-alive` a `main` para que el cron se active.
- [ ] Confirmar en Render que `APP_ENV=production` y `healthCheckPath` siguen
      siendo `/api/v1/health/liveness`.
- [ ] Si se decide migrar a un plan pago de Render, retirar el keep-alive: deja
      de ser necesario y consume cuota de Actions.
