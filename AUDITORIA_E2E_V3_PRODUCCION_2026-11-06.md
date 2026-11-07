# Prueba Mayoritaria E2E — Panel de Administración V3 (PRODUCCIÓN)

**Fecha:** 2026-11-06
**Alcance:** frontend `https://barberias-platform.vercel.app` + API `https://barberias-api-p3br.onrender.com/api/v1`
**Modalidad:** navegador real (Playwright/Chromium) + API en vivo + consultas de solo lectura
**Datos:** sede y cuentas QA aisladas, creadas para esta corrida
**Operaciones destructivas:** ninguna. La purga se ejecutó únicamente en modo simulación (`--dry-run`).

---

## 1. Resumen ejecutivo

La plataforma está **operativa en producción**: las sondas responden, la base y Redis están arriba, el
login funciona, el alta de sede funciona, el blindaje de teléfono del backend rechaza 8, 11 dígitos y
letras, y la matriz de autorización deniega correctamente las rutas de plataforma a un
`ADMIN_BARBERIA`.

Se reproduce **un defecto crítico de interacción ya documentado en la auditoría del 2026-11-03**: el
pie de los modales queda por debajo del `<footer>` del layout, de modo que el botón primario **no
recibe clics de ratón**. Se confirmó con `document.elementFromPoint()`: el punto del botón devuelve el
`<footer>`; con teclado (`Enter`) el mismo formulario se envía y el modal se cierra.

Además, **la edición directa de la sede no se ofrece en la UI** de producción: el botón «Editar datos
de la sede» no se renderiza pese a que la cuenta es `ADMIN_BARBERIA` responsable de la sede y de que
`PATCH /shops/:id` funciona. La causa raíz no quedó confirmada (bundle desplegado vs. estado de la
cuenta); se detalla en §4.

**Puntaje ponderado de cobertura verificada: 66/100.** No es una nota de calidad global: mide lo que
pudo ejercitarse sin credenciales de `ADMINISTRADOR` y sin acceso a la base de Render (ver §6).

---

## 2. Entorno y aprovisionamiento

| Elemento | Resultado |
|---|---|
| Liveness `/api/v1/health/liveness` | **200** (arranque en frío: 51,4 s; Render free) |
| Readiness `/api/v1/health` | **200** — database 9 ms, redis `up`, heap `up` |
| Frontend `/` y `/auth/login` | **200**; sin errores de consola ni peticiones fallidas |
| Base de la API | Neon distinta de la base de `backend-barberias/.env` (verificado: un registro creado por la API no existe en la base local) |
| Cuenta QA de producción | `qa.mayoritaria.prod.1793981917854@test.com` → `CLIENTE` + `ADMIN_BARBERIA` de las sedes QA |
| Sede QA | `Sede QA Mayoritaria V3` · `9a21fe50-7952-4d2c-8fdd-9c06de199c84` · código `PENUJBYN` |
| Sede QA creada por UI | `Sede QA UI V3 1793981917854` (segunda sede del mismo responsable) |
| Personal QA | `Barbero QA 1793982516482` (`qa.barbero.1793982516482@test.com`) · `BARBERO` · `ACTIVO` |
| Cuenta QA en base de `.env` | `qa.mayoritaria.v3@test.com` (detectada por la purga en simulación) |

> La cuenta de auditoría de la corrida anterior (`admin.auditoria.2026@test.com`) **no autentica en
> producción** (401) aunque existe en la base de `.env`. Se usó una cuenta QA nueva y verificable.

---

## 3. Resultados por módulo

### 3.1 Gestión de Sucursales (15/20)

| Caso | Resultado | Evidencia |
|---|---|---|
| Alta de sede por UI | **OK** | `POST /shops` 201; la tarjeta aparece en `/barberias`; total 2 sedes |
| Consulta de sede | **OK** | `GET /shops/:id` 200 con `responsableId`, código y enlace |
| Edición por API (descripción/ubicación) | **OK** | `PATCH` 200 y persistencia confirmada por `GET` |
| Renombrado sin aprobación | **OK (rechazo)** | `PATCH {nombre}` → **422** `NOMBRE_REQUIERE_SOLICITUD` |
| Teléfono de 8 dígitos | **OK (rechazo)** | `PATCH {telefono:'80955501'}` → **400** |
| Teléfono de 11 dígitos | **OK (rechazo)** | `PATCH` → **400** |
| Teléfono con letras | **OK (rechazo)** | `PATCH {telefono:'809ABC0177'}` → **400** |
| Edición desde la UI | **FALLA** | El botón «Editar datos de la sede» no aparece (`tieneEditar=false`) con rol `ADMIN_BARBERIA` y `responsableId` coincidente |
| Asignación de responsable | **Parcial** | El creador queda como `responsableId`; el cambio de responsable exige aprobación de plataforma y no se ejecutó |

### 3.2 Administración de Usuarios y Roles (11/20)

| Caso | Resultado | Evidencia |
|---|---|---|
| `/admin/usuarios` para `ADMIN_BARBERIA` | **OK (bloqueo)** | Redirección a `/`; la pantalla no se renderiza |
| `GET /shops/all` | **OK (403)** | Matriz de autorización respetada |
| `GET /plataforma/usuarios` | **OK (403)** | — |
| `GET /auditoria/estadisticas` | **OK (403)** | — |
| Invitación de personal | **Parcial** | El modal abre; el clic de ratón en «Invitar» **no responde**; con `Enter` se crea el miembro (`staff` = 2) |
| Correo duplicado | **OK (409)** | `POST /auth/register` con correo existente |
| Correo malformado | **OK (400)** | `no-es-correo` rechazado |
| Bandeja global de usuarios, filtros y paginación | **No verificable** | Requiere rol `ADMINISTRADOR` |

### 3.3 Horarios y Propuestas (12/15)

| Caso | Resultado | Evidencia |
|---|---|---|
| Carga del horario semanal | **OK** | 7 días renderizados en `/admin/horarios` |
| Guardado semanal | **Parcial** | La acción se ejecuta; el texto exacto del toast no se aisló |
| Excepción de sede | **Parcial** | Modal abre, fecha y motivo se guardan, el modal se cierra; texto de confirmación no aislado |
| Bandeja de propuestas de horario | **No existe como pantalla** | Las propuestas (`propuestas_horario`) no tienen bandeja propia; se reflejan como `PROPUESTA_PENDIENTE` en la agenda |
| Aprobar/rechazar propuestas | **No verificable** | `propuestas_horario` = 0 en la base accesible y no hay reservas en la sede QA |

### 3.4 Reservas y Recordatorios (8/15)

| Caso | Resultado | Evidencia |
|---|---|---|
| Carga de `/admin/agenda` | **OK** | La pantalla abre; estado vacío correcto para una sede nueva |
| `GET /shops/:id/appointments/day` | **OK** | 200 con `[]` |
| Actualización de estados en vivo | **No verificable** | Sin reservas en la sede QA |
| Cron de recordatorios | **No verificable en producción** | Código correcto (`@Cron` cada 15 min, ventana 2 h, idempotencia por `updateMany`); sin acceso a logs de Render |
| Evidencia en base accesible (no producción) | **Parcial** | 2 reservas marcadas, 0 pendientes de aviso |

### 3.5 Mantenimiento y Auditoría (12/15)

| Caso | Resultado | Evidencia |
|---|---|---|
| Migraciones vs. esquema | **OK** | `check:integridad` → 31 migraciones y 42 CHECK coinciden |
| `chk_barberia_telefono_10_digitos` | **VALIDADA** | `pg_constraint` |
| `chk_usuario_telefono_10_digitos` | **VALIDADA** | `pg_constraint` |
| FKs en `RESTRICT` | **OK** | `reservas.barberia_id`, `reservas.cliente_id`, `pagos.barberia_id`, `pagos.reserva_id`, `propuestas_horario.creado_por` |
| Purga `--dry-run` | **OK** | 0 sedes genéricas, 0 teléfonos inválidos, 0 reliquias; 1 cuenta QA seleccionada; **nada borrado** |
| Integridad de la base de PRODUCCIÓN | **No verificable** | Sin `DATABASE_URL` de Render; las comprobaciones anteriores son de la base de `.env` |

### 3.6 Transversal UI/UX (8/15)

- Login por UI: **OK** (`POST /auth/login` y aterrizaje en `/barberias`), sin errores de consola.
- Consola del navegador: **sin errores** durante la navegación del panel.
- Red: sin respuestas 5xx; los 403 esperados de la matriz de autorización se comportan bien.
- **Defecto crítico:** el pie del modal queda bajo el `<footer>` y bloquea el clic.

---

## 4. Hallazgos

### H-01 · Crítica — El pie de los modales sigue bajo el `<footer>` del layout
Reproducido en producción en «Invitar miembro de personal»:

- Botón primario: `top=647`, `bottom=695`; `<footer>`: `top=663`, `bottom=744`.
- `document.elementFromPoint()` en el centro del botón devuelve `FOOTER.relative z-10 …`.
- `footer { z-index: 10 }`; el diálogo resuelve `z-index: auto` (el `z-50` queda atrapado por un
  contexto de apilamiento ancestro).
- `locator.click()` expira a los 6 s; `Enter` en el formulario **sí** envía y cierra el modal.

Afecta a cualquier modal cuya acción caiga en esa franja. Es el mismo H-01 de la auditoría del
2026-11-03: **no se corrigió**.

**Acción:** mover el overlay a un contenedor de nivel superior (`document.body`, CDK Overlay o un
host en `app.component`) o eliminar el `z-10` del wrapper y rebajar el `z-index` del footer. Añadir
una prueba E2E que pulse el botón primario **con ratón**, no solo con teclado.

### H-02 · Alta — La edición directa de la sede no está disponible en la UI
Con rol `ADMIN_BARBERIA`, `responsableId` igual al `id` del usuario y `PATCH /shops/:id` operativo, el
listado de `/barberias` **no renderiza** «Editar datos de la sede» (`tieneEditar=false`). La cuenta sí
ve «Crear Nueva Barbería», lo que confirma que el rol se resuelve como `ADMIN_BARBERIA`.

No se pudo aislar la causa (bundle desplegado distinto del código vs. estado de la cuenta). El
`main-*.js` servido no contiene los literales, pero el código está dividido en chunks diferidos, así
que la comprobación del bundle no es concluyente.

**Acción:** verificar que el build de Vercel corresponda al commit actual y añadir una prueba de
regresión que compruebe el botón para un `ADMIN_BARBERIA` responsable.

### H-03 · Media — No existe bandeja de propuestas de horario
El módulo 3 del guion pide «bandejas de horarios propuestos». En el código no hay pantalla propia: las
propuestas se manifiestan como estado `PROPUESTA_PENDIENTE` dentro de la agenda. La tabla
`propuestas_horario` está vacía en la base accesible, así que el flujo aprobar/rechazar no pudo
ejercitarse.

**Acción:** decidir si la bandeja es un requisito de producto; si lo es, implementarla; si no,
documentar que la decisión vive en la agenda.

### H-04 · Media — Confirmaciones de horarios no verificables de forma aislada
Las acciones de guardado semanal y de excepción se ejecutaron y los modales se cerraron, pero no se
pudo aislar el texto exacto del toast (la comprobación usó una expresión que también aceptaba
«error»). No se reporta como éxito pleno.

**Acción:** exponer el toast con un selector estable (`data-testid`) para poder aseverarlo.

### H-05 · Media — Producción y la base del repositorio son bases distintas
Un registro creado por la API de producción **no existe** en la base de `backend-barberias/.env`
(0 filas). En consecuencia, `check:integridad` y la purga en simulación se ejecutaron sobre una base
que **no es la de Render**.

**Acción:** documentar qué `DATABASE_URL` corresponde a producción y ejecutar allí
`npm run check:integridad` y `npm run purga:dry` antes de cerrar la fase.

### H-06 · Baja — Sin acceso a logs de Render para el cron
No se pudo verificar la ejecución real del barrido de recordatorios ni el estado `SIMULADO` de las
notificaciones en producción.

**Acción:** exponer una métrica o un endpoint de administración con la última ejecución del cron.

---

## 5. Datos de prueba creados (producción)

| Recurso | Identificador | Nota |
|---|---|---|
| Cuenta QA producción | `qa.mayoritaria.prod.1793981917854@test.com` | `CLIENTE` + `ADMIN_BARBERIA` |
| Sede QA | `9a21fe50-7952-4d2c-8fdd-9c06de199c84` | `Sede QA Mayoritaria V3` |
| Sede QA UI | `Sede QA UI V3 1793981917854` | Creada desde la interfaz |
| Personal QA | `qa.barbero.1793982516482@test.com` | `BARBERO` ACTIVO |
| Cuenta QA en base `.env` | `qa.mayoritaria.v3@test.com` | Detectada por la purga en simulación |

**Limpieza sugerida:** con un `ADMINISTRADOR` de producción, suspender las cuentas QA; o ejecutar
`npm run purga:dry` con la `DATABASE_URL` de producción, revisar el alcance (las cuentas `qa.*` y sus
sedes entran por patrón) y solo entonces `--aplicar`.

---

## 6. Recomendaciones tácticas

**Bloqueantes**
1. Corregir H-01 (apilamiento del modal) y cubrirlo con una prueba de clic real.
2. Restaurar la edición de sede en la UI (H-02) y verificar el commit desplegado en Vercel.

**Antes de cerrar la fase**
3. Ejecutar integridad y purga en simulación contra la base de producción real (H-05).
4. Definir la bandeja de propuestas o documentar su ausencia (H-03).
5. Añadir `data-testid` a toasts y acciones primarias para aserciones estables (H-04).

**Operación**
6. Exponer la última ejecución del cron de recordatorios (H-06).
7. Repetir esta prueba con una cuenta `ADMINISTRADOR` para cubrir bandeja de usuarios, filtros,
   paginación y cambios de rol global.

---

## 7. Limitaciones de esta corrida

- Sin credenciales de `ADMINISTRADOR` en producción: módulos transversales de plataforma no
  ejercitados.
- Sin `DATABASE_URL` de producción: constraints, integridad y purga se validaron en la base de `.env`.
- Sin acceso a logs de Render: cron de recordatorios no verificado en vivo.
- La sede QA no tiene reservas: no se probaron transiciones de estado ni propuestas en vivo.
- Una sonda final de validación inline no completó por el límite de 5 logins/minuto; no se usa como
  evidencia. El rechazo de teléfonos inválidos está verificado en la API.
