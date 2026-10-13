INFORME: Sprint de Estabilización — OLA 1 · P1 «Integridad y Despliegue»
RAMA: fix/sprint-estabilizacion-p1 (creada desde `main` @ 7491c90)
BASE: el plan quedó en `main` con el commit `7491c90 docs(estabilizacion): plan de ataque del sprint Camino B`
      (sobre `b3af077`, merge del PR #56 / E4-03).
FECHA: 2026-10-12
RESULTADO: **VERDE — unitarios 43/43 archivos y 474/474 tests · E2E 26/26 archivos y 191/191 tests ·
lint 0 errores · build OK · `check:integridad` OK en `dev` y en una base creada DESDE CERO.**

1. QUÉ HICE (resumen de los 6 pasos pedidos)

   1. `docs/PLAN_SPRINT_ESTABILIZACION.md` quedó guardado en `main` (commit `7491c90`, solo ese archivo).
   2. Rama `fix/sprint-estabilizacion-p1` creada desde ahí.
   3. **Bug de márgenes (registrado como H57):** `margenGrupalMinutos` ya NO se suma al flujo INDIVIDUAL,
      en ninguno de los tres sitios donde se sumaba. Tests unitarios nuevos y ajuste del test de E4-02.
   4. **H50 (Ghost Ledger) por la vía segura:** se recreó físicamente la migración en el repositorio con el
      NOMBRE EXACTO del ledger de `dev` —
      `backend-barberias/prisma/migrations/20261011130000_e203_integridad_base/migration.sql`— con los
      CHECK de integridad base y las dos columnas huérfanas (`barberias.creado_at`, `reservas.completada_at`).
      Además: guardia permanente `npm run check:integridad` + paso nuevo en el CI.
   5. **H47 + `completada_at`:** `registrarPagoEnPersona` ya pasa por `ReservaStateMachine` y exige
      `ahora >= hora_inicio` en la zona de la SEDE antes de marcar COMPLETADA, y fija `completada_at`.
   6. Suite completa: unitarios + E2E, más lint y build (los pasos que corre el CI), y la certificación de
      que una base VACÍA con `migrate deploy` reproduce `dev`.

   **Decisión del dueño sobre D37 aplicada tal cual:** una propuesta o alternativa es estrictamente de SOLO
   LECTURA; mostrar un hueco sugerido no lo retiene ni lo bloquea en la base. No requirió código: es el
   comportamiento ya entregado por E3-08/E4-02 (la alternativa se revalida al confirmar y responde 409 si el
   hueco se ocupó). H41 y D37 quedaron cerrados por decisión en `AUDITORIA_HALLAZGOS.md`.

2. ARCHIVOS TOCADOS (`git diff --stat`, literal, sin este informe)

```
 .github/workflows/ci.yml                           | 10 +++
 AUDITORIA_HALLAZGOS.md                             | 38 ++++++++-
 backend-barberias/package.json                     |  1 +
 backend-barberias/prisma/schema.prisma             |  7 ++
 .../src/pago/application/pago.service.spec.ts      | 98 +++++++++++++++++++++-
 .../src/pago/application/pago.service.ts           | 68 ++++++++++-----
 .../reserva/application/reserva.service.spec.ts    | 74 ++++++++++++++--
 .../src/reserva/application/reserva.service.ts     | 32 ++++---
 .../test/pago-barbero-asignado.e2e-spec.ts         | 47 ++++++++++-
 docs/PLAN_SPRINT_ESTABILIZACION.md                 | 17 +++-
 10 files changed, 344 insertions(+), 48 deletions(-)
```

Archivos NUEVOS (untracked hasta este commit):

```
 backend-barberias/prisma/migrations/20261011130000_e203_integridad_base/migration.sql   117 líneas
 backend-barberias/scripts/check-integridad.cjs                                          183 líneas
```

| Archivo | Cambio |
|---|---|
| `src/reserva/application/reserva.service.ts` | H57: `calcularBloque` suma solo los márgenes de SUS servicios; `bloqueRequeridoParaAlternativas` usa margen de sede **solo** si el flujo es GRUPAL (`else 0`); `margenFinal` igual (`esGrupal ? margenSede : 0`) |
| `src/reserva/application/reserva.service.spec.ts` | 2 casos nuevos: «cotizar un INDIVIDUAL devuelve Σ márgenes de los servicios, nunca el de la sede» (8, no 20) y «D42 intacto: la cotización GRUPAL sí lleva el margen de la sede» (12) |
| `src/pago/application/pago.service.ts` | H47: `ReservaStateMachine.assertTransition(…, COMPLETADA, ACTORES.STAFF)`, condición `ahora >= hora_inicio` en la zona de la sede (422 `CITA_NO_INICIADA`), `data: { estado: COMPLETADA, completadaAt: this.tiempo.ahora() }` |
| `src/pago/application/pago.service.spec.ts` | 4 casos: 409 `ESTADO_INVALIDO` para CANCELADA y para PENDIENTE, 422 `CITA_NO_INICIADA` para la cita futura (y que no se cobra nada), `completadaAt` fijado |
| `test/pago-barbero-asignado.e2e-spec.ts` | Las citas de las pruebas de QUIÉN cobra pasan al pasado (ahora exigen cita iniciada); 2 casos nuevos: 422 con la cita futura (+ `completada_at` NULL y sin pago) y `completada_at` fijado al completar |
| `prisma/schema.prisma` | `Barberia.creadoAt` y `Reserva.completadaAt` (las columnas que solo existían en `dev`) |
| `package.json` | Script `check:integridad` |
| `.github/workflows/ci.yml` | Paso **Check DB Integrity** justo después de `prisma migrate deploy` |
| `AUDITORIA_HALLAZGOS.md` | H50 y H47 → **resueltos**; H41/D37 → **cerrado por decisión**; nuevos H56, H57 (resuelto) y H58 |
| `docs/PLAN_SPRINT_ESTABILIZACION.md` | Estado «aprobado / Ola 1 en ejecución» + corrección del recuento de CHECK |

3. LA MIGRACIÓN RECONSTRUIDA (H50) — qué contiene y por qué con ese nombre

Se reconstruyó `20261011130000_e203_integridad_base/migration.sql` **con el nombre exacto del ledger de
`dev`** (`finished_at = 2026-10-10T20:28:32Z`) para no romper el historial:

* En `dev` su fila ya está aplicada → `migrate deploy` la salta y no recrea nada (desaparece el
  `P3018 / 42701: column "logo_url" ... already exists` que apareció al aplicar E3-13).
* En una base creada desde cero —la del CI incluida— se aplica en su orden cronológico (después de
  `e204_zona_horaria`, antes de `e313`) y produce los MISMOS objetos que `dev`.
* Es idempotente donde hacía falta: `logo_url` ya la declara E3-13 con `ADD COLUMN IF NOT EXISTS`.

Contenido: **15 CHECK de catálogo** + las dos columnas base.

```
barberias_estado_check                    reservas_estado_check
barberias_zona_horaria_check              reservas_tipo_reserva_check
cliente_barberias_estado_vinculacion_check reservas_modo_confirmacion_check
usuarios_estado_cuenta_check              pagos_estado_pago_check
roles_ambito_check                        notificaciones_canal_check
antecedentes_origen_check                 notificaciones_estado_check
antecedentes_estado_validacion_check      excepciones_horario_tipo_check
excepciones_horario_barbero_tipo_check
```

Más `ALTER TABLE "barberias" ADD COLUMN "creado_at" TIMESTAMPTZ DEFAULT now()` y
`ALTER TABLE "reservas" ADD COLUMN "completada_at" TIMESTAMPTZ`.

**Guardia permanente (`scripts/check-integridad.cjs`, 183 líneas, solo lectura).** Compara en las DOS
direcciones (a) las migraciones del repo contra el ledger `_prisma_migrations` y (b) los `CONSTRAINT
"..._check"` declarados en `prisma/migrations/**` contra `pg_constraint`. Resuelve el esquema desde el
`?schema=` de la URL (nunca desde `current_schema()`, por el pooler). Sale con 1 y un informe legible si
hay cualquier diferencia; el CI lo corre tras `migrate deploy`, que es el único sitio donde una base limpia
puede demostrar que los CHECK se aplican de verdad (`prisma migrate diff` NO modela los CHECK).

4. PRUEBAS Y EVIDENCIA (salidas literales)

4.1 · Suite unitaria completa — `APP_ENV=dev npx vitest run` (backend)

```
 Test Files  43 passed (43)
      Tests  474 passed (474)
   Duration  10.86s
```

(En `main` eran 470; +4 casos nuevos: 2 de márgenes y 4 de pago menos 2 que se reescribieron.)

4.2 · Suite E2E completa — `APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts`

```
 Test Files  26 passed (26)
      Tests  191 passed (191)
   Duration  679.16s
EXIT_E2E=0
```

(Incluye los 2 casos nuevos de `test/pago-barbero-asignado.e2e-spec.ts` y la carrera de E3-03
«10 solicitudes simultáneas al mismo hueco → exactamente una 201 y nueve 409», 12,4 s.)

4.3 · Lint y build (los pasos que corre el CI antes de las pruebas)

```
npm run lint   → Found 55 warnings and 0 errors.  (193 archivos, oxlint --type-aware)   EXIT=0
npm run build  → nest build                                                            EXIT=0
```

4.4 · Certificación de que el CI **ahora sí** ejerce los CHECK (base creada DESDE CERO)

Se creó una base vacía sobre el mismo Neon, pero por el **host directo** (sin pooler) y en un esquema
aparte, para no tocar `dev`:

```
>> 1) prisma migrate deploy sobre una base VACÍA
Applying migration `20260916223855_init` ... (10 migraciones, en orden)
Applying migration `20261011130000_e203_integridad_base`
All migrations have been successfully applied.
>> migrate deploy EXIT=0
>> 2) guardia de integridad contra esa base recién creada
[check:integridad] OK — 10 migraciones y 27 CHECK coinciden con el esquema «e203_fresh_check».
```

El esquema temporal se eliminó después (`DROP SCHEMA e203_fresh_check CASCADE`), con `dev` intacto. Esto es
exactamente lo que hará el job del CI con su Postgres limpio: antes de este arreglo, esa base nacía SIN los
15 CHECK y sin las dos columnas, y el verde del CI solo probaba el código contra una base permisiva.

4.5 · Estado del ledger y del catálogo en `dev` (solo lectura)

```
npx prisma migrate status
  10 migrations found in prisma/migrations
  Database schema is up to date!

npm run check:integridad
  [check:integridad] OK — 10 migraciones y 27 CHECK coinciden con el esquema «public».
```

Antes de este sprint, ese mismo comando reportaba la fila fantasma («aplicada pero NO está en el repo») y los
CHECK que solo existían en `dev`.

5. CORRECCIÓN DE RECUENTO (14 → 15 CHECK; 19 → 27 en total)

El plan aprobado hablaba de **14** CHECK ausentes y de **19** en `dev`. El recuento verificado hoy contra
`pg_constraint` es:

* `dev` tiene **27 CHECK** en `public` (contype `c`).
* De ellos, **12** ya estaban declarados en el repo (margen grupal, motivos/estado de rechazo, cancelación
  especial, propuestas de horario y solicitudes de cambio) y **15** solo vivían en `dev`.
* El que faltaba en la lista del plan era `excepciones_horario_barbero_tipo_check` (tabla creada en
  `20261001000000_fix_missing_tables`). La fila «19 CHECK» era una lectura incompleta del mismo catálogo.

La migración reconstruida declara los 15; `check:integridad` compara los 27 en las dos direcciones, así que
cualquier divergencia futura —en el repo o en la base— sale en rojo.

6. HALLAZGOS NUEVOS REGISTRADOS (detalle en `AUDITORIA_HALLAZGOS.md`)

* **H56 — `barberias_zona_horaria_check` fija la zona a UN literal** (`= 'America/Santo_Domingo'`). Hoy es
  inocuo (nadie escribe la columna) pero deja inutilizable la capacidad de `luxon`/E2-04 para otra zona
  IANA. NO se cambió a propósito: hacerlo en la misma migración que cierra la divergencia habría vuelto a
  separar el repo de `dev`. Queda como migración propia, a decisión del dueño.
* **H58 — las consultas SQL crudas resuelven `"barberias"` por `search_path`.** Los 9 `tx.$queryRaw`
  del bloqueo pesimista citan el nombre entre comillas pero sin esquema. El pooler de Neon reutiliza
  sesiones: una verificación de este mismo sprint que trabajó en un esquema temporal dejó conexiones del
  pool apuntando a un esquema ya eliminado y los E2E devolvieron `P3010 / 42P01: relation "barberias" does
  not exist` (500) hasta que el pool recicló. Costó dos corridas de E2E **falsamente** rojas (la carrera de
  E3-03 dio 1×201 + 8×409 + 1×500 en lugar de 9×409). Remedio propuesto: calificar el esquema en las
  consultas crudas o fijar `?schema=public` en la URL del pooler. Regla operativa mientras no se toque: no
  usar esquemas temporales sobre una base compartida por el pooler.

7. LO QUE **NO** SE HIZO EN ESTA OLA (para que no se lea como cerrado)

* **P1.3 · higiene de despliegue y secretos (H30, H26, H27):** intacta. `DEFAULT_DEV_JWT_SECRET` sigue como
  fallback y `debugToken` sigue dependiendo de `NODE_ENV !== 'production'`.
* **P1.4 · certificación de «3 corridas consecutivas» de la E2E en `main`:** hecha **una** corrida canónica
  completa (4.2). Las tres consecutivas siguen pendientes.
* **De E3-09 quedan fuera:** la ruta `PATCH /barberias/:barberiaId/pagos/:id` para corregir un pago mal
  registrado y la verificación de que las métricas de ingresos cuentan solo `PAGADA`.
* **Frontend:** no se tocó.
* **No se abrió PR:** la rama queda empujada para que la revises; el merge a `main` es tuyo.

8. RIESGOS RESIDUALES QUE VIGILAR

1. Los datos YA creados conservan el pacto histórico: las reservas individuales anteriores siguen con su
   `margen_grupal_historico` (10 min). El fix solo cambia lo nuevo; las tres rutas posteriores (aceptar,
   reprogramar) lo siguen respetando a propósito.
2. Los CHECK están ahora activos en cualquier base nueva. H49 ya demostró que los datos de prueba y el
   código de producción deben respetar los catálogos; si un E2E nuevo inserta fuera de catálogo, fallará en
   el CI con `23514` (y ese es el comportamiento deseado).
3. H58: mientras el pooler de Neon siga sirviendo sesiones con `search_path` heredado, cualquier cliente que
   use un esquema distinto puede envenenar temporalmente las conexiones de los demás.

9. CÓMO REPRODUCIR (comandos literales)

```
APP_ENV=dev npx vitest run                                   # unitarios (43/474)
APP_ENV=dev npx vitest run --config ./vitest.config.e2e.ts    # E2E (26/191)
npm run lint                                                  # 0 errores
npm run build                                                 # nest build
npm run check:integridad                                      # contra la base de DATABASE_URL
npx prisma migrate status                                     # 10 migraciones · up to date
```
