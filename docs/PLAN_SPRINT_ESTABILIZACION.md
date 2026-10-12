# Plan de Ataque — Sprint de Estabilización (Camino B)

> **Estado:** propuesta para aprobación. **No se ha escrito código, ni migraciones, ni commits.**
> **Base:** `main` = `b3af077` (merge del PR #56, E4-03). Árbol de trabajo limpio.
> **Fuentes del inventario:** [`AUDITORIA_HALLAZGOS.md`](AUDITORIA_HALLAZGOS.md),
> [`TAREAS_CIERRE_AUDITORIA.md`](TAREAS_CIERRE_AUDITORIA.md),
> [`docs/BACKLOG_BARBERIAS_V1.md`](docs/BACKLOG_BARBERIAS_V1.md) y los reportes `reporte-*.md`
> de E2-02, E2-04, E3-03…E3-13 y E4-01…E4-03.
> **Fecha del diagnóstico:** 2026-10-12.

---

## 1. Estado comprobado hoy (no heredado de reportes)

| Comprobación | Comando | Resultado |
|---|---|---|
| Suite unitaria en `main` | `npm test` (backend) | `43 archivos / 470 tests`, `EXIT=0` |
| Estado del ledger | `npx prisma migrate status` | `9 migrations found in prisma/migrations` · `Database schema is up to date!` |
| Ledger real de `dev` (lectura directa a `_prisma_migrations`) | consulta read-only | **12 filas**, incluida **`20261011130000_e203_integridad_base` (finished `2026-10-10 20:28`)** que **no existe en disco**; más 2 pares `rolled_back + applied` (`add_margen_grupal_minutos`, `e313_solicitudes_cambio_barberia`) |
| CHECK en `dev` (`pg_constraint`) | consulta read-only | **19 CHECK**; **14 de ellos no están declarados en ninguna migración del repo** |
| Suite E2E completa | — | **no re-ejecutada en esta sesión** (último verde: 26 archivos / 189 tests en la rama de E4-03) |

**Consecuencia dura del punto anterior:** una base creada desde cero con `prisma migrate deploy`
**no reproduce `dev`**. Le faltan los 14 CHECK de integridad base (E2-03) y, hasta hoy, el CI
—que usa un Postgres limpio por job— **nunca los ha ejercitado**. El verde del CI no prueba el
catálogo de integridad; prueba el código contra una base permisiva.

Los 14 CHECK ausentes del repo (presentes en `dev`):

```
barberias_estado_check                        reservas_estado_check
barberias_zona_horaria_check                  reservas_tipo_reserva_check
cliente_barberias_estado_vinculacion_check    reservas_modo_confirmacion_check
usuarios_estado_cuenta_check                  pagos_estado_pago_check
roles_ambito_check                            notificaciones_canal_check
antecedentes_origen_check                     notificaciones_estado_check
antecedentes_estado_validacion_check          excepciones_horario_tipo_check
```

En el repo sí están declarados (por tanto no son problema): `configuracion_barberia_margen_grupal_minutos_check`,
`reservas_motivo_codigo_check`, `reservas_motivo_otro_detalle_check`,
`reservas_cancelacion_especial_{estado,motivo,otro_detalle}_check`,
`propuestas_horario_{tipo,estado}_check` y `solicitudes_cambio_barberia_*`.

### 1.1 Inventario de hallazgos abiertos (H-IDs)

| ID | Severidad | Qué es | Estado comprobado hoy |
|---|---|---|---|
| **H50** | Media-Alta | Ledger de `dev` registra una migración que el repo no tiene + columna huérfana | **ABIERTO.** Sigue la fila fantasma. La mitad «columna huérfana» está mitigada (`logo_url` ya en esquema como `@db.Text` y en la migración de E3-13 con `IF NOT EXISTS`) |
| **H47** | Media | `pago.service` marca `COMPLETADA` sin pasar por la máquina de estados | **ABIERTO.** `pago.service.ts:179` escribe `data: { estado: ESTADOS.COMPLETADA }` directo |
| **H52** | Media | Falta la ventana de 15 min del no presentado (§5.2 fila 12) | **ABIERTO.** No existe `PUNTUALIDAD_MARGEN_MIN`/`TOLERANCIA_MIN`; `FUERA_DE_VENTANA` solo lo usa la ventana de **cancelación** de 30 min (`reserva.service.ts:1646`) |
| **H54** | Media | El cliente nunca ve su advertencia ni su restricción | **ABIERTO.** `grep mi-estado src/` → 0 coincidencias; `evaluarInasistencia` calcula `advertencia` y nadie la expone |
| **H41** | Media | La propuesta de horario NO retiene el hueco que D37 manda retener | **ABIERTO** (decisión D37) |
| **H42** | Baja | `PROPUESTA_PENDIENTE` sin productor y propuestas que caducan en diferido | **ABIERTO** |
| **H43** | Baja | `SOLICITADA`/`RECHAZADA` de cancelación especial nunca se escriben (flujo D17 del cliente) | **ABIERTO** |
| **H44** | Informativa | La cancelación especial del staff no exige estar fuera de la ventana de 30 min | **ABIERTO** — a decisión del dueño |
| **H48** | Baja | El recordatorio de 1 h no tiene `jobId` determinístico y no se puede cancelar | **ABIERTO.** `notificacion.service.ts:96` encola `recordatorio-cita` sin `jobId` |
| **H22** | Media | `src/cliente/` contenido, con 7 defectos; ficha del cliente no existe | **ABIERTO.** `src/cliente/` sigue en el repo; `ClienteModule` no está en `app.module.ts` |
| **H26** | Media | Clave JWT de desarrollo hardcodeada usada como fallback | **ABIERTO.** `iam.config.ts:41` → `return secret \|\| DEFAULT_DEV_JWT_SECRET` |
| **H27** | pendiente | `auth.service` devuelve `debugToken` cuando `NODE_ENV !== 'production'` | **ABIERTO.** `auth.service.ts:265` |
| **H28** | Baja | Dos E2E dependen de datos sembrados | **ABIERTO** |
| **H29** | Baja | Lockfiles por proyecto congelados desde el commit inicial | **ABIERTO.** `backend-barberias/package-lock.json` tocado por **1** commit; el de la raíz por **8** |
| **H30** | Media | Build Command de Render distinto del que declara el repo | **ABIERTO** (verificación en panel) |
| **H32** | Baja | No existe `informacion_adicional` y `limpiarInformacionAdicional` es un no-op | **ABIERTO.** Confirmado: 0 coincidencias en esquema; `reserva.service.ts:2359` |
| **H34** | Informativa | Comentarios corruptos en `roles.ts` (líneas 75 y 107) | **ABIERTO** |
| **H45** | Media | Resto del catálogo de estados | **PARCIAL.** Código ya usa `NO_PRESENTADO`; `src/cliente/application/cliente.service.ts` sigue citando `NO_ASISTIO`/`CANCELADA_TARDE` (se cierra con E4-05) y la normalización de datos históricos sigue pendiente de E2-03/4 |
| **H51** | Baja | Rutas con `:id` fuera del acotado por tenant del `RolesGuard` | **MITIGADO** (comprobación de servicio). Queda como candidato a renombrar `:id` → `:barberiaId` |
| **H53** | Informativa | La ruta del perdón se llamó `reactivar` en vez de `restriccion/levantar` | **CUBIERTO con otro nombre** |
| **H55** | Informativa | Los motivos ya guardados conservan el texto viejo | **PARCIAL** (solo afecta a filas futuras; sin migración de textos) |

### 1.2 Tareas del backlog sin cerrar (o cerradas a medias)

| Tarea | Estado comprobado |
|---|---|
| **E2-01** (diseño v2) | **Pendiente:** `docs/diseno/` **no existe** |
| **E2-03** (integridad base) | **Pendiente:** es el origen de los 14 CHECK ausentes; además `reservas.completada_at` **no existe** (grep 0 en esquema y migraciones) |
| **E2-05** (margen sumado, D01) | **A verificar:** `calcularBloque` suma los márgenes de los servicios **y añade `margenGrupalMinutos` también en el flujo INDIVIDUAL** (`reserva.service.ts:193`), lo que merece contraste con D42/§5.4 |
| **E2-06** (estabilizar E2E) | **Parcial:** `testTimeout: 30_000` y `fileParallelism: false` hechos (H38); **faltan** prefijos `e2e_` con limpieza en `afterAll`, el test de carrera real y el renombre de `test-sec01-recovery.ts` |
| **E2-07** (vocabulario) | **Pendiente:** siguen 4 `@Delete`: `agenda.controller.ts:84`, `barberia.controller.ts:178`, `combos.controller.ts:73`, `servicios.controller.ts:76` |
| **E2-08** (matriz de cumplimiento) | **Pendiente:** no existe `docs/MATRIZ_CUMPLIMIENTO.md` |
| **E3-09** (pago/COMPLETADA) | **Pendiente** salvo «quién cobra»: ver H47 y la fila de P1.2 |
| **E3-10** (no presentado) | **Parcial:** falta la ventana de 15 min (H52) y el renombre de la ruta a `.../no-presentado` (hoy `POST :id/inasistencia`, `reserva.controller.ts:250`) |
| **E4-02** (oportunidades) | **Parcial:** el Carril A (alternativas) y el endpoint de huecos están; **D22 proactivo no existe** — `oportunidad` solo aparece en la lectura de disponibilidad y en la bandera de configuración; no hay job ni processor |
| **E4-03** (fidelización) | **Parcial:** entregados el contador, la restricción, el 403 y el perdón directo; **faltan** `mi-estado` (H54), el flujo cliente-iniciado con `solicitudes_reactivacion` y `PATCH /plataforma/usuarios/:id/estado` (**ausente**: solo hay `POST/GET` de pagos y ninguna ruta de plataforma de usuarios) |
| **E4-04** (información adicional) | **Pendiente** (H32) |
| **E4-05** (`src/cliente/`) | **Pendiente** (H22) |

### 1.3 Deuda de higiene detectada ahora (no estaba en el inventario)

1. **Spec de borrador commiteado:** [`test/e4-02-oportunidades.clean.e2e-spec.ts`](backend-barberias/test/e4-02-oportunidades.clean.e2e-spec.ts)
   (52 líneas, un solo `it('flujo básico')`) entró en el mismo commit que el spec real de E4-02.
2. **Dos archivos de prueba que ningún glob ejecuta:** `test/test-sec01-recovery.ts` y
   `test/smoke-test-live.ts` (no terminan en `.spec.ts`/`.e2e-spec.ts`).
3. **DTO duplicado y muerto:** `CreateReservaDto` está declarado otra vez en
   [`cotizacion.dto.ts`](backend-barberias/src/reserva/application/dto/cotizacion.dto.ts) (H-N1 de E4-01).
4. **Reporte obsoleto:** [`reporte-e4-02.md`](reporte-e4-02.md) declara 2 unitarios y 2 E2E en rojo;
   hoy `main` tiene 470/470 en verde. Nunca se refrescó.
5. **Auditoría desincronizada:** H52–H55 existen **solo** en [`reporte-e4-03.md`](reporte-e4-03.md);
   no están registrados en `AUDITORIA_HALLAZGOS.md`.
6. **Backlog sin marcar:** el archivo tiene **4** casillas `- [x]` en total, así que no refleja lo entregado.

---

## 2. Plan de Ataque priorizado

Tres olas. **Ninguna tarea arranca sin su criterio de aceptación y su evidencia** (la regla de
`TAREAS_CIERRE_AUDITORIA.md`: se marca `[x]` cuando la evidencia existe, no cuando «debería funcionar»).

### 🔴 PRIORIDAD 1 — Integridad y Despliegue

> Nada de esto es cosmético: son las cosas que hacen que «funciona» dependa de una base concreta
> y que un despliegue limpio se comporte distinto del entorno donde probamos.

#### P1.1 · H50 + E2-03 · Reconstruir `e203_integridad_base` y cerrar el drift de los 19 CHECK

**Problema:** `dev` tiene 19 CHECK y 12 filas de ledger; el repo tiene 9 migraciones y 5 CHECK propios.
Una base nueva no reproduce `dev`, y `prisma migrate diff` **no ve los CHECK** (nota de H37), así que
el drift es invisible para la herramienta estándar.

**Pasos (en este orden, cada uno verificable):**
1. **Auditoría read-only previa** (exigida por E2-03/4): `SELECT DISTINCT` de los valores reales de
   `reservas.estado`, `reservas.tipo_reserva`, `reservas.modo_confirmacion`, `barberias.estado`,
   `cliente_barberias.estado_vinculacion`, `usuarios.estado_cuenta`, `pagos.estado_pago`,
   `roles.ambito`, `notificaciones.canal/estado`, `excepciones_horario.tipo`, `antecedentes.origen/estado_validacion`.
   Si aparece un valor fuera de catálogo, **parar y reportar** (no «arreglarlo» en silencio).
2. **Recrear la migración en el repo con el nombre EXACTO que ya tiene el ledger**
   (`20261011130000_e203_integridad_base`). Es la clave para no repetir H37/H49: el ledger de `dev`
   conserva la identidad de su fila y las bases nuevas reciben los mismos objetos. No se borra la fila
   a mano ni se usa `db push`.
3. **Incluir en la misma migración** los pendientes de E2-03: `reservas.completada_at TIMESTAMPTZ NULL`
   y, si falta, `barberias.creado_at` (en `dev` ya existe: `timestamp with time zone`, nullable).
   Los CHECK se añaden con su `CHECK` nominal, `NOT VALID` → `VALIDATE CONSTRAINT` si hay datos.
4. **Sincronizar `schema.prisma`** donde corresponda (columnas como `String`, sin enums muertos; el
   `git grep` de literales de estado ya lo cubrió E2-02).
5. **Guardia permanente** (`npm run check:integridad` o paso de CI): script que compare los CHECK
   declarados en `prisma/migrations` contra `pg_constraint` de la base objetivo y falle si divergen.
   Es el único remedio de fondo contra H37/H49/H50 —`migrate diff` no basta—.
6. **Aplicar en `dev`** con `migrate deploy` y volver a correr la suite.

**Aceptación:**
- [ ] Una base creada desde cero con `migrate deploy` tiene **los 19 CHECK** y `completada_at`.
- [ ] `_prisma_migrations` de `dev` sin filas extra respecto de `prisma/migrations` (salvo los
  `rolled_back` históricos, que se documentan o se limpian con criterio).
- [ ] `prisma migrate status` → `up to date` **y** `check:integridad` → sin diferencias.
- [ ] Suite unitaria y E2E verde; y el CI (Postgres limpio) **ahora sí** ejerce los CHECK.

#### P1.2 · H47 + E3-09 · El cobro no puede saltarse la máquina de estados

**Problema:** una reserva `PENDIENTE` (nunca aceptada) puede pasar a `COMPLETADA` por un cobro, y el
ingreso entra sin haber cumplido la condición temporal de §5.2 fila 11. Además `completada_at` no existe
(se crea en P1.1) y no hay ruta para corregir un pago mal registrado.

**Pasos:** `registrarPagoEnPersona` valida `CONFIRMADA → COMPLETADA` **desde `hora_inicio`** con
`ReservaStateMachine` y fija `completada_at`; añadir `PATCH /barberias/:barberiaId/pagos/:id
{estadoPago, motivo}` auditado (valor anterior, nuevo y motivo, `monto` no editable); y verificar que
las métricas de ingresos cuentan **solo `PAGADA`**.

**Aceptación:**
- [ ] Cobro antes de `hora_inicio` → **422** (no 201).
- [ ] Corregir `PAGADA ↔ PENDIENTE_DE_PAGO` deja evento de auditoría con anterior/nuevo/motivo.
- [ ] El total de ingresos excluye `PENDIENTE_DE_PAGO` (test).
- [ ] Rojo → verde del E2E de pago existente (`pago-barbero-asignado`) sin regresión.

#### P1.3 · H30 + H26 + H27 · Higiene de despliegue y de secretos

**Pasos:**
1. **H30:** documentar el `Build Command` real del panel de Render y alinearlo con `render.yaml`
   (`rm -f ../package.json && npm install --include=dev && npm run build`). El `postinstall` del backend
   **no genera el cliente Prisma**; hay que confirmar que el despliegue hace `npx prisma generate` como
   hace el CI.
2. **H26:** eliminar el fallback `secret || DEFAULT_DEV_JWT_SECRET` fuera de `development` explícito
   (o exigir la variable siempre).
3. **H27:** que `debugToken` no pueda salir con `NODE_ENV` no-productivo mal puesto (p. ej. ligarlo a una
   bandera explícita de depuración, no al entorno).

**Aceptación:**
- [ ] Valor del panel documentado en `docs/ENTORNOS.md` y coincidente con `render.yaml`.
- [ ] `grep DEFAULT_DEV_JWT_SECRET` sin consumidores en el camino de arranque.
- [ ] Test que fija que la respuesta de `forgot-password` **no** lleva `debugToken` con la configuración por defecto.

#### P1.4 · Cerrar la certificación de «0 fallos»

**Pasos:** correr la **suite E2E completa en `main`** (el último verde fue en la rama de E4-03, no en `main`),
tres veces consecutivas como pide E2-06, y dejar registrada la corrida canónica (comando + tiempo + conteos)
en el reporte del sprint.

**Aceptación:**
- [ ] **3** ejecuciones consecutivas de la suite E2E completa en verde, sobre `main`.
- [ ] CI en verde con el paso de `check:integridad` (P1.1/5) ya integrado.

---

### 🟠 PRIORIDAD 2 — Brechas de negocio

#### P2.1 · H52 + E3-10 · La ventana de 15 minutos del no presentado

`PUNTUALIDAD_MARGEN_MIN = 5` + `TOLERANCIA_MIN = 10`; `marcarInasistencia` exige origen `CONFIRMADA`
(ya lo hace la máquina) **y** `ahora ≥ inicio + 15 min` en la zona de la sede; si no → **422
`FUERA_DE_VENTANA`**. Renombrar la ruta a `POST .../reservas/:id/no-presentado` (E3-10/1) y decidir si la
vieja queda como alias deprecado.
**Aceptación:** a los **14** min → 422; a los **16** → contador +1; la restricción en A no afecta a B.

#### P2.2 · H54 + E4-03/2 · Que el cliente VEA su estado

`GET /barberias/:barberiaId/mi-estado` (CLIENTE vinculado) con `estadoVinculacion`,
`contadorNoPresentado`, `estaRestringido`, `motivoRestriccion`, `advertencia` (cierta con 3+) y `reactivacion`.
Más la notificación de advertencia a las 3 inasistencias (E3-10/3). Regla: **nunca** datos de otras sedes.
**Aceptación:** 3 inasistencias → `advertencia: true` sin restricción; 5 → `estaRestringido` + motivo; sin
vinculación → 403/404 sin filtrar.

#### P2.3 · H53 + E4-03/3 + D21 · Reactivación iniciada por el cliente

Tabla `solicitudes_reactivacion` (patrón D26, con `CHECK` e índice único parcial por
`(barberia_id, cliente_id, estado)`), `POST .../restriccion/solicitar {motivo}` (422 `SIN_RESTRICCION`,
422 `REACTIVACION_PENDIENTE`) y `POST .../restriccion/reactivacion/resolver {aprobar, motivo?}`; al aprobar
se limpia la bandera y **se CONSERVA el contador (D21)**. Hay que **decidir la convivencia** con el
`reactivar` directo ya entregado, que **reinicia** el contador: lo coherente es documentarlo como dos
acciones distintas (perdón directo de la sede = reinicia; resolución de la solicitud = conserva).
**Aceptación:** solicitar sin estar restringido → 422; aprobar conserva `contador_no_presentado`;
segunda solicitud pendiente → 422 `REACTIVACION_PENDIENTE`.

#### P2.4 · E4-03/5 + D09/D24 · Suspensión de cuenta (manual, motivada y auditada)

`PATCH /plataforma/usuarios/:id/estado {estadoCuenta, motivo}` solo ADMINISTRADOR, motivo obligatorio
(422 sin él), sube `token_version` al suspender y audita anterior/nuevo. **Comprobado: la ruta no existe.**
**Aceptación:** suspender cierra las sesiones; el login conserva el mensaje descriptivo del HALLAZGO 12;
test explícito de que **ningún camino automático** escribe `estado_cuenta`.

#### P2.5 · E4-02/5 + H41 + H42 · Oportunidad de espacio (D22) y propuestas

Tres piezas, en este orden: (a) **retener el hueco de la propuesta** o bajar la divergencia D37/H41 a
decisión escrita; (b) **disparo proactivo** al liberarse un hueco (cancelación de `CONFIRMADA`, cancelación
especial, bloqueo liberado) con elegibles de D22, ≤ 25, sin duplicados, sin el que canceló, excluyendo
restringidos y solapes, y **un job idempotente** por hueco; (c) **productor de `PROPUESTA_PENDIENTE`** o
expiración real por job (H42).
**Aceptación:** cancelación con 3 elegibles → 3 notificaciones y ninguna duplicada al reejecutar; sede con
la bandera en falso → 0 notificaciones; reejecución del job idempotente.

#### P2.6 · H32 + E4-04 · `informacion_adicional`

Migración con la columna, DTO y UI de captura, y convertir `limpiarInformacionAdicional` de no-op en
borrado real al entrar en los estados terminales de §E3-04/5 y §E3-05/5.
**Aceptación:** rechazar/expirar → la columna queda a `NULL` (test); el borrado ocurre en la misma transacción.

#### P2.7 · H22 + E4-05 · `src/cliente/` y la ficha del cliente

Rehacer el módulo (7 defectos: IDOR por `x-barberia-id`, rol `ADMIN` inexistente, estados inexistentes,
nota autoaprobada…), registrarlo en `AppModule`, quitar los literales `NO_ASISTIO`/`CANCELADA_TARDE` (resto
de H45), actualizar `docs/MATRIZ_RUTAS.md` y el spec `app.module.spec.ts` que hoy fija que **no** está
registrado.
**Aceptación:** ficha con aislamiento por sede probado; las dos rutas dejan de responder 404.

#### P2.8 · H43 + H44 + E2-01 · Decisiones y contrato

Decidir (dueño) si la cancelación especial se limita al tramo de < 30 min (H44) y si se implementa el flujo
D17 del cliente (`SOLICITADA`/`RECHAZADA`, H43); cerrar con `docs/diseno/01_Especificacion_v2.md` y
`02_Arquitectura_v2.md` de E2-01, que hoy **no existen** y son la base contractual de todo lo demás.

---

### 🟢 PRIORIDAD 3 — Limpieza y deuda técnica

| # | Tarea | Evidencia / criterio |
|---|---|---|
| P3.1 | Borrar o fusionar el spec de borrador `test/e4-02-oportunidades.clean.e2e-spec.ts` | 52 líneas, un solo `it('flujo básico')`; su cobertura la da el spec real |
| P3.2 | Eliminar el `CreateReservaDto` duplicado de `cotizacion.dto.ts` (H-N1) | Un solo import vivo; trampa latente de edición |
| P3.3 | Decidir el destino de `test-sec01-recovery.ts` y `test/smoke-test-live.ts` (renombrar a spec o extraer de `test/`) | Hoy **ningún** glob los ejecuta; se declaran verdes sin prueba |
| P3.4 | H28 + E2-06/2-4: prefijo `e2e_` + limpieza en `afterAll` + **test de carrera real** (10 `Promise.all` → 1×201 / 9×409) | Los dos E2E que dependen del seed dejan de fallar en BD vacía |
| P3.5 | H34 (comentarios corruptos de `roles.ts`, líneas 75 y 107) y revisar la observación de `calcularBloque` (P1 de E2-05: el margen **grupal** se suma también en el flujo individual) | `grep -n "laractable\|yailtersan"`; contraste con D42/§5.4 |
| P3.6 | H29: borrar o regenerar los lockfiles por proyecto (el CI usa el de la raíz) | `git log -- <archivo>` = 1 commit vs 8 del de la raíz |
| P3.7 | H48: `jobId` determinístico del recordatorio + la mitad «cancelar el recordatorio» de §E3-07/4 | `CANCELAR_JOBS` ya declara la intención; hoy no es ejecutable |
| P3.8 | E2-07 (4 `@Delete` → `PATCH :id/desactivar`/`reactivar`) y E2-08 (`docs/MATRIZ_CUMPLIMIENTO.md`) | `grep @Delete` = 4 rutas; el documento no existe |
| P3.9 | Reconciliación documental: registrar **H52–H55** en `AUDITORIA_HALLAZGOS.md`, refrescar el reporte obsoleto de E4-02, marcar el backlog | Hoy el backlog tiene 4 `- [x]`; H52-H55 viven solo en un reporte |
| P3.10 | H51: evaluar renombrar `:id` → `:barberiaId` en las rutas que lo permitan | Reduce la dependencia de que el servicio recuerde el 403 |

---

## 3. Secuencia propuesta (3 olas)

| Ola | Contenido | Por qué en este orden |
|---|---|---|
| **Ola 1 — Cimientos (P1.1 → P1.4)** | Migración de integridad, `completada_at`, guardia de drift, higiene de despliegue, 3 corridas E2E | Todo lo demás añade tablas y columnas: si se migra antes de cerrar el drift, se apilan dos derivas (H37 → H49 → H50 ya pasó dos veces) |
| **Ola 2 — Negocio (P2.1 → P2.8)** | Ventana de 15 min, `mi-estado`, reactivación cliente, suspensión de cuenta, D22, E4-04, E4-05, decisiones y diseño v2 | Cierra las brechas que los reportes declaran «documentadas pero ausentes»; P2.1 y P2.6 dependen de la migración de la Ola 1 |
| **Ola 3 — Higiene (P3)** | Specs basura, DTO duplicado, specs huérfanos, H28, comentarios, lockfiles, documentación | No bloquea nada; se hace con la suite ya estable para que cada cambio tenga una comparación limpia |

**Cierre del sprint (DoD):** CI verde sobre una base **con los 19 CHECK ejercitados**; 3 corridas E2E
completas en verde; ledger sin filas fantasma; `check:integridad` sin diferencias; el cliente ve su
advertencia; ningún camino automático escribe `usuarios.estado_cuenta`; y el backlog + `AUDITORIA_HALLAZGOS.md`
reflejan lo real.

---

## 4. Riesgos y decisiones que necesito de ti

1. **Recrear `e203_integridad_base` con el nombre del ledger** (mi recomendación) frente a crear una
   migración nueva con otro nombre y limpiar la fila fantasma. La primera conserva la identidad en `dev`;
   la segunda deja `dev` limpio pero exige tocar `_prisma_migrations` a mano (ya salió mal en H40).
2. **Alcance de P1.2:** ¿entra la corrección de pagos (`PATCH .../pagos/:id`) en este sprint o se limita
   a la transición + `completada_at`?
3. **D37/H41:** ¿se retiene el hueco de la propuesta (como manda D37) o se aprueba la divergencia actual?
   Cambia si P2.5 empieza por (a) o directamente por (b).
4. **`reactivar` vs solicitud aprobada:** ¿mantengo las dos acciones (directa = reinicia contador;
   aprobada = conserva) o unifico en una sola semántica?
5. **E2-05/`calcularBloque`:** confirmar si el margen grupal debe sumarse en reservas **individuales**
   (hoy sí lo hace, `reserva.service.ts:193`). Si no debe, es un cambio de una línea y un test.

> Sin `push`, sin `merge` y sin commits: este documento es el único artefacto de esta sesión.
