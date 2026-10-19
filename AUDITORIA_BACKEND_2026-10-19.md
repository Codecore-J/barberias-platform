# AUDITORÍA DE ESTADO DEL BACKEND vs. BACKLOG V1

**Proyecto:** `Codecore-J/barberias-platform`
**Alcance:** `backend-barberias/` (NestJS 11 + Prisma + PostgreSQL), con las comprobaciones de frontend estrictamente necesarias para E1-09 y los contratos de API.
**Fuente de verdad:** [`docs/BACKLOG_BARBERIAS_V1.md`](docs/BACKLOG_BARBERIAS_V1.md), secciones 1–8 y tareas E0-01 a E4-03.
**Fecha de la auditoría:** 19 de octubre de 2026.
**Commit auditado:** `07e8b2e` (`main`, merge del PR #77).
**Auditor:** Revisión técnica independiente asistida, a partir del código y de la evidencia del repositorio.

> **Relación con la auditoría anterior.** `AUDITORIA_BACKEND_2025-10-19.md` queda sustituido por este documento. Aquel informe daba un 64 % de avance y trataba E1-07, E0-07 y E4-02 como cerradas sin verificar el código; esta revisión las mide contra los criterios reales del backlog.
>
> **Actualización de cierre (2026-10-19, rama `fix/e0-e1-cimientos-finales`).** Quedan cerradas **E0-07**, **E1-07** y **E1-10** —y con ellas **E3-01/A-15**, cuya única brecha era la columna de auditoría— con evidencia nueva verificada en esta máquina y en la base `dev`:
>
> - Migración `20261019120000_e0e1_auditoria_barberia_id` aplicada con `prisma migrate deploy` (columna `auditoria.barberia_id`, índice `(barberia_id, creado_at)` y FK `ON DELETE SET NULL`); el backfill rellenó 49 de las 521 filas de auditoría con sede en el contexto y dejó en NULL las que apuntan a sedes ya inexistentes, porque la FK no admite esas claves.
> - `prisma db seed` ejecutado **dos veces**: 4 roles sin duplicados (`ADMINISTRADOR`, `ADMIN_BARBERIA`, `BARBERO`, `CLIENTE`) y 17/9/7/5 permisos asignados respectivamente.
> - `npm run admin:create` contra la base real: `testadmin@codecore.com` creado como `ACTIVO` con la fila GLOBAL de `usuario_roles` (`barberia_id` NULL).
> - `helmet@8` y `express@5` en `package.json`; `main.ts` registra `helmet()`, `express.json({ limit: '100kb' })` y `express.urlencoded({ limit: '100kb', extended: true })`. Verificado contra el servidor levantado desde `dist/main`: cabeceras helmet presentes, payload de ~150 kB y de 102 534 B → **413**; 90 034 B → parseado (400 de DTO); login pequeño → 401.
>
> Los conteos de §1.1, §6, §7, §8 y §9 se actualizaron con este cierre. A-01, A-02 y A-04 quedan resueltos; **A-03 (E4-02 carril B) sigue siendo la única brecha alta abierta**.

---

## 1. RESUMEN EJECUTIVO

### 1.1 Estado general

El backend tiene una base de seguridad y de dominio **sólida y muy por encima de la media** de un proyecto en este punto:

- El `RolesGuard` **falla cerrado** y la suite de rutas lo demuestra (`test/route-security.spec.ts`, **85 rutas** declaradas).
- El aislamiento multi-tenant está resuelto en las lecturas críticas: auditoría (H18), reservas (H14), agenda y bloqueos (H19/H20), catálogo y disponibilidad (E1-06), personal (E1-03) y configuración (E3-11).
- La máquina de estados de reservas, los snapshots históricos, la concurrencia SERIALIZABLE con `FOR UPDATE`, el filtro de Prisma (P2002→409, P2025→404, P2003→400, 40001→409) y la auditoría transaccional están implementados y probados.
- La suite unitaria pasa **637/637** en 53 archivos, también con `TZ=UTC` y `TZ=America/Santo_Domingo`; el frontend pasa **93/93**; `lint` y `build` terminan con **EXIT=0**.

Sin embargo, **no está al 100 %**. La auditoría encuentra **31 tareas completas, 9 parciales, 1 pendiente y 1 no verificable** de las 42 tareas definidas (74 % de cumplimiento estricto). La única brecha alta que queda abierta es E4-02 (carril B de D22).

### 1.2 Los tres hallazgos que más importaban (2 de 3 cerrados)

| # | Hallazgo | Tarea | Severidad | Por qué importa |
|---|---|---|---|---|
| ~~**A-01**~~ | **RESUELTO (2026-10-19).** El límite de 2 barberías por responsable sí existe ahora: `create` cuenta las sedes `ACTIVO` dentro de la transacción SERIALIZABLE, devuelve 422 `LIMITE_BARBERIAS` con `MAX_BARBERIAS_POR_RESPONSABLE = 2` y audita `BARBERIA_CREADA` en la columna `barberia_id`. | E1-07 | ~~Alta~~ → cerrado | Criterio «tercera barbería → 422» cubierto por unidad (5 pruebas nuevas) en `barberia.service.spec.ts`.
| ~~**A-02**~~ | **RESUELTO (2026-10-19).** El seed crea `ADMIN_BARBERIA` con sus 9 permisos y `npm run admin:create` existe y se ejecutó contra `dev`. `BarberiaService.create` ya no tiene `if (rolAdmin)` silencioso: sin el rol la operación falla y el responsable recibe el rol en la sede nueva. | E0-07 | ~~Alta~~ → cerrado | Seed corrido dos veces sin duplicados y admin verificado en base real.
| **A-03** | **E4-02 solo implementó el carril A (alternativas y `GET .../huecos`).** No existe el carril B: no hay cálculo de elegibles de D22, ni job idempotente por hueco, ni notificaciones al liberarse una reserva o un bloqueo. | E4-02 | **Alta** | Los dos primeros criterios de aceptación de E4-02 (oportunidad proactiva, ≤25, sin duplicados, sin el que canceló) no se cumplen. El test llamado `e4-02-oportunidades` solo prueba alternativas. |

### 1.3 Tres recomendaciones inmediatas

1. ~~**Cerrar E1-07 antes de cualquier demo pública**~~ (hecho el 2026-10-19): contar barberías del responsable dentro de la misma transacción SERIALIZABLE, constante `MAX_BARBERIAS_POR_RESPONSABLE = 2`, 422 `LIMITE_BARBERIAS`, throttling propio y auditoría `BARBERIA_CREADA`.
2. ~~**Reparar el arranque de una base limpia**~~ (hecho el 2026-10-19): añadir `ADMIN_BARBERIA` al seed idempotente y crear el script `admin:create` que lee `ADMIN_EMAIL`/`ADMIN_PASSWORD`, exige 12 caracteres y `CONFIRM_CREATE_ADMIN=yes` en producción. Probar el seed dos veces y el alta desde cero.
3. **Decidir E4-02 explícitamente:** implementar el carril B de D22 o bajarlo de alcance con el dueño y corregir el backlog y la matriz. Hoy el documento dice que está `OK-PROBADO`, y el código solo prueba la mitad.

---

## 2. MÉTODO, EVIDENCIA Y LÍMITES

### 2.1 Qué se hizo

1. Se leyeron las 42 tareas del backlog y sus criterios de aceptación.
2. Se inspeccionaron los controladores, servicios, DTO, guards, filtros, migraciones, esquema Prisma y pruebas.
3. Se contrastó cada tarea con `git log`, los informes de cierre y `AUDITORIA_HALLAZGOS.md`.
4. Se ejecutaron las comprobaciones del proyecto:

| Comprobación | Comando | Resultado literal | Estado |
|---|---|---|---|
| Lint backend | `npm run lint` | `Found 103 warnings and 0 errors.` | **EXIT=0** |
| Build backend | `npm run build` | `nest build` sin errores | **EXIT=0** |
| Unitarias backend | `npm run test` | `Test Files 53 passed (53)` · `Tests 637 passed (637)` | **EXIT=0** |
| Unitarias con `TZ=UTC` | `TZ=UTC vitest run` | `Test Files 53 passed (53)` · `Tests 637 passed (637)` | **EXIT=0** |
| Unitarias con `TZ=America/Santo_Domingo` | `TZ=America/Santo_Domingo vitest run` | `Test Files 53 passed (53)` · `Tests 637 passed (637)` | **EXIT=0** |
| Unitarias frontend | `npm run test -- --watch=false` | `Test Files 11 passed (11)` · `Tests 93 passed (93)` | **EXIT=0** |
| Guardia anti-datos reales | `APP_ENV=staging npm run test:e2e` | `TEST ABORTED: APP_ENV is set to 'staging'...` | **EXIT=1 esperado** |
| Migración en `dev` | `npx prisma migrate deploy` | `All migrations have been successfully applied.` (15 migraciones) | **EXIT=0** |
| Seed idempotente en `dev` | `npx prisma db seed` ×2 | `✅ 4 roles insertados/actualizados.` cada corrida | **EXIT=0** |
| Primer administrador en `dev` | `npm run admin:create` | `Administrador global listo: testadmin@codecore.com (...)` | **EXIT=0** |
| Endurecimiento E1-10 (servidor real) | `curl` contra `dist/main` | helmet en cabeceras · 150 kB y 102 534 B → `413` · 90 034 B → parseado | **verificado** |

> Los números de unitarias corresponden a la rama `fix/e0-e1-cimientos-finales`: la auditoría original midió 627/627 en 51 archivos; las 10 pruebas nuevas (5 de E1-07, 2 del seed, 3 de E1-10) llevan la suite a 637/637 en 53 archivos.

### 2.2 Lo que NO se pudo verificar

- **E2E contra base real:** **siguen sin ejecutarse en esta máquina**. La base `dev` ya está accesible y migrada, pero la suite E2E crea y borra datos sobre esa base compartida y no es el alcance de este cierre; el CI sí la ejecuta con Postgres y Redis de servicio (`.github/workflows/ci.yml`, pasos `Apply Prisma Migrations`, `Run Unit/Integration Tests`, `Run E2E Tests`). En su lugar se verificó el comportamiento del servidor real (`dist/main`) con `curl` para las cabeceras y el límite de cuerpo.
- **Rotación de credenciales (E0-01):** el repositorio ya no contiene scripts `.cjs` ni cadenas `postgresql://`; la comprobación de disco e historial se hizo por nombres y patrones, sin imprimir valores. La rotación efectiva en Neon/Render es una acción del dueño.
- **Cuentas de prueba (E0-03):** depende del SQL que ejecute el dueño en Neon.
- **Protección de `main` (E0-05):** es configuración de GitHub, no verificable desde el repositorio.
- **Rol de base de mínimos privilegios (E1-08):** es una acción en Neon.

### 2.3 Cómo se puntúa

- **Completa:** el código implementa todos los puntos y los criterios de aceptación tienen evidencia (test o comprobación reproducible).
- **Parcial:** hay una parte sustantiva implementada y una parte ausente, divergente o no verificable.
- **Pendiente:** no se encontró implementación.
- **No verificable:** la prueba exige una acción externa o una base que no está disponible en este entorno.

---

## 3. AUDITORÍA POR ÁREA Y TAREA

### 3.1 Épica E0 — Cimientos y contención

| Tarea | Estado | Evidencia principal | Observación |
|---|---|---|---|
| E0-01 · Rotar credenciales y limpiar secretos | **Completa (repo)** | `.env.example` con 11 variables; `.gitignore:8-10` excluye `.env` y `.env.*` salvo `.env.example`; no hay `.cjs` de scratch en la raíz (solo `scripts/check-integridad.cjs`, legítimo); `git grep -l "neondb_owner:"` solo aparece en el texto del backlog, sin cadena de conexión | La rotación en Neon/Render queda como verificación del dueño |
| E0-02 · Entornos separados | **Completa** | `src/main.ts` exige `APP_ENV` y aborta fuera de `dev/staging/production`; `test/setup.e2e.ts` aborta fuera de `dev`; `docs/ENTORNOS.md` existe | Guardia verificada con EXIT=1 y mensaje literal |
| E0-03 · Cuentas de prueba con privilegios | **Parcial (externa)** | `auth.service` rechaza `SUSPENDIDO`; `test/estado-cuenta-guard.spec.ts` y `test/e4-03-suspension-cuenta.e2e-spec.ts` existen | Falta la evidencia de la desactivación en staging (conteo antes/después) |
| E0-04 · Migración base y CI | **Completa** | 15 migraciones (todas aplicadas en `dev`); `prisma migrate deploy` en `render.yaml`; CI con `migrate deploy`, `check:integridad`, tests y E2E; `gitleaks` | `migrate diff` no modela `CHECK`; lo cubre `check-integridad.cjs` |
| E0-05 · Protección de `main` y despliegue condicionado | **Parcial / Pendiente** | `render.yaml` conserva `autoDeploy: true`; no existe `docs/DESPLIEGUE.md` | La protección de rama no se puede verificar desde el repo; el despliegue automático sigue sin esperar checks |
| E0-06 · Triage de `wip/sin-revisar` | **Parcial** | `AUDITORIA_HALLAZGOS.md` contiene H22 a H30 y el triage histórico | No existe `docs/TRIAGE_WIP.md` |
| E0-07 · Seed idempotente y primer ADMINISTRADOR | **[X] Completa** | `prisma/seed.ts` hace `upsert` de los 4 roles (verificado con `prisma db seed` ×2 en `dev` sin duplicados); `package.json` tiene `admin:create`; `src/cli/create-admin.ts` exige `ADMIN_EMAIL`/`ADMIN_PASSWORD` (12+), `ADMIN_PHONE` y `CONFIRM_CREATE_ADMIN=yes` en producción; guardia `test/seed-roles.spec.ts` | Verificado contra la base real: `testadmin@codecore.com` queda `ACTIVO` con la fila GLOBAL de `usuario_roles`. Ver A-02 |
| E0-08 · H22 a H30 documentados | **Completa (documentación)** | Las nueve fichas existen en `AUDITORIA_HALLAZGOS.md` | Varias siguen abiertas, como la tarea pedía |

**Balance E0:** 5 completas, 3 parciales. CI/migraciones y operación (seed, `admin:create`) están cerrados; siguen abiertas la protección de `main` (E0-05, externa) y el triage (E0-06).

#### A-02 · E0-07: el seed no crea el rol que la propia alta de barbería necesita — **RESUELTO 2026-10-19**

**Qué se hizo:** el seed crea permisos, tres roles (CLIENTE, BARBERO, ADMINISTRADOR) y asigna permisos. No crea `ADMIN_BARBERIA`.

**Por qué es un problema real:** `BarberiaService.create` busca `rol.findUnique({ nombre: 'ADMIN_BARBERIA' })` y ejecuta el bloque de asignación solo `if (rolAdmin)`. Con el seed actual, en una base limpia ese `findUnique` devuelve `null`, **la barbería se crea igual y el responsable no recibe rol**. El `upsert` de `usuario_roles` nunca ocurre. El usuario queda con una sede que no puede administrar y el error no se manifiesta.

**Causa:** omisión; el seed se escribió antes de que existiera el flujo de creación de sedes con rol por tenant y nunca se actualizó. La tarea E0-07 no tiene rama ni informe de cierre.

**Aceptación del backlog:** «BD vacía + `migrate deploy` + seed deja 4 roles» → **no cumple**. «El script de admin falla de forma segura sin variables» → **no existe el script**.

**Acción:** añadir `ADMIN_BARBERIA` al array de roles; crear `scripts/admin-create.ts` y el script npm; probar seed dos veces y alta desde base vacía; añadir un test que falle si faltan los cuatro roles.

**Cierre (2026-10-19):** todo lo anterior hecho y verificado en `dev`:

- `prisma/seed.ts` declara los 4 roles y asigna 9 permisos a `ADMIN_BARBERIA`; `prisma db seed` corrido **dos veces** → `✅ 4 roles insertados/actualizados.` cada vez, sin duplicados.
- `npm run admin:create` → `src/cli/create-admin.ts` (uso de `tsx`, no `ts-node`, porque el runner del proyecto es `tsx`): exige `APP_ENV`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥12), `ADMIN_PHONE` y `CONFIRM_CREATE_ADMIN=yes` en producción; **no** escribe `estado_cuenta` (guardia D48 intacta). Ejecutado contra `dev`: `testadmin@codecore.com` creado `ACTIVO` con la fila GLOBAL de `usuario_roles`.
- `BarberiaService.create` ya no tiene el `if (rolAdmin)` silencioso: sin el rol la operación falla con 500 explícito y sin crear la sede; con él, el responsable recibe `ADMIN_BARBERIA` en la sede nueva.
- Guardias: `test/seed-roles.spec.ts` (2 pruebas) y las 5 de `create · E0-07 y E1-07` en `barberia.service.spec.ts`. Evidencia literal en `reporte-e0-07-e1-07.md`.

---

### 3.2 Épica E1 — Seguridad

| Tarea | Estado | Evidencia principal | Observación |
|---|---|---|---|
| E1-01 · RolesGuard fail-closed | **Completa** | `roles.guard.ts`: sin `@Public`, `@Autenticado` ni `@Roles` lanza `ForbiddenException`; `route-security.spec.ts` recorre los controladores | 85 rutas declaradas; ninguna sin política |
| E1-02 · Fuga cross-tenant en auditoría | **Completa** | `auditoria.service.consultarAuditorias` exige sede al no global; `test/h18-auditoria-cross-tenant.e2e-spec.ts` | El `ADMINISTRADOR` conserva la vista global |
| E1-03 · Lecturas abiertas `personal` y `bloqueos` | **Completa** | `@Roles` + pertenencia en `findPersonal`; `validateAccess` en bloqueos; `test/h19-h20-lecturas-abiertas.e2e-spec.ts` | El cliente recibe 403; no ve motivos |
| E1-04 · Limpieza de roles y `SUPER_ADMIN` | **Completa** | `SUPER_ADMIN` solo en comentarios y tests; `alcanceCumple` exige ámbito GLOBAL para el comodín nulo; `validarAsignacionRol` | `esAdministradorGlobal` es el único helper |
| E1-05 · Matriz de permisos en controladores | **Completa** | `test/permisos-matriz.spec.ts` (**85 rutas × 4 = 340 decisiones**); `docs/MATRIZ_RUTAS.md` todavía dice 80/320 (A-16) | No quedan `TODO(E1-05)` |
| E1-06 · Tests cross-tenant de administradores | **Completa (código y tests)** | `current-barberia.decorator.ts` solo acepta UUID; servicios y combos exigen sede; `test/e1-06-cross-tenant-admin.e2e-spec.ts` y `e1-06-sede-del-tenant.e2e-spec.ts` | E2E no ejecutados localmente; sí en CI |
| E1-07 · Crear barbería con límite y respuestas seguras | **[X] Completa** | `codigoAcceso`/`enlaceUnico` privados; `create` cuenta las sedes `ACTIVO` en la transacción SERIALIZABLE y devuelve 422 `LIMITE_BARBERIAS` (`MAX_BARBERIAS_POR_RESPONSABLE = 2`); audita `BARBERIA_CREADA` con `barberia_id` en columna; 5 pruebas nuevas en `barberia.service.spec.ts` | Desviación conocida: **el límite de 3 altas/hora no se implementa** (riesgo de romper los E2E que crean sedes); decisión registrada en el informe de cierre. Ver A-01 |
| E1-08 · Rol de base de mínimos privilegios | **No verificable** | No hay evidencia en el repositorio de `barberias_app` | Acción del dueño en Neon/Render |
| E1-09 · Guards de rutas del frontend | **Completa** | `role.guard.ts` sin alias `'ADMIN'`; rutas de plataforma separadas; `role.guard.spec.ts` (7 casos); 93 tests frontend verdes | `ADMIN_BARBERIA` no entra a `/plataforma/*` |
| E1-10 · Validación global y registro seguro | **[X] Completa** | `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`; `RegisterDto` no acepta roles; `@Throttle` en auth; **`helmet@8` + `express.json/urlencoded({ limit: '100kb' })` en `main.ts`** | Verificado con `curl` contra el servidor real: cabeceras helmet presentes y **413** con payload >100 kB; guardia `test/e1-10-hardening.spec.ts`. Ver A-04 |

**Balance E1:** 8 completas, 1 parcial, 1 no verificable. El endurecimiento HTTP (E1-10) y el límite de sedes (E1-07) quedaron cerrados; siguen abiertas solo la protección externa de E1-08.

#### A-01 · E1-07: el límite de 2 barberías no existe en el código — **RESUELTO 2026-10-19**

**Evidencia (estado al auditar, antes del cierre de 2026-10-19):**

- `barberia.service.ts` `create()` solo verificaba que el usuario existiera, creaba la barbería, asignaba el rol y creaba la configuración: sin `count`, sin constante y sin error 422.
- `grep -rn "LIMITE_BARBERIAS\|MAX_BARBERIAS_POR_RESPONSABLE"` en `backend-barberias/src`, `test` y `frontend-barberias/src` → **0 coincidencias**.
- `barberia.controller.ts` conserva `// TODO(E1-07): aplicar el límite de 2 barberías por usuario en el servicio.`
- No hay `@Throttle` en `POST /barberias` ni auditoría `BARBERIA_CREADA` (`grep` → 0).

**Por qué se hizo así:** E1-07 se ejecutó parcialmente en el PR #30 (`fix/e1-07-veCodigo-findallbyresponsable`), que resolvió la fuga de `codigoAcceso` en `GET /barberias` y `GET /barberias/:id`, pero no el límite. El `TODO` quedó como deuda y ninguna tarea posterior lo retomó.

**Impacto:** Alto. D04 es una regla de negocio y un control anti-abuso; sin ella, un usuario puede crear sedes ilimitadas y el `ADMINISTRADOR` pierde la capacidad de contener el crecimiento. También falta el límite de peticiones que el backlog pide (3/hora).

**Recomendación:** contar dentro de la transacción SERIALIZABLE antes del `create`; devolver 422 `LIMITE_BARBERIAS`; añadir `@Throttle` propio; auditar `BARBERIA_CREADA`; test de la tercera barbería y de dos usuarios distintos.

**Cierre (2026-10-19):** conteo `barberia.count({ where: { responsableId, estado: 'ACTIVO' } })` dentro de la transacción SERIALIZABLE con `MAX_BARBERIAS_POR_RESPONSABLE = 2`; con 2 o más → 422 `LIMITE_BARBERIAS`; auditoría `BARBERIA_CREADA` en la misma transacción con `barberia_id` en columna; `TODO(E1-07)` eliminado del controlador. 5 pruebas: tercera sede → 422, segunda sede → pasa, inyección de rol, rol ausente → 500 y admin global exento. **No se implementó `@Throttle` 3/hora** (queda documentado como desviación): en los E2E se crean varias sedes por IP en la misma hora y el límite los rompería.

#### A-04 · E1-10: falta el endurecimiento HTTP que pide el punto 4 — **RESUELTO 2026-10-19**

El `ValidationPipe` global está correcto y el registro no permite inyectar roles. Pero el backlog pide además «límite de tamaño del cuerpo (100 kb), `helmet`». En `main.ts` no hay `helmet` ni configuración de body parser; `helmet` no está en `package.json`. El filtro de Prisma y el contrato D40 sí están. Impacto Medio: no rompe la lógica, pero deja cabeceras de seguridad y una defensa anti-payload fuera.

**Cierre (2026-10-19):** `helmet@8.3` y `express@5.2` añadidos a `package.json`; `main.ts` registra `app.use(helmet())`, `app.use(express.json({ limit: '100kb' }))` y `app.use(express.urlencoded({ limit: '100kb', extended: true }))` antes del body parser por defecto de Nest. Verificado con `curl` contra el servidor levantado desde `dist/main`:

- cabeceras presentes: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Cross-Origin-*`;
- 150 000 B y 102 534 B → **`413 request entity too large`** (JSON y urlencoded);
- 90 034 B → parseado y validado (400 de DTO); credenciales pequeñas → 401, es decir el flujo normal sigue intacto.

Guardia unitaria: `test/e1-10-hardening.spec.ts` (3 pruebas).

---

### 3.3 Épica E2 — Integridad de datos y reglas base

| Tarea | Estado | Evidencia principal | Observación |
|---|---|---|---|
| E2-01 · Actualizar el diseño a la versión 2 | **Pendiente** | No existe `docs/diseno/01_Especificacion_v2.md` ni `docs/diseno/02_Arquitectura_v2.md` | Es una tarea documental P1; su ausencia explica varias divergencias sin reconciliar |
| E2-02 · Máquina de estados | **Completa** | `shared/domain/estados.ts` + `reserva-state-machine.ts`; 8 estados; tabla de transiciones; `cambiarEstado` privado | `PATCH /reservas/:id/estado` eliminado |
| E2-03 · Migración e integridad base | **Completa** | `20261011130000_e203_integridad_base` con 19 `CHECK`; `zona_horaria`, `completada_at`, índices; `check:integridad` en CI | Los CHECK se comparan contra la base en CI |
| E2-04 · Zona horaria | **Completa** | `luxon`, `TiempoService` inyectable, `barberias.zona_horaria`; tests de borde; 637 tests verdes con dos TZ | No quedan `getDay()` ni `toISOString().slice` en producción |
| E2-05 · Margen en reservas individuales | **Parcial / divergente** | `calcularBloque` suma márgenes por servicio; `crearReserva` usa `margenFinal = 0` para individual; H57 lo declara corrección de «minutos fantasma» | El backlog §5.4/D42 dice que el margen del bloque individual es el de configuración; hay contradicción documental |
| E2-06 · Estabilizar E2E | **Completa** | `vitest.config.e2e.ts`: `fileParallelism: false`, `testTimeout: 30_000`; CI ejecuta E2E; test de carrera con `Promise.all` | No se corrieron localmente en esta auditoría |
| E2-07 · Vocabulario del diseño | **Completa** | `@Delete` = 0; `PATCH .../desactivar|reactivar`; `POST .../liberar`; `PATCH .../estado` | Guardia de vocabulario en `test/vocabulario-sin-delete.spec.ts` |
| E2-08 · Matriz de cumplimiento | **Completa** | `docs/MATRIZ_CUMPLIMIENTO.md`: 72 filas, 69 `OK-PROBADO`, 1 `PARCIAL`, 1 `NO-EXISTE`, 1 `NO-VERIFICADO` | La fila `4.6` de E4-02 sobrevalora el alcance real |

**Balance E2:** 6 completas, 1 parcial, 1 pendiente (documental).

#### A-06 · E2-01: la especificación v2 no existe

El backlog pide dos documentos que recojan D01–D44, los estados, las rutas reales y las tablas nuevas. `docs/` solo contiene backlog, matrices, plan estratégico, plan de sprint, entornos y SQL de pruebas. No existe `docs/diseno/`. Consecuencia: las decisiones que se tomaron sobre la marcha (H57, H68, dirección de la propuesta de horario) no tienen un documento de diseño actualizado donde apoyarse; la única fuente es el backlog original, que en varios puntos ya no coincide con el código.

#### A-07 · E2-05: el margen individual está en conflicto entre backlog y código

**Backlog §5.4 (actualización D42, 2026-10-02):** «el margen que se añade al bloque —individual o grupal— sale SIEMPRE de `configuracion_barberia.margen_grupal_minutos`… Ejemplo con margen de configuración 10: 35 + 10 = 45 min».

**Código actual:** en `crearReserva`, `margenFinal = esGrupal ? config.margenGrupalMinutos : 0`. En `calcularBloque`, el individual suma `margenOperativo` de cada servicio. El comentario dice que sumar el margen de la sede al individual eran «minutos fantasma» y que H57 lo corrigió.

**Por qué:** H57 se cerró como bug de negocio con aprobación del dueño: `margen_grupal_minutos` se llama «grupal» y se estaba aplicando a reservas individuales, inflando 10 minutos la agenda. La corrección es defendible, pero deja el texto del backlog contradiciéndose a sí mismo: D01 dice que la suma ya no determina el bloque; §5.4 dice que el margen de configuración aplica a individual y grupal; el código aplica la suma de márgenes individuales solo como snapshot y no añade margen de sede al individual.

**Impacto:** Medio. No hay pérdida de datos, pero el contrato de precios/agenda que un lector del backlog esperaría no es el que el sistema ejecuta. Los tests están verdes porque miden el comportamiento actual, no el texto.

**Acción:** decidir con el dueño cuál es la regla vigente y corregir **una** fuente: si el margen de sede no aplica al individual, actualizar §5.4/D42 y la matriz; si aplica, reintroducirlo con snapshot y ajustar H57.

---

### 3.4 Épica E3 — Flujo de reserva

| Tarea | Estado | Evidencia principal | Observación |
|---|---|---|---|
| E3-01 · Auditoría unificada | **[X] Completa** | `AuditoriaService.registrarEvento` escribe `barberiaId` en su **columna**; purga de 1 año; tests del processor; migración `20261019120000_e0e1_auditoria_barberia_id` aplicada en `dev` con columna, índice `(barberia_id, creado_at)` y FK `ON DELETE SET NULL`; el filtro usa la columna con fallback JSON solo para el histórico | Detalle en A-15; contexto sin contraseñas, ver A-11 por el token de recuperación |
| E3-02 · Cálculo de disponibilidad | **Completa** | `agenda/domain/huecos.ts` puro; horarios, excepciones, bloqueos, reservas, márgenes; `GET/POST disponibilidad`; alternativas | Decisión H41: las sugerencias no retienen hueco, aceptada por el dueño |
| E3-03 · Crear reserva y cotización | **Completa** | `POST /reservas` `@Roles('CLIENTE')`; `walk-in` separado; orden de validaciones; `cotizar`; MANUAL/AUTOMÁTICO; auditoría; test de carrera | `FOR UPDATE` + SERIALIZABLE; 201/409 |
| E3-04 · Aceptar y rechazar | **Completa** | Rutas `:id/aceptar` y `:id/rechazar`; motivo del catálogo; revalidación; cancelación de job; auditoría | 409 `SOLICITUD_EXPIRADA`; 403 cross-sede |
| E3-05 · Expiración y jobs idempotentes | **Completa** | `jobId` determinista; processor condicionado; reconciliación al arrancar; `encolarConLimite` | H62/H63 resueltos |
| E3-06 · Propuesta de nuevo horario | **Parcial / divergente** | `propuestas_horario`, ventana de 10 min, proponer/aceptar/rechazar; **dirección cliente→sede**; **no retiene hueco**; `PROPUESTA_PENDIENTE` sin productor; expiración diferida | Detalle en A-08 |
| E3-07 · Cancelación del cliente y especial | **Parcial** | Cancelación del cliente con ventana de 30 min y pertenencia; migración D17; **la solicitud especial del cliente no existe**; recordatorio sin `jobId` cancelable | H43/H48 |
| E3-08 · Cancelación del admin con motivo | **Parcial** | `cancelacionEspecial` exige bandera y motivo, pero es staff-only y directa; `cancelarReserva` de staff **no exige motivo**; no hay `cancelar-admin` ni `bloquear_espacio` | H43/H44 |
| E3-09 · Atención y pago | **Completa con desviación** | `CONFIRMADA → COMPLETADA` desde `hora_inicio` (422 `CITA_NO_INICIADA`); `completada_at`; anulación auditada H68; historial; ingresos excluyen anulados en frontend | El `PATCH` del backlog se sustituyó por `POST .../anular` |
| E3-10 · No presentado y restricción | **Completa** | 15 min con zona de sede; contador local; 3 advertencia; 5 restricción; D48; tests de 14/15/16 y aislamiento A/B | Ruta se llama `:id/inasistencia` (no `:id/no-presentado`) |
| E3-11 · Configuración de la barbería | **Completa** | `GET/PATCH .../configuracion`; bloqueo con pendientes `HAY_PENDIENTES`; validaciones; pausa; auditoría | Flag de oportunidades incluido |
| E3-12 · Vinculación, 6.ª y desvinculación | **Completa** | Límite 5; `PENDIENTE_APROBACION`; bandeja de plataforma; enlace/QR; desvincular con reservas en curso; D20/D21 | Tests E2E de 17 casos |
| E3-13 · Cambios de nombre y responsable | **Completa** | `solicitudes_cambio_barberia`; `PATCH` limitado; teléfono con contraseña; aprobación transaccional | Tests E2E |

**Balance E3:** 10 completas, 3 parciales.

#### A-08 · E3-06: la propuesta de horario va en la dirección contraria al backlog

**Backlog §5.2/§5.4 y E3-06:** el responsable propone otro horario; el cliente tiene 10 minutos para aceptar o rechazar; la reserva pasa a `PROPUESTA_PENDIENTE`; el hueco propuesto se mantiene ocupado hasta que expire; si rechaza o expira, se inicia un proceso nuevo.

**Código:** `POST /reservas/:id/proponer-horario` es `@Roles('CLIENTE')`; `POST .../propuesta-horario/aceptar|rechazar` es `@Roles('ADMIN_BARBERIA','ADMINISTRADOR')`. La propuesta vive en `propuestas_horario`; la reserva **no** pasa a `PROPUESTA_PENDIENTE`; el hueco **no** se retiene; la expiración se comprueba al aceptar o proponer, no con un job.

**Por qué:** consta en `AUDITORIA_HALLAZGOS.md` H35/H41 y en `reporte-e3-08.md`: el dueño pidió explícitamente el flujo cliente→sede y «sin afectar directamente la disponibilidad actual hasta que el staff la acepte». Es una **decisión consciente**, no un olvido, pero contradice el backlog y deja H42 abierto.

**Impacto:** Medio. La funcionalidad existe, pero el contrato no es el que el backlog describe; el estado `PROPUESTA_PENDIENTE` nunca se produce y las propuestas vencidas se quedan `PENDIENTE` en la base hasta que alguien las toque.

**Acción:** actualizar el backlog E3-06 y la matriz a la dirección aprobada, o implementar la dirección original; añadir job de expiración de propuestas y, si se quiere el estado, un productor de `PROPUESTA_PENDIENTE`.

#### A-09 · E3-07/E3-08: faltan la solicitud del cliente y la cancelación administrativa con motivo

**E3-07** pide: `POST /reservas/:id/cancelacion-especial {motivo}` para el **CLIENTE**, que deja la reserva `CONFIRMADA` con `cancelacion_especial_estado = SOLICITADA`; y `POST .../cancelacion-especial/resolver {aprobar, motivo?}` para el admin. **E3-08** pide `POST .../cancelar-admin {motivo_codigo, motivo_detalle, bloquear_espacio?}` para `PENDIENTE` o `CONFIRMADA`, con motivo obligatorio y bloqueo opcional.

**Código actual:** `POST .../cancelacion-especial` es **solo staff** (`@Roles('ADMIN_BARBERIA','ADMINISTRADOR')`) y pasa directamente a `CANCELADA` con `APROBADA`. No existe la ruta del cliente ni la de resolución. `cancelarReserva` permite al staff cancelar sin motivo. No existe `cancelar-admin` ni `bloquear_espacio`.

**Por qué:** H43 y H44 documentan que se implementó la variante que pidió el dueño (staff-only) y que la solicitud del cliente quedó fuera; H44 además señala que la cancelación especial del staff no exige estar fuera de la ventana de 30 minutos.

**Impacto:** Medio. El cliente puede cancelar dentro de la ventana, que es el caso mayoritario; pierde la vía de solicitud fuera de ventana. La sede no tiene una cancelación con motivo obligatorio ni la opción de bloquear el espacio, que son requisitos de E3-08.

**Acción:** implementar la solicitud del cliente y su resolución, o bajar D17 de alcance con firma del dueño; añadir motivo obligatorio al cancelar como staff y la creación opcional de bloqueo con su job.

#### A-10 · E3-09: la corrección de pagos se hizo por anulación, no por `PATCH`

El backlog pedía `PATCH /pagos/:id {estado_pago, motivo}` para corregir `PAGADA ↔ PENDIENTE_DE_PAGO` con auditoría. El código implementa `POST /pagos/:id/anular` (motivo obligatorio, estado `ANULADO`, auditoría `PAGO_ANULADO`, reserva sigue `COMPLETADA`, se puede volver a cobrar) y `GET /pagos/historial`. Es una **decisión consciente y más auditable**: no se sobrescribe el estado, se conserva el rastro. Impacto Bajo (contrato distinto, comportamiento equivalente o mejor). Acción: actualizar el backlog y la matriz; no reimplementar el `PATCH`.

#### A-12 · E3-07: el recordatorio de 1 hora no se puede cancelar

`NotificacionService.programarRecordatorio` hace `queue.add('recordatorio-cita', ..., { delay, attempts: 3 })` **sin `jobId`**. El backlog E3-07 pide cancelar los jobs de recordatorio y expiración al cancelar. Solo se cancela el de expiración (`jobIdExpiracionReserva`). Consecuencia: una reserva cancelada puede generar un recordatorio. H48 lo registra como abierto. Impacto Bajo/Medio; acción: `jobId` determinista `recordatorio:{reservaId}` y `remove` en los efectos de cancelación.

#### A-15 · E3-01: falta la columna `auditoria.barberia_id` y su índice — **RESUELTO 2026-10-19**

**Backlog E3-01, punto 1:** «Migración: `auditoria.barberia_id UUID NULL` con índice `(barberia_id, creado_at)`».

**Código:** el modelo `Auditoria` de `prisma/schema.prisma` solo tiene `id`, `usuarioId`, `accion`, `entidad`, `entidadId`, `contexto` y `creadoAt`. La tabla se creó en la migración inicial y **ninguna migración posterior añade `barberia_id`**. `AuditoriaService.registrarEvento` escribe `contexto` y no tiene un campo `barberiaId` propio; `consultarAuditorias` filtra con `where.contexto = { path: ['barberiaId'], equals: barberiaId }` y el propio comentario reconoce que la columna «todavía no tiene».

**Por qué:** la tarea se resolvió funcionalmente con el JSON, que permite aislar por sede siempre que el evento haya guardado `barberiaId` en su contexto. Es una solución válida de comportamiento, pero **no cumple el diseño**: no hay columna, no hay índice `(barberia_id, creado_at)` y las consultas por sede dependen de que cada llamador se acuerde de escribir la clave. El `check:integridad` no lo detecta porque no compara columnas de auditoría.

**Impacto:** Medio. La privacidad se mantiene (el filtro existe), pero el rendimiento y la consistencia del modelo de datos no son los del backlog; un evento sin `barberiaId` en el contexto es invisible para la sede aunque pertenezca a ella.

**Acción:** migración con la columna y el índice; backfill desde `contexto->>'barberiaId'`; añadir `barberiaId` a `RegistrarAuditoriaDto` y escribirlo; adaptar `consultarAuditorias`; test de aislamiento y de índice.

**Cierre (2026-10-19):** hecho y aplicado en `dev`. Detalles que hubo que resolver sobre la marcha: el backfill ingenuo rompía la FK porque hay eventos históricos con sede en el JSON cuya `barberia` ya no existe (23503 en el primer `migrate deploy`); la migración quedó **idempotente** y el backfill solo rellena claves que existen en `barberias`. Resultado en `dev`: 15 migraciones aplicadas, columna + índice `auditoria_barberia_id_creado_at_idx` + FK `ON DELETE SET NULL` presentes y **49 de 521** filas de auditoría con `barberia_id` rellenado (el resto sin sede en el contexto o con sede ya borrada, que queda en NULL sin perder la fila). `consultarAuditorias` filtra por la columna y conserva el JSON como fallback para el histórico.

---

### 3.5 Épica E4 — Disponibilidad avanzada y fidelización

| Tarea | Estado | Evidencia principal | Observación |
|---|---|---|---|
| E4-01 · Reserva grupal | **Completa** | `reserva-grupal.ts` puro; DTO con participantes; capacidad D46; un solo margen; snapshots; test E2E del ejemplo 35+30+30+10 | Dos reservas solapadas siguen dando 409 |
| E4-02 · Oportunidades y alternativas | **Parcial — brecha alta** | Carril A: `buscarAlternativas`, `GET .../huecos`, alternativas en el 409; Carril B: **no existe** | Detalle en A-03 |
| E4-03 · Fidelización y reactivación | **Completa** | `mi-estado`; `solicitudes_reactivacion`; `SIN_RESTRICCION`/`REACTIVACION_PENDIENTE`; suspensión de cuenta con `token_version`; D48; tests E2E | Aprobación conserva el contador |
| E4-04 · Información adicional | **No existe (referenciada, no definida en este backlog)** | No hay columna `informacion_adicional`; H32 abierto | Fuera de las 42 tareas; el backlog la menciona en E3-04/E3-05 |
| E4-05 · Módulo `src/cliente/` | **No existe / desactivado a propósito** | `app.module.ts` no registra `ClienteModule`; H22 | Decisión de alcance; el E2E comprueba que no está expuesto |

**Balance E4:** 2 completas, 1 parcial, 2 fuera del backlog definido.

#### A-03 · E4-02: el carril B de D22 no está implementado

**Lo que sí está:** la función pura de huecos, las alternativas que se devuelven en el error de una reserva que no cabe, el endpoint `GET /barberias/:barberiaId/disponibilidad/huecos` y la bandera `oportunidades_espacio_activas` que lo apaga. El test `test/e4-02-oportunidades.e2e-spec.ts` cubre tres casos: alternativas en el 409, mismas alternativas en el endpoint y bandera apagada → `[]`.

**Lo que falta:** al liberarse un hueco (cancelación del cliente, cancelación del admin, cancelación especial aprobada o bloqueo liberado), calcular los elegibles de D22 y encolar **un job idempotente por hueco** que cree notificaciones de canal APP, con máximo 25 destinatarios, sin duplicados, excluyendo a quien canceló, a los restringidos y a quien ya tiene una reserva confirmada solapada. No hay ninguna referencia a `oportunidad` en `reserva.service`, `agenda.service` o el módulo de notificaciones; el `grep` solo devuelve la bandera y el endpoint.

**Por qué:** el carril A se ejecutó y el carril B quedó fuera sin que el backlog ni la matriz lo reflejen. `MATRIZ_CUMPLIMIENTO` marca la fila 4.6 como `OK-PROBADO` citando el E2E de alternativas, lo que **sobrevalora** el alcance.

**Impacto:** Alto para D22; los criterios de aceptación 1 y 2 de E4-02 no se cumplen. El carril A sí es correcto y no retiene huecos (decisión H41).

**Acción:** implementar `OportunidadEspacioService` (elegibles + job con `jobId` determinista + notificaciones) y tests de 3 elegibles → 3 notificaciones, reejecución sin duplicados, exclusión del que canceló y de los restringidos; o registrar la decisión de bajar D22 de alcance y corregir la matriz.

---

## 4. CHECKLIST DE GARANTÍAS NO NEGOCIABLES

| Garantía | Veredicto | Evidencia |
|---|---|---|
| **Autorización** (`@Public`, `@Autenticado`, `@Roles`) | **Cumple** | `RolesGuard` fail-closed; 85 rutas con política; `route-security.spec.ts` |
| **Privacidad inter-barbería** | **Cumple en lo implementado** | H18, H19/H20, H14, E1-06; E4-05 desactivado; E4-02 carril B no aplica porque no existe |
| **Vocabulario estricto** | **Cumple** | `@Delete` = 0; `DESACTIVAR`/`REACTIVAR`/`LIBERAR`/`CANCELAR`/`DESVINCULAR`; guardia de vocabulario |
| **Disponibilidad calculada, nunca almacenada** | **Cumple** | `huecos.ts` puro; no hay columna de disponibilidad; se recalcula por petición |
| **Temporizadores del servidor** | **Cumple parcialmente** | `expira_at` y jobs de servidor; la expiración de propuestas es diferida (H42) y el recordatorio no tiene `jobId` cancelable (H48) |
| **Flujo maestro del backend** | **Cumple en reservas y pagos** | Orden de validaciones en `crearReserva`, `PagoService`; parcial en E3-06/E3-08 por las rutas ausentes |
| **Auditoría (qué, quién, cuándo, contexto)** | **Cumple parcialmente** | `AuditoriaService` transaccional; no guarda contraseñas; **`auditoria.barberia_id` creada, indexada y aplicada en `dev`** (A-15 cerrado); **resta el token de recuperación en claro en `notificacion.contenido`** (A-11) |
| **Fail-closed** | **Cumple** | `RolesGuard` lanza 403 sin política; `VinculoBarberiaGuard` deniega sin vínculo; `assertSafeTestDatabase` aborta |
| **Errores HTTP correctos** | **Cumple** | D40 `{statusCode, codigo, mensaje}`; Prisma P2002→409, P2025→404, P2003→400, 40001/P2034→409; 422 de negocio |
| **Tests unitarios y E2E** | **Parcial** | 637 unitarios y 93 frontend verdes; E2E configurados y en CI, **no ejecutados en esta máquina**; falta cobertura de E4-02 carril B y E3-08 |

---

## 5. PREGUNTAS DETONANTES

1. **¿El backend valida o solo presenta?** Valida: guards, DTO global, reglas de servicio y transacciones. Excepción: E3-08 (no exige motivo en la cancelación de staff). El límite de sedes (E1-07) ya se valida en el backend desde 2026-10-19.
2. **¿Una barbería puede leer el historial privado de otra?** No en las rutas implementadas: auditoría (H18), reservas (H14), agenda/bloqueos (H19/H20), catálogo y disponibilidad (E1-06). El `ADMINISTRADOR` global es transversal por D05.
3. **¿Se almacena la disponibilidad?** No. Se calcula con horario, excepciones, reservas, bloqueos y márgenes en cada petición.
4. **¿Los temporizadores se inician en el cliente?** No. `expira_at` lo fija el servidor y el job vive en BullMQ; las propuestas usan reloj del servidor. La caducidad de propuestas es diferida (H42).
5. **¿Hay endpoints sin decorador de autorización?** No. `route-security.spec.ts` falla si falta `@Public`, `@Autenticado` o `@Roles`.
6. **¿Se filtra siempre por `barberia_id`?** En las lecturas y escrituras críticas, sí. Dos matices: la auditoría filtra por la **columna** `auditoria.barberia_id` con fallback JSON solo para el histórico (desde 2026-10-19), y `ConfiguracionBarberiaController` repite un chequeo con `!rol.barberiaId` que contradice la regla de E1-04, aunque el guard ya deniega antes.
7. **¿El contador de inasistencias es GLOBAL o LOCAL?** LOCAL por sede (`cliente_barberias`), D48. El test E4-03 comprueba restringido en A y libre en B.
8. **¿Las inasistencias pueden suspender la cuenta?** No. Solo el `ADMINISTRADOR` puede escribir `estado_cuenta = 'SUSPENDIDO'`, con motivo y auditoría; hay test explícito.
9. **¿La auditoría registra datos sensibles?** La auditoría no guarda contraseñas ni textos de antecedentes. **Hallazgo:** `forgotPassword` guarda el token de recuperación en claro en `notificacion.contenido` y lo devuelve como `debugToken` fuera de producción (A-11).
10. **¿Hay botones del frontend que no validen en el backend?** El frontend es presentación y las rutas están protegidas; sigue sin validación de backend el motivo de cancelación de staff (E3-08). El límite de barberías (E1-07) ya está validado en el backend con 422. Los ingresos se calculan en el frontend a partir de `/pagos/historial`, excluyendo `ANULADO`, que es correcto.

---

## 6. SCORECARD GENERAL

| Módulo | Completas | Parciales | Pendientes | No verificable | % Avance | Riesgo |
|---|---:|---:|---:|---:|---:|---|
| E0 · Cimientos y contención | 5 | 3 | 0 | 0 | **63 %** | Medio |
| E1 · Seguridad | 8 | 1 | 0 | 1 | **80 %** | Medio |
| E2 · Integridad de datos | 6 | 1 | 1 | 0 | **75 %** | Medio |
| E3 · Flujo de reserva | 10 | 3 | 0 | 0 | **77 %** | Medio |
| E4 · Avanzado y fidelización | 2 | 1 | 0 | 0 | **67 %** | **Alto** |
| **TOTAL (42 tareas)** | **31** | **9** | **1** | **1** | **74 %** | **Alto** |

> No se cuentan en el total E4-04 (información adicional) ni E4-05 (módulo `src/cliente/`), porque el backlog las referencia pero no las define como tareas con criterios propios en este documento.

---

## 7. HALLAZGOS CRÍTICOS

| ID | Severidad | Área | Hallazgo | Razón | Impacto | Acción |
|---|---|---|---|---|---|---|
| **A-01** | ~~Alta~~ **cerrado** | E1-07 | ~~No existe límite de 2 barberías; sin throttling ni auditoría~~ Implementado: conteo SERIALIZABLE, 422 `LIMITE_BARBERIAS` y auditoría `BARBERIA_CREADA` con `barberia_id` | Se ejecutó tarde (2026-10-19) | Sedes ya no crecen sin límite | Hecho y probado con 5 pruebas unitarias; falta solo el throttling 3/hora (desviación aceptada) |
| **A-02** | ~~Alta~~ **cerrado** | E0-07 | ~~Seed sin `ADMIN_BARBERIA`; no hay `admin:create`~~ Seed con 4 roles y `admin:create` verificado contra `dev` | Seed desactualizado; el alta silenciaba la ausencia del rol | Base nueva ya puede arrancar | Hecho: seed ×2 sin duplicados y admin creado en base real |
| **A-03** | **Alta** | E4-02 | Carril B de D22 ausente | Implementación incompleta | No hay oportunidad proactiva ni idempotencia | Implementar o bajar de alcance |
| **A-04** | ~~Media~~ **cerrado** | E1-10 | ~~Sin `helmet` ni límite de cuerpo 100 kb~~ `helmet@8` + `express.json/urlencoded({ limit: '100kb' })` en `main.ts` | Omisión de endurecimiento | Cabeceras y 413 verificados contra el servidor real | Hecho: guardia `e1-10-hardening.spec.ts` |
| **A-05** | Media | E0-05 | `render.yaml` con `autoDeploy: true`; falta `docs/DESPLIEGUE.md` | Tarea de proceso pendiente | Push a `main` despliega sin esperar checks | Verificar protección y documentar |
| **A-06** | Media | E0-06/E2-01 | Falta `docs/TRIAGE_WIP.md` y `docs/diseno/*_v2.md` | Tareas documentales no ejecutadas | El diseño vigente no está escrito | Producir ambos documentos |
| **A-07** | Media | E2-05 | Margen individual: backlog §5.4/D42 vs. código H57 | Corrección de bug aprobada sin actualizar el backlog | Contrato de agenda/precio ambiguo | Decidir regla y corregir fuente |
| **A-08** | Media | E3-06 | Propuesta cliente→sede, sin `PROPUESTA_PENDIENTE`, sin retención y expiración diferida | Decisión del dueño (H35/H41) no reflejada en backlog | Contrato distinto; H42 abierto | Actualizar backlog o implementar original |
| **A-09** | Media | E3-07/E3-08 | Falta solicitud especial del cliente y cancelación admin con motivo/bloqueo | Variante staff-only aprobada (H43/H44) | D17 incompleto | Implementar o firmar descope |
| **A-15** | ~~Media~~ **cerrado** | E3-01 | ~~No existe `auditoria.barberia_id` ni el índice~~ Columna, índice y FK creados y aplicados en `dev` | Se resolvió tarde con migración propia | La consulta por sede usa índice y columna | Migración `20261019120000_e0e1_auditoria_barberia_id` + backfill + fallback JSON |
| **A-10** | Baja | E3-09 | `PATCH` de pago sustituido por anulación | Decisión consciente H68/H76, más auditable | Contrato distinto, no peor | Actualizar backlog |
| **A-11** | Media | Seguridad | Token de recuperación en claro en `notificacion.contenido` y `debugToken` fuera de producción | Comodidad de desarrollo; envío real pendiente | Fuga si se lee la tabla o la respuesta | No guardar el token; enviar enlace; limitar debug a dev |
| **A-12** | Baja | E3-07 | Recordatorio sin `jobId` ni cancelación | Deuda H48 | Recordatorio tras cancelar | `jobId` determinista y `remove` |
| **A-13** | Baja | E1-04/E3-11 | `ConfiguracionBarberiaController` usa `!rol.barberiaId` como comodín | Chequeo duplicado y redundante | No explotable por el guard, pero contradice la regla | Usar `alcanceCumple` |
| **A-14** | Baja | E2-08 | Matriz marca E4-02 `OK-PROBADO` con solo carril A | Evidencia incompleta | Sobrevalora el cumplimiento | Corregir fila 4.6 |
| **A-16** | Baja | Documentación | `MATRIZ_RUTAS.md` dice 80 rutas/320 decisiones y la matriz de cumplimiento dice 76; el test real dice 85/340 | Documentos no actualizados al crecer las rutas | Auditoría documental desfasada | Regenerar conteos desde el test |

---

## 8. RECOMENDACIONES POR PRIORIDAD

### P0 — Antes de cualquier despliegue o demo

1. ~~**Cerrar E1-07** con límite transaccional, 422 `LIMITE_BARBERIAS`, throttling y auditoría.~~ **Hecho 2026-10-19** (excepto throttling, desviación documentada).
2. ~~**Cerrar E0-07**: seed con los cuatro roles y script `admin:create` seguro; probar base vacía y doble ejecución.~~ **Hecho 2026-10-19** (seed ×2 y `admin:create` verificados en `dev`).
3. **Resolver E4-02**: implementar el carril B o registrar el descope con el dueño y corregir la matriz.
4. **Verificar la protección de `main`** y decidir si `autoDeploy` debe esperar checks; escribir `docs/DESPLIEGUE.md`.

### P1 — Antes de cerrar la V1

5. ~~**E1-10:** añadir `helmet` y límite de cuerpo de 100 kb; test de payload excesivo.~~ **Hecho 2026-10-19** (`helmet`, 100 kb y verificación 413 contra servidor real).
6. **E3-07/E3-08:** solicitud especial del cliente, resolución, motivo obligatorio en cancelación de staff y bloqueo opcional.
7. **E3-06:** actualizar el backlog a la dirección aprobada y añadir job de expiración de propuestas (H42); o implementar la dirección original.
8. ~~**E3-01:** crear `auditoria.barberia_id` con índice `(barberia_id, creado_at)`, backfill desde `contexto->>'barberiaId'` y adaptar `consultarAuditorias`.~~ **Hecho 2026-10-19** (migración aplicada en `dev`; el filtro JSON queda como fallback solo para el histórico).
9. **E2-05:** reconciliar D01/D42/§5.4 con el código y actualizar tests y matriz.
10. **E0-06/E2-01:** escribir `docs/TRIAGE_WIP.md` y `docs/diseno/*_v2.md`; son la base para que las decisiones no vivan solo en informes.

### P2 — Deuda controlada

11. **A-11:** no guardar el token de recuperación en `notificacion.contenido`; enviar el enlace por el canal real cuando exista O-01; mantener `debugToken` solo en `dev`.
12. **A-12:** `jobId` determinista para el recordatorio y cancelación al pasar a estado terminal.
13. **A-13:** reemplazar el chequeo manual de configuración por `alcanceCumple`.
14. **H56/H60:** decidir la zona horaria literal y la protección del último administrador.
15. **E4-05:** registrar formalmente que el módulo `src/cliente/` sigue desactivado y qué tarea lo publicará.
16. **A-16:** regenerar `MATRIZ_RUTAS.md` y la fila 3.2 de la matriz de cumplimiento desde el test (85 rutas/340 decisiones).

---

## 9. APÉNDICES

### A. Evidencia de comandos

```
LINT_EXIT=0   → Found 103 warnings and 0 errors. Finished in 1.1s on 232 files (ronda de cierre).
BUILD_EXIT=0  → nest build
TEST_EXIT=0   → Test Files 53 passed (53) · Tests 637 passed (637)
TZ_UTC_EXIT=0 → Test Files 53 passed (53) · Tests 637 passed (637)
TZ_SD_EXIT=0  → Test Files 53 passed (53) · Tests 637 passed (637)
FE_TEST_EXIT=0 → Test Files 11 passed (11) · Tests 93 passed (93)
E2E_GUARD_EXIT=1 → TEST ABORTED: APP_ENV is set to 'staging'...

-- ronda de cierre (base dev y servidor real) --
MIGRATE_EXIT=0 → All migrations have been successfully applied. (15 migraciones)
SEED_EXIT=0 ×2 → ✅ 4 roles insertados/actualizados. (sin duplicados; 17/9/7/5 permisos)
ADMIN_EXIT=0   → Administrador global listo: testadmin@codecore.com (ACTIVO, rol GLOBAL)
HELMET_HEADERS → CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy
PAYLOAD_150KB  → HTTP 413 (JSON) · HTTP 413 (urlencoded)
PAYLOAD_102534 → HTTP 413 · PAYLOAD_100434 → parseado (400 de DTO) · 90034 → parseado
```

### B. Inventario verificado

- **Rutas declaradas:** 85 (`test/route-security.spec.ts`, `=== TABLA DE RUTAS (85) ===`).
- **Decisiones rol × ruta:** 340 (85 × 4) en `test/permisos-matriz.spec.ts`.
- **Migraciones:** 15 en `prisma/migrations/` (todas aplicadas en `dev`, incluida `20261019120000_e0e1_auditoria_barberia_id`).
- **Archivos de test backend:** 87 (`*.spec.ts` + `*.e2e-spec.ts`).
- **`@Delete` en `src/`:** 0.
- **`SUPER_ADMIN` en runtime:** 0 (solo comentarios y tests).

### C. Documentos revisados

`docs/BACKLOG_BARBERIAS_V1.md`, `docs/MATRIZ_CUMPLIMIENTO.md`, `docs/MATRIZ_RUTAS.md`, `docs/ENTORNOS.md`, `AUDITORIA_HALLAZGOS.md`, `REPORTE_FINAL_ESTABILIZACION.md`, `reporte-e3-06-07.md`, `reporte-e3-08.md`, `reporte-e3-12.md`, `reporte-e4-02.md`, `reporte-h68-correccion-pagos.md`, `reporte-h76-e2e-pagos-anulacion.md`, y los informes de cierre de E2/E3/E4.

### D. Verificaciones externas pendientes

| Tarea | Qué falta | Responsable |
|---|---|---|
| E0-01 | Confirmar rotación de contraseña en Neon/Render y `/health` con la nueva | Dueño |
| E0-03 | Conteo y desactivación de cuentas de prueba en staging | Dueño |
| E0-05 | Protección de `main` en GitHub y decisión sobre `autoDeploy` | Dueño |
| E1-08 | Crear `barberias_app` y probar que no puede `DROP TABLE` | Dueño |
| E2-06 | Corrida E2E completa en `dev`/CI y pegar el resumen | QA/CI |

> **Cerrado en esta ronda:** la fila de E0-07 se cumplió el 2026-10-19 (seed dos veces en `dev` + `admin:create` contra la base real).

---

**Conclusión:** el backend es sólido en seguridad, aislamiento y flujo de reservas, y la suite unitaria lo demuestra. Tras la ronda de 2026-10-19 las Épicas 0 y 1 quedan **cerradas**: E0-07, E1-07 y E1-10 están completas y verificadas contra la base `dev` y contra el servidor real, y E3-01/A-15 (columna de auditoría) también. Queda una brecha alta: **E4-02 (carril B de D22)**, más las tareas externas (E0-01/E0-03/E0-05/E1-08) y las decisiones documentales (E2-01, triage E0-06). El resto son divergencias conscientes que necesitan una decisión documentada y una actualización del backlog, no una reescritura.

**Firma:** Auditoría técnica independiente · 19 de octubre de 2026.
