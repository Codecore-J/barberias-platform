# Auditoría Técnica E2E — Plataforma V3

**Fecha:** 2026-11-03
**Alcance:** backend NestJS + frontend Angular 22, entorno `APP_ENV=dev` contra base Neon `neondb`
**Modalidad:** sesión en vivo (navegador real + API + consultas de solo lectura a la base)

---

## 1. Resumen ejecutivo

La plataforma V3 está **funcionalmente completa en el eje multi-sede**: el modelo de cuenta global
(`Usuario`) + asignación por sede (`UsuarioRol`) se comporta como el diseño original, la reutilización
de correo hace upsert sin tocar la contraseña global y el estado local por sede no se propaga a otras
sedes ni a la cuenta global. Los modales de personal cumplen con el contrato de accesibilidad
(`role="dialog"`, `aria-modal`, `aria-labelledby`, trampa de tabulación, foco inicial y retorno de foco)
y el feedback de éxito viaja por el toast unificado.

Se detectaron **dos defectos de severidad alta**: (1) el pie de los modales queda por debajo del
`<footer>` del layout, de modo que los botones primarios **no son pulsables con ratón** aunque sí con
teclado; y (2) diez sedes en la base tienen el teléfono corrupto (`600NaN2222`), sin restricción de
integridad que lo impida. Ambos se detallan en §5.

Estado global: **apto para seguir iterando, no apto para cerrar la fase sin corregir los hallazgos H-01
y H-02.**

---

## 2. Entorno y aprovisionamiento

| Elemento | Resultado |
|---|---|
| Base de datos | Neon `ep-crimson-mud-…aws.neon.tech` / `neondb` (63 usuarios, 26 sedes preexistentes) |
| Backend | Compilado con `nest build` y servido con `node --env-file=.env dist/main.js` en `:3000` |
| Frontend | `ng serve` en `:4200` |
| Docker / Redis local | No disponible (se usó el Redis remoto de `REDIS_URL`) |
| Usuario auditor | `admin.auditoria.2026@test.com` — rol `ADMINISTRADOR` (ámbito GLOBAL) |
| Contraseña | En `backend-barberias/scratch/admin-auditoria.pass` (directorio ignorado por git) |
| Sedes de prueba | `Sede QA Auditoria 2026` (`4135c166-77ed-4895-bcbf-e92b378dc160`), `Sede QA Secundaria 2026` (`1976c33a-b871-46cb-a312-75c51cb4dc7b`) |

**Nota operativa:** el entorno de la máquina tiene `PORT=0` exportado, y `node --env-file` no
sobreescribe variables ya presentes. Consecuencia: `ng serve` y el backend arrancan en puertos
aleatorios. Fue necesario `env -u PORT …` para fijar `:4200` y `:3000`. Conviene documentarlo porque
produce un fallo desconcertante ("arranca pero no responde en el puerto esperado").

Aprovisionamiento del administrador: se usó el CLI existente `src/cli/create-admin.ts`, que valida
`APP_ENV`, exige contraseña de 12+ caracteres y teléfono único, y no imprime la clave. Sin hallazgos.

---

## 3. Matriz: diseño original vs. implementación verificada

| Funcionalidad | Estado verificado | Evidencia |
|---|---|---|
| Separación cuenta global / asignación por sede | **Cumple** | Un `Usuario` con dos `UsuarioRol` independientes (una por sede), cada uno con su `estado` y `rol` |
| Estado local por sede (`ACTIVO`/`INACTIVO`) | **Cumple** | Desactivar en Secundaria dejó QA en `ACTIVO` y `estadoCuenta` global en `ACTIVO` |
| Invitación de personal nuevo | **Cumple** | `POST /shops/:id/staff` → 201, toast "Miembro creado", tarjeta renderizada sin recargar |
| Reutilización de correo existente (upsert) | **Cumple** | Mismo `id` (`d549b94d…`), un solo registro, hash de contraseña idéntico antes/después |
| Búsqueda/match insensible a mayúsculas | **Cumple** | `Barbero.QA1.Auditoria@TEST.com` resolvió al usuario existente y normalizó el correo a minúsculas |
| Control de colisiones concurrentes | **Cumple en código** | `MAX_INTENTOS_INVITAR_PERSONAL = 3`, backoff exponencial `25ms · 2^(n-1)`, colisión de teléfono **no** se reintenta |
| Aislamiento de edición (campos globales read-only) | **Cumple** | Nombre y teléfono `readonly` con ayuda "pertenece a la cuenta global…"; el backend rechaza el intento de escritura |
| Rechazo de escrituras indebidas | **Cumple** | `PATCH` con `nombreCompleto` → 400 `property nombreCompleto should not exist` |
| Accesibilidad de modales | **Cumple** | `role=dialog`, `aria-modal=true`, `aria-labelledby` resuelto, 5/5 `label[for]` apuntando a `id` existente, foco inicial en el primer campo |
| Validación accesible inline | **Cumple** | `aria-invalid="true"` + `aria-describedby` al `id` real del mensaje |
| `aria-label` en acciones de icono de personal | **Cumple** | "Editar datos de …", "Desactivar a … en esta sede" |
| Sistema de notificaciones (Toast) | **Cumple** | Contenedor con `role="status"` + `aria-live="polite"`; éxito y error verificados |
| Protección de seeders | **Cumple parcialmente** | `seed-bandejas` y `seed-demo-users` abortan fuera de `dev`; `seed.ts` no tiene guarda (es idempotente) |
| Feedback unificado (sin banners inline) | **No cumple** | Ver H-04 |
| Modales operables con ratón | **No cumple** | Ver H-01 |

---

## 4. Resultados E2E en navegador

| # | Caso | Resultado |
|---|---|---|
| 1 | Login del administrador en la UI | **OK** — redirección a `/barberias`, 28 sedes visibles |
| 2 | Selección de sede y entrada al panel | **OK** — `/admin/agenda` con la sede activa en cabecera |
| 3 | Invitación de miembro nuevo | **Parcial** — el flujo completa, pero el botón no responde al clic (H-01); se envió con `Enter` |
| 4 | Toast de confirmación de alta | **OK** — "Miembro creado · …ya forma parte del personal de la sede" |
| 5 | Reutilización de correo en segunda sede | **OK** — toast "Miembro creado", contraseña intacta, asignaciones separadas |
| 6 | Edición de rol en sede | **OK** — toast "Personal actualizado", tarjeta pasa a `ADMIN BARBERIA` |
| 7 | Campos globales en solo lectura | **OK** — nombre y teléfono `readonly` con texto explicativo |
| 8 | Desactivación local con diálogo de confirmación | **OK** — toast "Personal desactivado", `INACTIVO` solo en Secundaria |
| 9 | Validación de formulario (correo inválido) | **OK** — error asociado por `aria-describedby`, `aria-invalid=true` |
| 10 | Error del backend (teléfono duplicado) | **Parcial** — modal permanece abierto y conserva datos, pero hay doble aviso (H-04) |
| 11 | Cierre con `Escape` y con clic en backdrop | **OK** |
| 12 | Navegación entre sedes (`Cambiar`) | **OK** — el contexto se refresca sin recargar la app |

---

## 5. Hallazgos

### H-01 · Alta — El pie del modal queda tapado por el `<footer>` del layout
Los botones primarios de los modales (`.modal-shell-panel` → `z-50` dentro de un overlay `fixed`)
quedan por debajo del `<footer class="relative z-10">` del layout. El wrapper del componente
(`relative z-10`) crea un contexto de apilamiento que **atrapa el `z-50`**, y el footer se pinta encima.

- Reproducido a 431×939 y a 1440×900: `document.elementFromPoint()` sobre el botón devuelve el `<p>`
  de copyright del footer, y el clic no dispara `ngSubmit` (sin petición en red).
- Con teclado (`Enter` en un campo) sí se envía, lo que confirma que el handler es correcto y el
  problema es exclusivamente de orden de pintado.
- Afecta a cualquier modal cuya acción quede en la franja inferior de la ventana; los modales cortos
  (edición) se libran porque su pie cae más arriba.
- **Recomendación:** mover el overlay a un contenedor de nivel superior (`<body>` vía
  `document.body.appendChild`, CDK `Overlay`, o un `div` en `app.component`) o, como mínimo, eliminar
  el `z-10` del wrapper y dar al footer un `z-index` inferior al del overlay.

### H-02 · Alta — Datos de teléfono corruptos y sin restricción en base
10 de 26 sedes preexistentes tienen `telefono` con el patrón `600NaN2222` / `601NaN2222`.
El `CreateBarberiaDto` exige `^\d{10}$`, así que el dato es anterior a la validación o lo generó un
script. No existe `CHECK` en `barberias.telefono`, por lo que el dato inválido persiste y se muestra tal
cual en la tarjeta de sede.
- **Recomendación:** migración con `CHECK (telefono ~ '^[0-9]{10}$')` + script de reparación de las 10
  filas (o marcarlas para revisión manual).

### H-03 · Media — Doble anuncio de error: banner inline + toast
Ante un 409 del backend, el modal muestra `<p role="alert">` con el mensaje **y** simultáneamente un
toast (`aria-live="polite"`). Un lector de pantalla anuncia el mismo texto dos veces y el usuario ve la
información duplicada. Es exactamente la deuda que la unificación de feedback buscaba eliminar.
- **Recomendación:** conservar el banner inline para errores ligados al formulario (persiste y está
  junto a los campos) y **no** emitir toast en ese caso; reservar el toast para errores de red/servidor
  sin campo asociado. O al revés, pero solo uno.

### H-04 · Media — Confirmación de desactivación sin descripción accesible
El diálogo de confirmación tiene `role="dialog"`, `aria-modal` y `aria-labelledby`, pero **no**
`aria-describedby`, aunque existe el párrafo que explica las consecuencias ("…dejará de operar… Su
cuenta y sus asignaciones en otras sedes no cambiarán"), que además no tiene `id`. El foco inicial cae
en el botón de cierre "X" en lugar de la acción segura.
- **Recomendación:** dar `id` al párrafo, referenciarlo con `aria-describedby` y enfocar "Cancelar".

### H-05 · Media — Botones de icono de la cabecera sin nombre accesible
Los botones de notificaciones (`pi-bell`) y del menú móvil (`pi-bars`) del layout no tienen texto,
`aria-label` ni `title`. Un lector de pantalla solo anuncia "botón".

### H-06 · Baja — `seed.ts` sin guarda de entorno
`seed-bandejas.ts` y `seed-demo-users.ts` abortan correctamente fuera de `APP_ENV=dev` (verificado
ejecutándolos con `production` y `staging`). El `seed.ts` principal no tiene esa guarda; es idempotente
(`upsert` / `skipDuplicates`), así que el riesgo es bajo, pero conviene homogeneizar.
Además, los seeds abortados terminan con un *stack trace* de excepción no capturada en lugar de un
mensaje limpio con `exit 1`.

### H-07 · Baja — Invitar puede degradar un rol existente sin avisar
Reinvitar a un usuario que ya era `ADMIN_BARBERIA` en la sede, con `rolNombre: "BARBERO"`, actualiza la
asignación y lo degrada silenciosamente (verificado: `ADMIN_BARBERIA` → `BARBERO`). Es coherente con el
upsert, pero es un cambio de privilegios que no se advierte en la UI.

### Observación — Feedback residual de la fase de a11y
`errorPersonal` sigue existiendo como banner inline en el componente de personal. No es código muerto
(se usa), pero convive con el toast (H-03).

---

## 6. Datos de prueba creados

| Recurso | Identificador | Estado |
|---|---|---|
| Usuario auditor | `admin.auditoria.2026@test.com` / `3869a04e-9556-4be7-8921-a739c299b429` | Global `ADMINISTRADOR`, `ACTIVO` |
| Sede QA | `Sede QA Auditoria 2026` / `4135c166-77ed-4895-bcbf-e92b378dc160` | Con 1 miembro |
| Sede secundaria | `Sede QA Secundaria 2026` / `1976c33a-b871-46cb-a312-75c51cb4dc7b` | Con 1 miembro |
| Miembro de prueba | `barbero.qa1.auditoria@test.com` / `d549b94d-83b2-4808-ab5e-b0f0f3e4b1c2` | QA `BARBERO/ACTIVO`, Secundaria `BARBERO/INACTIVO` |

El teléfono duplicado (`8095550101`) se reutilizó a propósito para provocar el 409 del caso 10.

---

## 7. Recomendaciones y próximos pasos

**Bloqueantes antes de cerrar la fase**
1. Corregir H-01 (apilamiento del modal) y añadir una prueba E2E que pulse el botón primario con ratón,
   no solo con teclado.
2. Aplicar migración de integridad para `barberias.telefono` y reparar las 10 filas de H-02.

**Iteración siguiente**
3. Decidir la política de feedback (H-03) y dejarla en un solo canal por caso de uso.
4. Cerrar los huecos de accesibilidad H-04 y H-05; son de bajo coste y alto impacto.
5. Homogeneizar la guarda de entorno de los seeds (H-06) y confirmar H-07 con un aviso en la UI.

**Deuda de verificación**
6. Ejercitar de verdad el backoff de colisiones: hoy solo está cubierto por código y por el spec
   `no reintenta una colisión P2002 del teléfono`. Haría falta una prueba que fuerce dos invitaciones
   concurrentes con el mismo correo y verifique que la segunda reutiliza la cuenta.
7. Automatizar como suite E2E los doce casos de §4 —hoy se ejecutaron a mano— para que dejen de
   depender de una sesión manual.
8. Documentar el `PORT=0` del entorno local en el README para evitar arranques en puertos aleatorios.
