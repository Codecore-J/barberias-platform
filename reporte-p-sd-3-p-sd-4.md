# P-SD-3 y P-SD-4 · Integridad del catálogo y sede suspendida que deja de vender

> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Rama `fix/soft-delete-gaps`: **push sin merge**, a la espera de aprobación.
>
> **Aviso de numeración.** En este encargo «P-SD-3» = integridad de base (los CHECK del catálogo) y
> «P-SD-4» = reglas de negocio de la sede. En el `PLAN_MIGRACION_SOFT_DELETE.md` esos dos puntos están al revés
> (P-SD-4 = migración, P-SD-3 = sede). El documento es el plan aprobado; el trabajo es el mismo y aquí se usa la
> numeración del encargo.

## 1. ¿Qué hice?

**Fase 1 · Preparación**
- Commit en `main` con el plan aprobado: `1da9f81 docs(e2-07): guarda el plan de cierre del soft-delete aprobado`.
- Rama nueva desde `main`: `fix/soft-delete-gaps`.

**Fase 2 · Integridad de base (los dos CHECK que faltaban)**
- [`prisma/migrations/20261014000000_e207_catalogo_estado_check/migration.sql`](backend-barberias/prisma/migrations/20261014000000_e207_catalogo_estado_check/migration.sql) — `servicios_estado_check` y `combos_estado_check`, `estado IN ('ACTIVO','INACTIVO')`. Aditiva: no toca datos ni reformula CHECK existentes.
- **Inventario previo, solo lectura sobre `dev` (2026-10-14):** `servicios.estado` → `ACTIVO` (125), `combos.estado` → `ACTIVO` (4); ambas columnas `VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'` y **0 CHECK** en las dos tablas (`pg_constraint` por `conrelid`). Ningún valor fuera de catálogo, así que el `ALTER` no puede fallar por datos.
- `scripts/check-integridad.cjs` **no necesitó cambios** y eso está medido, no supuesto: con la migración en disco y sin aplicar, la guardia sale con 1 y lista los dos CHECK y la migración pendiente; aplicada, vuelve a verde. El script recoge los `CONSTRAINT "…_check"` de `prisma/migrations/**` por sí solo.

**Fase 3 · Reglas de negocio de la sede suspendida**
- [`src/shared/domain/sede.ts`](backend-barberias/src/shared/domain/sede.ts) (nuevo) — `exigirSedeActiva(db, barberiaId)`: UNA sola definición de la regla, que responde 422 `SEDE_INACTIVA` (D40) a la sede `INACTIVO`. Acepta el cliente o el `tx`, para participar en la transacción que protege.
- [`src/reserva/application/reserva.service.ts`](backend-barberias/src/reserva/application/reserva.service.ts) — el alta llama a la guarda ANTES de mirar el vínculo (es decisión de la plataforma, no una relación cliente-sede). Sin cambio de orden en el resto de validaciones.
- [`src/agenda/application/disponibilidad.service.ts`](backend-barberias/src/agenda/application/disponibilidad.service.ts) — la guarda en las tres puertas de lectura de agenda: `calcularDisponibilidadDeSolicitante` (GET y POST `/agenda/disponibilidad`), `buscarAlternativasDeSolicitante` y `huecosDeLaSede` (`GET …/disponibilidad/huecos`). En las tres va DESPUÉS de la pertenencia: un cliente de otra sede sigue recibiendo 403 y no puede usar el 422 para sondear suspensiones.
- [`src/barberia/application/barberia.service.ts`](backend-barberias/src/barberia/application/barberia.service.ts) — `cambiarEstado` deja rastro **durable**: `AuditoriaService.registrarEvento` con `BARBERIA_SUSPENDIDA` / `BARBERIA_REACTIVADA`, entidad `barberias`, `contexto = { anterior, nuevo }`, dentro de la MISMA transacción que el `update`. La dependencia es requerida (no `@Optional`): el módulo ya importa `AuditoriaModule`.
- [`src/shared/domain/estados.ts`](backend-barberias/src/shared/domain/estados.ts) — catálogo `ESTADOS_CATALOGO` (ACTIVO/INACTIVO), la fuente única que ahora usan los DTO.
- [`src/catalogo/application/dto/update-servicio.dto.ts`](backend-barberias/src/catalogo/application/dto/update-servicio.dto.ts) y [`update-combo.dto.ts`](backend-barberias/src/catalogo/application/dto/update-combo.dto.ts) — `estado` pasa de texto libre a `@IsIn(ESTADOS_CATALOGO_VALORES)`: un valor fuera de catálogo responde **400** en la API en lugar del **500** por violación de CHECK que produciría el nuevo constraint.

**Fase 4 · Tests (rojo medido antes del verde)**
- Unitarios: [`disponibilidad.service.spec.ts`](backend-barberias/src/agenda/application/disponibilidad.service.spec.ts) (+5: las tres puertas rechazan 422, la pertenencia sigue ganando con 403, control ACTIVO), [`reserva.service.spec.ts`](backend-barberias/src/reserva/application/reserva.service.spec.ts) (+2: alta rechazada 422 sin tocar el vínculo ni escribir, control ACTIVO), [`barberia.service.spec.ts`](backend-barberias/src/barberia/application/barberia.service.spec.ts) (+4: evento de suspensión y de reactivación con anterior/nuevo, misma transacción, sin cambio no hay evento).
- E2E nuevo: [`test/e2-07-sede-inactiva.e2e-spec.ts`](backend-barberias/test/e2-07-sede-inactiva.e2e-spec.ts) — 9 pruebas sobre HTTP real y base real (ver §4).
- **Rojo verificado contra el código anterior** (los servicios de HEAD con los tests nuevos en disco):

```text
 FAIL  disponibilidad.service.spec.ts > sede INACTIVO (P-SD-4) > GET de disponibilidad … 422 SEDE_INACTIVA
 FAIL  disponibilidad.service.spec.ts > sede INACTIVO (P-SD-4) > los huecos … también se rechazan (no devuelven [])
 FAIL  disponibilidad.service.spec.ts > sede INACTIVO (P-SD-4) > las alternativas … también se rechazan
 FAIL  barberia.service.spec.ts > cambiarEstado (E2-07 · D29) > suspende: deja BARBERIA_SUSPENDIDA …
 FAIL  barberia.service.spec.ts > cambiarEstado (E2-07 · D29) > reactiva: el evento es BARBERIA_REACTIVADA
 FAIL  barberia.service.spec.ts > cambiarEstado (E2-07 · D29) > el evento y la escritura salen juntos, en la MISMA transacción
 FAIL  reserva.service.spec.ts > crearReserva y Snapshot Inmutable (T6.2) > RECHAZA el alta con 422 SEDE_INACTIVA …
 Test Files  3 failed (3)
      Tests  7 failed | 122 passed (129)
```

## 2. Archivos tocados (resumen)

| Archivo | Qué |
| :--- | :--- |
| `prisma/migrations/20261014000000_e207_catalogo_estado_check/migration.sql` | **nuevo** — los dos CHECK |
| `src/shared/domain/sede.ts` | **nuevo** — `exigirSedeActiva` |
| `test/e2-07-sede-inactiva.e2e-spec.ts` | **nuevo** — 9 pruebas E2E |
| `src/reserva/application/reserva.service.ts` | alta de reserva: guarda de sede |
| `src/agenda/application/disponibilidad.service.ts` | tres puertas de disponibilidad: guarda de sede |
| `src/barberia/application/barberia.service.ts` | `cambiarEstado` transaccional + auditoría |
| `src/shared/domain/estados.ts` | `ESTADOS_CATALOGO` |
| `src/catalogo/application/dto/update-{servicio,combo}.dto.ts` | `estado` validado con `@IsIn` |
| `src/{agenda,barberia,reserva}/**.spec.ts` | tests unitarios nuevos |

## 3. Salida literal — Unitarios (`npm run test`)

```text
 Test Files  48 passed (48)
      Tests  537 passed (537)
```

## 4. Salida literal — E2E y guardias

Entorno: Postgres 16 en contenedor local (`barberias_pg_verify`, puerto 5433) + Redis local, **base creada desde cero** con `npx prisma migrate deploy` (las 13 migraciones) y `npm run seed`. Es el mismo procedimiento que el CI de `.github/workflows/ci.yml`; el CI usa `postgres:15`, el contenedor `postgres:16` — ninguna de las dos migraciones usa diferencias de versión.

```text
$ npx vitest run --config ./vitest.config.e2e.ts
 Test Files  28 passed (28)
      Tests  212 passed (212)
   Duration  140.05s

$ npm run check:integridad
[check:integridad] OK — 13 migraciones y 29 CHECK coinciden con el esquema «public».
```

La prueba E2E del CHECK afirma que el rechazo viene de Postgres, no de la app —el nombre de la restricción aparece en el error que devuelve el driver:

```text
PostgresError { code: "23514", message: "new row for relation \"servicios\" violates check constraint
  \"servicios_estado_check\"", detail: Some("Failing row contains (…, BORRADO).") }
PostgresError { code: "23514", message: "new row for relation \"combos\" violates check constraint
  \"combos_estado_check\"", detail: Some("Failing row contains (…, BORRADO).") }
```

Guardias del proyecto, en verde: `npm run build` (`nest build`, exit 0) y `npm run lint` (oxlint, **0 errores**, 58 avisos preexistentes).

## 5. Criterios de aceptación

- [x] Migración aditiva con `servicios_estado_check` y `combos_estado_check`, con el inventario de datos previo leído de la base real.
- [x] `npm run check:integridad` en verde sobre una base creada desde cero (y en rojo antes de aplicarla: la guardia sí los vigila).
- [x] El alta de reserva en una sede `INACTIVO` responde 422 `SEDE_INACTIVA` y no escribe nada.
- [x] La disponibilidad y los huecos de una sede `INACTIVO` se rechazan (422), nunca `[]`.
- [x] Reactivar devuelve la normalidad: el bloqueo depende del estado, no es definitivo.
- [x] `cambiarEstado` deja `BARBERIA_SUSPENDIDA` / `BARBERIA_REACTIVADA` con anterior/nuevo, en la misma transacción que el cambio.
- [x] Tests unitarios y E2E que demuestran lo anterior, con el rojo medido contra el código previo.
- [x] Suite completa en verde: 537/537 unitarios, 212/212 E2E, `check:integridad` OK, build y lint OK.

## 6. Decisiones

- **Reservas abiertas: se quedan operables.** El bloqueo es de demanda **nueva** (alta y disponibilidad). Suspender sin este matiz dejaría las reservas `PENDIENTE`/`CONFIRMADA` de la sede huérfanas: nadie podría confirmarlas, rechazarlas ni cancelarlas. Está escrito en la guarda y en la E2E.
- **422, no 403.** D40 reserva el 403 para «sin permiso»; una sede suspendida es una regla de negocio violada, la misma familia que `RESERVAS_PAUSADAS` (422), y así el contrato `{ statusCode, codigo, mensaje }` queda homogéneo.
- **La guarda dispara con `estado === 'INACTIVO'`, no con `!== 'ACTIVO'`.** Es la misma condición en base porque `barberias_estado_check` (e203) ya fija el catálogo —medido contra `pg_constraint`— y evita que una fila mock sin `estado` dispare un 422 falso. La guarda calla si la sede no existe: la existencia la exige quien necesita sus datos.
- **La guarda de disponibilidad va después de la pertenencia.** Si no, el 422 se convierte en un oráculo para que un cliente de otra sede descubra qué sedes están suspendidas.
- **Auditoría dentro de la transacción.** No puede quedar la sede suspendida sin el evento ni el evento sin la suspensión; es idempotente, así que un estado pedido que ya existe no escribe ni audita.
- **`check-integridad.cjs` intacto.** La medición manda: ya recoge los `*_check` de las migraciones, y demostrarlo en rojo y en verde vale más que una línea de código extra.
- **No se tocó `render.yaml` ni los CHECK existentes** (§5 del plan): esta migración solo añade los dos que faltaban.

## 7. Limitaciones

- **La migración NO está aplicada en `dev`.** `render.yaml` no ejecuta `prisma migrate deploy` (el `startCommand` es `npm run start:prod`), así que el despliegue no la aplicará solo: hay que correr `npx prisma migrate deploy` contra `dev` al merge. Hasta entonces `npm run check:integridad` contra `dev` **fallará a propósito**, listando los dos CHECK y la migración pendiente — es la guardia haciendo su trabajo, no una regresión.
- Las verificaciones corrieron contra Postgres 16 local; el CI usa 15 y `dev` es Neon. Ninguna de las tres migraciones nuevas usa SQL con diferencias de versión (dos `ALTER TABLE … ADD CONSTRAINT`), pero el CI es el que lo confirmará en su versión.
- `npx tsc --noEmit` sobre `src/ test/` sigue reportando errores **preexistentes** de tipos en specs (p. ej. `CreateReservaDto` sin `tipo` en más de veinte tests ya existentes). No los toqué: los gates reales del proyecto son `nest build`, `oxlint` y `vitest`, los tres en verde.
- Fuera de alcance y **sigue abierto**: P-SD-1 (`reactivar` inalcanzable desde la interfaz), P-SD-2 (el `422 SERVICIO_EN_COMBO_ACTIVO` sin salida en el frontend), P-SD-5 (guarda de borrados a nivel de datos), P-SD-6 (vocabulario del frontend), P-SD-7 y P-SD-8 (documentación).
