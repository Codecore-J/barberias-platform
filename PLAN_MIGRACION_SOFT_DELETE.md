# PLAN_MIGRACION_SOFT_DELETE.md

**Tarea:** E2-07 · Transición a soft-deletes («Phase-Out» del borrado físico).
**Fecha:** 2026-10-14 (análisis) · 2026-10-15 (cierre) · **Rama de este documento:** `fix/soft-delete-gaps`, con `origin/main` = `33f2690` ya fusionado.
**Estado:** **análisis y ejecución.** Las Fases 1-3 y §4-§6 se conservan tal como se aprobaron (el texto largo es el bueno); §4.1 registra qué fue de cada punto. **Ejecutados: P-SD-1, P-SD-2, P-SD-3, P-SD-4, P-SD-6 y P-SD-7.** **Abiertos: P-SD-5** (la guarda de vocabulario sigue sin cubrir el nivel de datos ni el frontend: medido, no heredado) **y P-SD-8.**

---

## 0 · Veredicto de la premisa (leer antes de la Fase 1)

El encargo parte de que las cuatro rutas `@Delete` siguen vivas, con clientes activos (el frontend entre ellos), y de
que hay que hacer una transición dual para no romper producción. **Comprobado contra el repositorio antes de diseñar
nada: esa premisa ya no se sostiene.** E2-07 se ejecutó **completo** en la Ola 3 del sprint de estabilización
(`432c372`, informe `63fde8b`) y **está en `origin/main`**.

Evidencia medida hoy (los comandos están en §6):

```
grep -rn "@Delete" src/              → 0 coincidencias (exit 1)
grep -rn "desactivar|reactivar|liberar" src/ --include=*.controller.ts
                                     → servicios.controller.ts:83,99 · combos.controller.ts:77,88
                                       barberia.controller.ts:183 · agenda.controller.ts:101
git branch -r --contains 432c372     → incluye origin/main
```

Consecuencia práctica: este documento **no es un plan para ejecutar E2-07** —eso ya está hecho, probado y en `main`—,
sino las tres cosas que el encargo sí puede aportar todavía:

1. La **verificación de impacto** pedida, con el estado real de rutas, esquema y consumidores (Fase 1).
2. Las **respuestas de diseño** con lo que ya existe en el esquema, incluido lo que **falta** (Fase 2).
3. El plan de **la mitad que no se cerró** (Fase 3 + §4), que resultó ser otro trabajo: la vuelta atrás desde la
   aplicación, la trazabilidad de la suspensión de la sede, la propagación a las reservas abiertas, el vocabulario del
   frontend y la guarda a nivel de datos.

> Aviso de fidelidad: un documento del repo sigue describiendo lo contrario —`docs/PLAN_SPRINT_ESTABILIZACION.md:92`
> dice «**E2-07** (vocabulario) · **Pendiente:** siguen 4 `@Delete`»—, pero es una foto del arranque del sprint: la
> misma tabla, unas líneas más abajo, marca P3.8 como ejecutado. Queda anotado en §4 como deuda documental.

---

## Fase 1 · Análisis de impacto (reconocimiento)

### 1.1 · Las cuatro rutas afectadas: qué eran y qué las sustituye

Las cuatro existían en `backend-barberias/src/` con estas líneas (referencia del inventario previo,
`docs/PLAN_SPRINT_ESTABILIZACION.md:92`: `agenda.controller.ts:84`, `barberia.controller.ts:178`,
`combos.controller.ts:73`, `servicios.controller.ts:76`). Ninguna existe ya:

| Antes (`@Delete`) | Ahora | Dónde vive ahora | Efecto real |
| :--- | :--- | :--- | :--- |
| `DELETE /catalogo/servicios/:id` | `PATCH /catalogo/servicios/:id/desactivar` · `.../reactivar` | `src/catalogo/infrastructure/servicios.controller.ts:83` y `:99` | `estado = 'INACTIVO'`; sale de `findAll`; 422 `SERVICIO_EN_USO` / `SERVICIO_EN_COMBO_ACTIVO`; idempotente; la fila se conserva |
| `DELETE /catalogo/combos/:id` | `PATCH /catalogo/combos/:id/desactivar` · `.../reactivar` | `src/catalogo/infrastructure/combos.controller.ts:77` y `:88` | `estado = 'INACTIVO'` (`combos.service.ts:123-139`); es la acción que desbloquea la regla 2 del servicio |
| `DELETE /barberias/:barberiaId/agenda/bloqueos/:id` | `POST /barberias/:barberiaId/agenda/bloqueos/:id/liberar` | `src/agenda/infrastructure/agenda.controller.ts:101` | fija `liberado_at` (200, no 201), cancela el job y **audita** `BLOQUEO_LIBERADO` con anterior/nuevo en la misma transacción (`agenda.service.ts:134-161`); idempotente |
| `DELETE /barberias/:id` | `PATCH /barberias/:id/estado` `{estado}` | `src/barberia/infrastructure/barberia.controller.ts:183` (sólo `@Roles('ADMINISTRADOR')`) | `estado = 'ACTIVO' \| 'INACTIVO'`; suspender y reactivar son la misma operación |

Las tres reglas de negocio de la desactivación de catálogo están implementadas donde deben
(`src/catalogo/application/servicios.service.ts:104-190`, privados `exigirSinReservasAbiertas` y
`exigirSinCombosActivos`) y probadas en `test/e2-07-vocabulario.e2e-spec.ts` (422 con reservas
`PENDIENTE`/`PROPUESTA_PENDIENTE`, 422 con combo activo **y la lista de combos en el cuerpo**, y el permiso cuando
sólo hay reservas confirmadas —que llevan snapshot en `participante_servicios`—).

### 1.2 · Consumidores que llamaban a las rutas retiradas (y cómo están hoy)

| Consumidor | Estado |
| :--- | :--- |
| `frontend-barberias/src/app/core/services/servicios.service.ts:94,109` | migrado: `eliminarServicio()` → `PATCH .../desactivar`; `reactivarServicio()` → `PATCH .../reactivar` **(nuevo, no existía)** |
| `frontend-barberias/src/app/core/services/horarios.service.ts:95` | migrado: `eliminarBloqueo()` → `POST .../liberar` |
| `frontend-barberias/src/app/features/admin/horarios/admin-horarios.component.ts:715-721` | migrado: el botón usa el método nuevo |
| `frontend-barberias/src/app/features/admin/admin-servicios.component.ts:341-344` | migrado en la llamada, **no en el texto** (§3.3) |
| `test/permisos-matriz.spec.ts:374,475` | migrado: 75 rutas × 4 roles = 300 decisiones |
| `test/permisos-matriz.e2e-spec.ts`, `test/e1-06-cross-tenant-admin.e2e-spec.ts` | migrados (el segundo comprueba además que el intento cross-tenant **no** deja el bloqueo liberado) |
| `docs/MATRIZ_RUTAS.md` filas 17, 49, 54, (y la de bloqueos) | actualizadas con la columna «era `DELETE ...`» |

No queda ningún consumidor con el verbo viejo salvo **nombres de método y textos de UI** (§3.3), que no rompen nada
porque ya llaman a la ruta nueva.

### 1.3 · Esquema de Prisma: lo que ya existe

| Modelo | Columna / restricción | Valor | Migración que la trae |
| :--- | :--- | :--- | :--- |
| `Servicio` | `estado` | `String @default("ACTIVO") @db.VarChar(20)` (`schema.prisma:165`) | `init` |
| `Servicio` | **CHECK de dominio** | **NO EXISTE** (grep de `servicios_estado_check` = 0) | — |
| `Combo` | `estado` | `String @default("ACTIVO") @db.VarChar(20)` (`schema.prisma:183`) | `init` |
| `Combo` | **CHECK de dominio** | **NO EXISTE** | — |
| `Barberia` | `estado` | `String @default("ACTIVO") @db.VarChar(20)` (`schema.prisma:103`) | `init` |
| `Barberia` | `barberias_estado_check` | `CHECK (estado IN ('ACTIVO','INACTIVO'))` | `20261011130000_e203_integridad_base/migration.sql:41-42` |
| `BloqueosAgenda` | `liberadoAt` | `DateTime? @map("liberado_at") @db.Timestamptz` (`schema.prisma:276`) | `20261013120000_e207_liberado_at` |
| `BloqueosAgenda` | `bloqueos_agenda_vigentes_idx` | índice **parcial** `(barberia_id, fecha) WHERE liberado_at IS NULL` | `20261013120000_e207_liberado_at` |
| `ClienteBarberia` | `estadoVinculacion` | `ACTIVO·PENDIENTE_APROBACION·DESVINCULADO` con CHECK (`schema.prisma:143`) | `e203_integridad_base:84` |
| `Usuario` | `estadoCuenta` | `ACTIVO·SUSPENDIDO·ELIMINADO` con CHECK (`schema.prisma:17`) | `e203_integridad_base:78` |

Lo que esto dice sobre el estado del arte: el vocabulario «estado» ya es el idioma del proyecto (sede, usuario,
vínculo, reserva, pago), y **bloqueos es el único caso que necesitó columna nueva**. El catálogo es la excepción
incompleta: tiene la columna, pero sin la red que el resto sí tiene.

### 1.4 · Guardas que impiden la vuelta atrás

- `test/vocabulario-sin-delete.spec.ts`: lee el árbol completo de `src/` (excluye `*.spec.ts` y archivos vacíos),
  ignora líneas de comentario, y falla listando `archivo:línea` de cada `@Delete`. Comprueba **en los dos sentidos**:
  que no hay `@Delete` y que los cuatro verbos nuevos siguen declarados. `BORRADOS_AUTORIZADOS` existe y está
  **vacío a propósito**.
- `test/permisos-matriz.spec.ts` + `test/permisos-matriz.e2e-spec.ts`: la ruta nueva sin decisión de política pone la
  matriz en rojo (fail-closed), así que los seis verbos de E2-07 tuvieron que entrar en `POLITICA_DECLARADA`
  (`:132`, `:226-227`, `:233-234`) y el recuento pasó de 73 a 75 rutas.

**Límite medido de esas guardas** (esto es lo que hace falta saber antes de la Fase 3):

1. Sólo detectan **decoradores `@Delete`**. No miran `prisma.*.delete()` / `deleteMany()` en los servicios; de hecho
   `grep -n "delete" test/vocabulario-sin-delete.spec.ts` no devuelve nada.
2. Sólo miran el **backend**. El frontend no está cubierto por ninguna guarda de vocabulario.

---

## Fase 2 · Diseño del esquema (Phase 1 del phase-out)

Respuesta a las tres preguntas del encargo, separando **lo que ya está** de **lo que habría que añadir**.

### 2.1 · Catálogos (Servicios / Combos): ¿`activo: Boolean` o `estado`?

**Decisión: `estado` (ya implementado). No añadir `activo: Boolean`.** Razones, en orden de peso:

1. **Coherencia con el resto del esquema.** `barberias`, `usuarios` (`estado_cuenta`), `cliente_barberias`
   (`estado_vinculacion`), `reservas`, `pagos`: todo cambio de ciclo de vida se modela como estado textual con CHECK.
   Un `Boolean` en el catálogo sería el único booleano de ciclo de vida del esquema.
2. **Extensible sin migrar el tipo.** El día que el catálogo necesite un tercer valor (`ARCHIVADO`, p. ej.) es un
   `ALTER ... DROP CONSTRAINT / ADD CONSTRAINT`; con un `Boolean` es un cambio de tipo con `USING`.
3. **`default 'ACTIVO'`** hace que todo insert existente siga siendo válido: la migración es aditiva y no toca datos
   vivos.
4. El precio del `Boolean` —`activo` y `estado` conviviendo, con dos verdades sobre lo mismo— es exactamente el tipo
   de deriva que el sprint de estabilización está cerrando.

**Lo que falta de verdad: el CHECK.**

- `barberias` tiene `barberias_estado_check`; `servicios` y `combos` **no tienen ninguna restricción de dominio**.
  Hoy la base acepta `'ACTIVO'`, `'INACTIVO'`, `''`, `'activo'` o `'BORRADO'` indistintamente, y el único
  «diccionario» es el `if (servicio.estado === 'INACTIVO')` del servicio de aplicación.
- Propuesta: **una migración aditiva**, con el mismo patrón de `e203_integridad_base` (`ALTER TABLE ... ADD CONSTRAINT`)
  que añada `servicios_estado_check` y `combos_estado_check` con `CHECK (estado IN ('ACTIVO','INACTIVO'))`. Tan poco
  «re-ejecutable» como aquélla (`ADD CONSTRAINT` falla si ya existe): no hace falta que lo sea, porque Prisma no
  reaplica migraciones ya registradas.
- **No hay que tocar `scripts/check-integridad.cjs`**: su `checksDeclarados()` (líneas 57-72) **lee las migraciones**
  con `CONSTRAINT "<nombre>_check"`, así que la guardia de CI recoge el CHECK nuevo sola y compara contra la base
  migrada. Es el mecanismo pensado para esto.
- Antes de aplicarla hay que **inventariar los valores vivos** (`SELECT DISTINCT estado FROM servicios`), porque un
  CHECK sobre datos con un valor inesperado falla en la migración. En `dev` el catálogo sólo escribe `'ACTIVO'` y
  `'INACTIVO'` (`servicios.service.ts:43,116`; `combos.service.ts:131`), así que el riesgo es bajo, pero se mide, no se
  supone.

### 2.2 · Barberías: ya tiene `ACTIVO/INACTIVO`… ¿qué le falta para el soft-delete?

La mitad «borrado lógico» **ya está**: `PATCH /barberias/:id/estado` es un cambio de estado idempotente
(`barberia.service.ts:428-453`), la sede **no se borra**, y el `@Roles` la reserva al ADMINISTRADOR de la plataforma
(el `responsable` no puede cerrarse su propio negocio). Falta lo otro: **que suspender una sede signifique algo**.

**(a) No se audita.** `cambiarEstado` sólo hace `this.logger.log(...)` (`barberia.service.ts:452`) y devuelve `void`.
Es el acto más consecuente de la plataforma —deja un negocio fuera de servicio— y su rastro vive en el log del
proceso, que en Render es efímero. Comparar con `liberarBloqueo`: escribe `Auditoria` con
`anterior: {liberadoAt:null}` / `nuevo: {liberadoAt}` y `accion: 'BLOQUEO_LIBERADO'` en la misma transacción
(`agenda.service.ts:139-155`). **No necesita migración**: es una llamada a `AuditoriaService` con
`SEDE_ESTADO_CAMBIADO` y el payload anterior/nuevo.

**(b) No hay `motivo` ni `suspendida_at`.** Si negocio exige «por qué se suspendió» más allá del quién/cuándo, son dos
columnas aditivas (`motivo_suspension Text?`, `suspendida_at Timestamptz?`). **Mi recomendación: no añadirlas todavía.**
El payload de auditoría (a) ya guarda el estado anterior y el nuevo; añadir columnas sin un requisito que las lea es
deuda. Se decide cuando exista la pantalla o el informe que las consuma.

**(c) No hay estado terminal.** El CHECK admite sólo `ACTIVO/INACTIVO`, así que «sede cerrada definitivamente» **no es
representable** —a diferencia de `usuarios.estado_cuenta`, que sí tiene `ELIMINADO`—. Es una decisión de producto, no
técnica: si algún día hay que distinguir «cerrada temporalmente» de «cerrada para siempre», se añade el valor al CHECK.
Hoy no lo haría: nadie lo pide y ampliar un catálogo «por si acaso» es justo lo que H56 dejó anotado con
`zona_horaria`.

**(d) Es el hueco serio: suspender no propaga nada.** Medido:

- `cambiarEstado` sólo hace `prisma.barberia.update({ data: { estado } })`. No toca reservas abiertas, ni bloqueos, ni
  `configuracion_barberia.nuevasReservasActivas`.
- **El único punto del backend que comprueba `barberia.estado` es `vincularCliente`** (`barberia.service.ts:468`:
  `if (!barberia || barberia.estado !== 'ACTIVO')`). Ni el alta de reserva, ni la disponibilidad, ni el catálogo miran
  el estado de la sede (grep de `barberia.estado`/`estado !== 'ACTIVO'` en `src/reserva`, `src/agenda`,
  `src/barberia` → sólo las líneas 67, 82, 443 y 468 de `barberia.service.ts`).
- Consecuencia: **una sede `INACTIVO` sigue aceptando reservas y calculando disponibilidad** para los clientes ya
  vinculados. El «soft-delete» de la sede hoy sólo impide nuevos vínculos y la oculta de las lecturas que filtran por
  estado. Una sede suspendida pero vendiendo es peor que una borrada.
- Opciones (a decidir en la ejecución, no ahora): (i) comprobar `estado === 'ACTIVO'` en el alta de reserva y en la
  disponibilidad pública; (ii) propagar en el mismo acto de suspender: apagar `nuevasReservasActivas`, cancelar
  bloqueos vigentes, y decidir qué pasa con las reservas `PENDIENTE` (¿se cancelan con motivo, o se dejan para que la
  sede las honre al reactivar?). La (i) es pequeña y correcta; la (ii) es una regla de negocio que necesita dueño.

### 2.3 · Bloqueos: `liberado_at`

**Ya está implementado y no necesita nada.** `liberadoAt DateTime?` (UTC), migración aditiva
`20261013120000_e207_liberado_at`, índice parcial de vigentes, `DisponibilidadService` filtra
`where: { barberiaId, fecha, liberadoAt: null }` (`disponibilidad.service.ts:189`), el job `liberar-bloqueo` marca en
lugar de borrar (`bloqueos.processor.ts:33-40`) y la liberación manual audita (D29). `NULL` = vigente, y las filas
existentes en el momento de la migración quedaron correctas sin backfill (todas eran vigentes por definición).

Único matiz de diseño, ya resuelto: **idempotencia**. Liberar dos veces no reescribe `liberado_at` (devuelve
`{success:true, message:'El bloqueo ya estaba liberado', liberadoAt}`), así que el instante original se conserva y el
job no puede «re-liberar» moviendo la marca.

---

## Fase 3 · Diseño de la transición dual (Phase 2 del phase-out)

### 3.1 · Lo que realmente ocurrió: corte seco, no ventana dual

El encargo pide alterar temporalmente los controladores `@Delete` para que, sin cambiar la URL, deleguen en la lógica
de soft-delete —una ventana de compatibilidad para que el frontend siga mandando `DELETE`—. **Eso no se hizo.** Fue
defendible en su contexto (consumidores internos, sin clientes de terceros, un commit que cambió las dos partes a la
vez), pero
**no fue gratis**: deja un residuo medido (punto 1). El encargo acierta al señalarlo. Los tres hechos que lo explican:

1. **Los dos lados cambiaron en el mismo commit, y los clientes eran internos.** No es que los despliegues sean
   atómicos —**no lo son**: el backend lo despliega Render desde `main` (`render.yaml`, `rootDir: backend-barberias`,
   `autoDeploy: true`) y el frontend lo despliega Vercel por su cuenta (`frontend-barberias/vercel.json`), sirviendo
   `barberias-platform.vercel.app` (que aparece en el `CORS_ORIGINS` del backend)—. Es que **el consumidor y el
   productor cambiaron en el mismo commit** (`432c372`). Y ese razonamiento **deja un residuo real**: entre los dos
   despliegues —y para cualquier navegador que sirva el bundle viejo desde caché— un `DELETE .../bloqueos/:id` llega a
   un backend que ya no tiene la ruta y recibe **404**, y `eliminarBloqueo()` del frontend no tiene `catchError`
   (`horarios.service.ts:95-97`), así que ese 404 sale como error no manejado. Con clientes externos reales, la
   ventana dual que pides sería obligatoria, no opcional.
2. **Los clientes eran internos y se migraron primero.** El backlog afirmaba «Eliminar `DELETE` sin alias (no hay
   clientes reales)» y estaba equivocado: los consumidores eran el frontend propio
   (`core/services/servicios.service.ts`, `core/services/horarios.service.ts`), `test/permisos-matriz.spec.ts` y
   `test/e1-06-cross-tenant-admin.e2e-spec.ts`. Se migraron **antes** de retirar los verbos, y la corrección al
   enunciado quedó escrita en `docs/BACKLOG_BARBERIAS_V1.md` (nota «Corrección al enunciado» de E2-07).
3. **La ventana dual tiene un coste que no es gratis.** Mantener `DELETE` vivo obliga a una excepción en
   `vocabulario-sin-delete.spec.ts` (cuyo `BORRADOS_AUTORIZADOS` está vacío *a propósito*) y deja en producción,
   durante semanas, la ruta que Spec 01 §9 prohíbe. La guarda que hoy impide la vuelta atrás tendría que aflojarse
   justo en la tarea que la creó.

### 3.2 · Si algún día hubiera un cliente externo legacy

El patrón correcto **no** es reintroducir el borrado, sino un **alias de compatibilidad que no borra**:

- `DELETE /catalogo/servicios/:id` → delega en `ServiciosService.desactivar()` (jamás en `prisma.delete`).
- `DELETE /barberias/:barberiaId/agenda/bloqueos/:id` → delega en `AgendaService.liberarBloqueo()`.
- Declarado en `BORRADOS_AUTORIZADOS` **con su motivo y su fecha de retirada** (el campo ya existe para esto), para que
  la excepción sea visible y caduque en vez de envejecer.
- Y con un `Deprecation`/`Sunset` en la respuesta, para poder retirarlo sin repetir el trabajo de arqueología de
  consumidores.

Hoy **no lo aplicaría**: no hay cliente que lo pida, y el alias solo sirve para que el vocabulario prohibido siga
pareciendo legítimo.

### 3.3 · El riesgo residual que sí quedó: el vocabulario del diseño no llegó al frontend

Spec 01 §9 es una regla de **vocabulario**. Se cumplió en la API (`@Delete` = 0) y **no** en la interfaz, que sigue
diciendo «eliminar» para acciones que ya no eliminan:

- `frontend-barberias/src/app/core/services/servicios.service.ts:94` — método `eliminarServicio()` que hace
  `PATCH .../desactivar`.
- `frontend-barberias/src/app/features/admin/admin-servicios.component.ts:341-344` — `confirmDelete()` con
  `confirm('¿Estás seguro de eliminar este servicio?')`.
- `frontend-barberias/src/app/core/services/horarios.service.ts:95` — `eliminarBloqueo()` que hace `POST .../liberar`
  (y el botón «eliminar» de `admin-horarios.component.ts:317`). Aquí el nombre viejo es una **decisión
  documentada**, no un descuido: el comentario del propio método (`horarios.service.ts:91-94`) dice «El método
  conserva su nombre porque lo que hace la pantalla no cambió: el bloqueo deja de ocupar la agenda. Lo que cambia es
  el verbo del backend». Es un punto a revisar, no un accidente.

No rompe nada (la llamada ya es la nueva), pero es exactamente la deuda que el backlog llamaba «avisar de los cambios
que rompen el frontend (F-08)» y **no hay guarda que la detecte**, porque `vocabulario-sin-delete.spec.ts` sólo lee el
backend. Es el hallazgo que justifica la propuesta P-SD-5 (§4).

---

## 4 · Plan de lo que realmente falta (para aprobar)

Ordenado por lo que rompe antes si no se hace. Cada punto nació como **propuesta**; §4.1 registra qué fue de cada uno al ejecutarlo.

> **Nivel de evidencia, para que nadie confunda lectura con medición:** todo lo de esta tabla se verificó **leyendo
> el código y el esquema** (grep + lectura + `git`). En esta fase de análisis **no** levanté la aplicación ni el
> frontend, así que P-SD-1, P-SD-2, P-SD-5 y P-SD-6 son hallazgos **estáticos** (un método sin llamadores, una ruta sin
> consumidor, una guarda que no mira lo que debería): la ejecución de §4 empezará por reproducir cada uno en rojo antes
> de tocar nada, que es la regla del sprint.

| # | Severidad | Qué | Evidencia medida | Criterio de aceptación | Estado (2026-10-15) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P-SD-1** | **Alta** | **`reactivar` existe en la API pero no se puede alcanzar desde la app**, y `findAll` filtra `estado: 'ACTIVO'`: un servicio desactivado desaparece del listado sin vuelta atrás en la interfaz | `reactivarServicio()` declarado en `core/services/servicios.service.ts:109` y **sin ningún llamador** (grep en todo `features/` = 0); backend `servicios.service.ts:61` filtra `estado: 'ACTIVO'` | Pantalla (o filtro «incluir inactivos») que liste `INACTIVO` y permita reactivar; E2E de ida y vuelta desde la UI | **[EJECUTADO]** |
| **P-SD-2** | **Alta** | **La acción que desbloquea el 422 `SERVICIO_EN_COMBO_ACTIVO` no tiene llamador en el frontend**: una sede que recibe el error se queda sin salida | `PATCH /catalogo/combos/:id/desactivar` (`combos.controller.ts:77`) sin uso: no hay ninguna llamada a `/combos` en `core/services/*`; el listado declara `esCombo` (`servicios.service.ts:12`) pero `GET /servicios` devuelve filas de `servicios`, sin ese campo | La pantalla puede desactivar un combo (o, como mínimo, el 422 ofrece la ruta de resolución) | **[EJECUTADO]** |
| **P-SD-3** | Media | **Suspender una sede no se audita ni propaga**: sólo `logger.log`, sin rastro durable, y la sede `INACTIVO` sigue aceptando reservas y calculando disponibilidad | `barberia.service.ts:428-453` (devuelve `void`, sin `Auditoria`; el único rastro es el `logger.log` de `:452`); único chequeo de `barberia.estado` = `barberia.service.ts:468` | (i) `Auditoria` `SEDE_ESTADO_CAMBIADO` con anterior/nuevo; (ii) decisión de dueño sobre reservas abiertas, con prueba en el alta de reserva | **[EJECUTADO]** |
| **P-SD-4** | Media | **`servicios.estado` y `combos.estado` sin CHECK**: la base admite cualquier cadena para el estado del catálogo | grep de `servicios_estado_check`/`combos_estado_check` = 0; `barberias_estado_check` sí existe (`e203_integridad_base:41-42`) | Migración aditiva con los dos CHECK, `npm run check:integridad` en verde (lo recoge solo: `check-integridad.cjs:57-72`), y el `SELECT DISTINCT` del catálogo inventariado antes | **[EJECUTADO]** |
| **P-SD-5** | Media | **La guarda de E2-07 no cubre el nivel de datos ni el frontend**: vigila decoradores, no `prisma.delete*` | `grep -n "delete" test/vocabulario-sin-delete.spec.ts` = 0 | Extender la guarda con **allowlist explícita** (la tabla de abajo) y, si se puede, una comprobación equivalente sobre el frontend | **Pendiente** — medido: la guarda no se tocó desde `432c372` y sigue viendo solo decoradores del backend |
| **P-SD-6** | Baja | Vocabulario del frontend (`eliminarServicio`, `confirmDelete`, `eliminarBloqueo`) | §3.3 | Nombres y textos con el verbo del efecto («desactivar», «liberar»). Ojo: el de `horarios.service.ts` es una **decisión documentada en un comentario**, así que esto es una revisión a propósito, no un bug | **[EJECUTADO]** (quedan los dos alias documentados de §3.3) |
| **P-SD-7** | Baja | Documentación que aún dice que E2-07 está pendiente | `docs/PLAN_SPRINT_ESTABILIZACION.md:92` | Nota de actualización en esa tabla (la de P3.8 ya dice ejecutado: la contradicción es interna al mismo documento) | **[EJECUTADO]** |
| **P-SD-8** | Baja | **E2-08** (`docs/MATRIZ_CUMPLIMIENTO.md`) sigue sin existir | el archivo no está | Documento creado; es el siguiente escalón natural de E2-07 | **Pendiente** |

**Los borrados a nivel de datos que hoy existen, con mi veredicto** (para pasar de excepción invisible a allowlist
declarada, que es lo que P-SD-5 pide):

| Uso | Veredicto |
| :--- | :--- |
| `horario.service.ts:53` y `:151` — `deleteMany` de la rejilla horaria antes de reinsertarla | **Permitido**: es *reemplazar una configuración completa*, no representar un cambio de estado. La rejilla no tiene historia que conservar (a diferencia de una reserva o un bloqueo) |
| `auditoria.service.ts:261` — purga por retención (365 días, T8.2) | **Permitido**: es la política de retención de los logs, explícita y documentada |
| `solicitud-cambio.service.ts:321` — `usuarioRol.deleteMany` al mover el rol al nuevo responsable | **Permitido**: el rol se *mueve*, no se desactiva; el vínculo con la sede se conserva (`uk_usuario_rol_barberia`) |
| (ninguno más) | Ninguno necesita soft-delete. Lo que falta no es cambiar estos, es **que la guarda los declare autorizados en lugar de no verlos** |

**Orden propuesto si se aprueba todo:** `P-SD-4` (esquema, va primero porque es migración) → `P-SD-3` (auditoría de la
sede, sin migración) → `P-SD-1` + `P-SD-2` (que la vuelta atrás sea alcanzable) → `P-SD-5` + `P-SD-6` (guardas y
vocabulario) → `P-SD-7` + `P-SD-8` (documentación). Cada uno con su rojo medido antes del verde y su informe 8.4, como
el resto del sprint.

### 4.1 · Cómo se cerró cada punto (2026-10-15)

Orden de ejecución: el de arriba. Cada punto con su rojo medido antes del verde y su informe 8.4.

**P-SD-4 · esquema (primero, porque es migración).** `20261014000000_e207_catalogo_estado_check/migration.sql` añade
`servicios_estado_check` y `combos_estado_check` (`estado IN ('ACTIVO','INACTIVO')`): aditiva, sin tocar datos ni
reformular los CHECK existentes. Inventario previo **medido en solo lectura** sobre `dev`: `servicios.estado` =
`ACTIVO` (125), `combos.estado` = `ACTIVO` (4), y 0 CHECK en las dos tablas, así que el `ALTER` no puede fallar por
datos. `check-integridad.cjs` no necesitó cambios y eso está medido, no supuesto: los recoge de `prisma/migrations/**`
por sí solo (en rojo antes de aplicar, verde después). Además, `estado` pasa de texto libre a
`@IsIn(ESTADOS_CATALOGO_VALORES)` en los DTO de servicio y combo, para que un valor fuera de catálogo responda **400**
en la API en lugar del **500** por violación del CHECK nuevo. **Ojo al fusionar: la migración NO está aplicada en
`dev`**, y `render.yaml` no corre `prisma migrate deploy` en el despliegue, así que hay que aplicarla a mano; hasta
entonces `npm run check:integridad` contra `dev` falla a propósito, que es la guardia haciendo su trabajo.

**P-SD-3 · que suspender una sede signifique algo.** `src/shared/domain/sede.ts` (nuevo) concentra la regla en una
sola definición, `exigirSedeActiva(db, barberiaId)` → 422 `SEDE_INACTIVA`. La llaman el alta de reserva —antes de
mirar el vínculo, porque es decisión de la plataforma y no una relación cliente-sede— y las tres puertas de agenda
(`calcularDisponibilidadDeSolicitante`, `buscarAlternativasDeSolicitante` y `huecosDeLaSede`), siempre **después** de
la pertenencia: si fuera antes, el 422 serviría para que un cliente de otra sede sondee qué sedes están suspendidas.
`cambiarEstado` es ahora transaccional y deja rastro **durable** (`AuditoriaService.registrarEvento` con
`BARBERIA_SUSPENDIDA` / `BARBERIA_REACTIVADA` y `contexto = { anterior, nuevo }`, en la misma transacción que el
`update`); es idempotente, así que pedir el estado que ya está no escribe ni audita. La decisión de dueño sobre las
reservas abiertas quedó tomada y probada: **se quedan operables** —el bloqueo es de demanda nueva, y suspender sin
ese matiz dejaría las `PENDIENTE`/`CONFIRMADA` de la sede huérfanas, sin nadie que pudiera confirmarlas, rechazarlas
ni cancelarlas—. Evidencia: +5 unitarios en `disponibilidad.service.spec.ts`, +2 en `reserva.service.spec.ts`, +4 en
`barberia.service.spec.ts` y 9 E2E nuevos en `test/e2-07-sede-inactiva.e2e-spec.ts` (HTTP real y base real); 537/537
unitarios, 212/212 E2E y `check:integridad` OK, con el rojo previo documentado en `reporte-p-sd-3-p-sd-4.md`.

**P-SD-1 · «Reactivar» inalcanzable.** El botón existía, pero la lista del panel no podía mostrar un ítem INACTIVO:
`GET /servicios` y `GET /catalogo/combos` filtraban `estado: 'ACTIVO'` para todo el mundo, así que desactivar hacía
desaparecer la fila y la vuelta atrás no tenía dónde pulsarse. Ahora `findAll` deja ver los inactivos al
ADMIN_BARBERIA de la sede y al ADMINISTRADOR global (el CLIENTE sigue viendo solo ACTIVOS, que es la regla de E2-07)
y el panel pinta badge `ACTIVO`/`INACTIVO` con la tarjeta atenuada, además de mostrar el `mensaje` del 422 en la
lista y no sólo dentro del formulario, que era donde se perdía.

**P-SD-2 · desactivar combos sin llamador.** El frontend no pedía `/catalogo/combos` en ninguna parte: la pestaña
«Combos» estaba siempre vacía y `desactivarCombo` no tenía a quién llamar —justo la acción que libera a un servicio
del 422 `SERVICIO_EN_COMBO_ACTIVO`—. `ServiciosService.cargarServicios(true)` compone servicios + combos (entran con
`esCombo: true` y su `precioEspecial`/`duracionPropia` normalizados a la forma de la tabla) y el toggle elige el
endpoint según ese flag. Si la lectura de combos falla, el catálogo del admin se degrada a solo servicios en lugar
de quedarse en blanco.

**P-SD-6 · vocabulario del frontend.** `confirmDelete()` pasa a `toggleEstado(servicio)` con el verbo del efecto
(«Desactivar»/«Reactivar») y textos que lo dicen («Dejará de ofrecerse, pero no se borra»). Sobreviven dos residuos
**a propósito y documentados**: `eliminarServicio()` queda como alias de `desactivarServicio()` sin llamadores, y
`eliminarBloqueo()` conserva su nombre viejo con el comentario que lo justifica (§3.3).

**P-SD-7 · documentación obsoleta.** `docs/PLAN_SPRINT_ESTABILIZACION.md` seguía dando E2-07 por pendiente «siguen 4
`@Delete`»; con `grep @Delete backend-barberias/src/` = 0 la fila se corrige, y `docs/MATRIZ_RUTAS.md` pasa a declarar
los llamadores reales del frontend en las rutas 49 y 54.

**P-SD-5 · sigue abierto, y conviene decir por qué no lo marco.** Medido hoy sobre el árbol fusionado:
`test/vocabulario-sin-delete.spec.ts` **no se ha tocado desde `432c372`** (único commit de su historia), su
`BORRADOS_AUTORIZADOS` sigue vacío y sigue leyendo **solo** `backend-barberias/src/**` en busca de decoradores
`@Delete`: no mira `prisma.*.delete*` ni el frontend. La allowlist de la tabla de arriba sigue siendo papel, no
guardia. El cierre es pequeño —pasar los cuatro veredictos a `BORRADOS_AUTORIZADOS` y añadir una comprobación de
vocabulario sobre `frontend-barberias/src/app/core/services/`— pero no se hizo en ninguna de las dos ramas, así que
marcarlo [EJECUTADO] sería un documento que miente. **P-SD-8** sigue en el mismo estado que se describió:
`docs/MATRIZ_CUMPLIMIENTO.md` no existe.

**Checks del árbol fusionado (2026-10-15, ya con `origin/main` dentro).** `npm run build` del backend (exit 0) y
**543/543** unitarios en 48 archivos; `ng build` del frontend (exit 0) y **17/17** en `ng test`. La suite **E2E no se
re-corrió** en este merge: el contenedor local de Postgres + Redis con el que se midió `reporte-p-sd-3-p-sd-4.md` está
apagado. Como el merge no puso en conflicto ni una línea de código —el único conflicto fue este documento—, las dos
suites E2E siguen vigentes por separado, pero la verificación conjunta queda a cargo del CI.

---

## 5 · Lo que NO haría (y por qué)

1. **`activo: Boolean` en el catálogo.** Dos verdades sobre lo mismo; rompe la coherencia con el resto del esquema (§2.1).
2. **Reintroducir `@Delete`, aunque sea delegando en el soft-delete.** Sólo con un cliente externo legacy real, y en ese
   caso con allowlist, motivo y fecha de retirada (§3.2).
3. **Convertir los cuatro `deleteMany` en soft-deletes.** Son reemplazos de configuración, purgas de retención y
   movimientos de rol; marcarlos «eliminados» no aporta historia y llena las tablas de filas muertas (§4, P-SD-5).
4. **Añadir `motivo_suspension`/`suspendida_at` a `barberias` ahora.** Sin pantalla ni informe que los lea, la
   auditoría con anterior/nuevo ya cubre el requisito (§2.2b).
5. **Tocar `render.yaml`, la matriz de rutas o los CHECK existentes para «homogeneizar».** P-SD-4 añade dos CHECK; no
   se reformula lo que ya está en `dev` (la lección de H50: la divergencia se cerró no volviendo a divergir).

---

## 6 · Evidencia reproducible y estado del repositorio

Comandos exactos con los que se midió todo lo de arriba (ejecutados desde la raíz del repo, `HEAD` = `7368710`):

```bash
grep -rn "@Delete" backend-barberias/src/                                   # 0 (exit 1)
grep -rn "desactivar\|reactivar\|liberar" backend-barberias/src/ --include=*.controller.ts
grep -rn "liberadoAt" backend-barberias/src/ | grep -v .spec.ts             # disponibilidad:189 filtra null
grep -rn "servicios_estado_check\|combos_estado_check" backend-barberias/prisma/ scripts/   # 0
grep -rn "barberia.estado\|estado !== 'ACTIVO'" backend-barberias/src/reserva backend-barberias/src/agenda backend-barberias/src/barberia
grep -rn "\.delete(\|\.deleteMany(" backend-barberias/src/ | grep -v "\.spec\.ts"
grep -n "delete" backend-barberias/test/vocabulario-sin-delete.spec.ts      # 0
grep -rn "reactivarServicio\|eliminarServicio\|liberarBloqueo" frontend-barberias/src/
git branch -r --contains 432c372                                            # incluye origin/main → E2-07 fusionado
```

**Estado git en el momento de escribir esto:** rama `fix/h64-healthcheck-sondas`, árbol limpio, `origin/main` en
`60ecd8b` y conteniendo `432c372` (E2-07). Este documento es el único archivo que añade.

**Actualización (2026-10-15):** ese `HEAD` es el del análisis, y todo lo de arriba se midió contra él. El cierre
está en §4.1 y en los informes `reporte-p-sd-3-p-sd-4.md` (P-SD-3 y P-SD-4) y `reporte-final-p-sd-1-p-sd-2.md`
(P-SD-1, P-SD-2 y P-SD-7).

**Nota de contexto (no forma parte de E2-07):** `fix/h64-healthcheck-sondas` está **subida pero no fusionada**
(`git branch -r --contains 7368710` sólo devuelve su propia rama); el merge de `origin/main` (`60ecd8b`) es el PR #59
de la infraestructura asíncrona. El PATCH de liveness de H64 llegará a `main` con su propio PR.

**Nada de esto se ha ejecutado:** ni código productivo, ni migración, ni cambio de esquema. **No se corrió ninguna
suite** (no hay nada ejecutable que cambie: este documento es el único archivo nuevo) y **no se levantó la aplicación ni
la interfaz**. Se entrega para aprobación y, una vez aprobado, se ejecutará por el orden de §4 con rojo medido antes,
suite verde y reporte 8.4 por punto.
