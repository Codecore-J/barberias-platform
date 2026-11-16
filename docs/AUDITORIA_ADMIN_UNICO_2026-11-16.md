# AUDITORÍA · Blindaje «Admin único + Cuenta dual» y hallazgos previos a T-17

**Fecha:** 2026-11-16 · **Rama auditada:** `main` @ `d24e452` · **Alcance:** Fases 1–4
**Modo:** solo lectura. No se modificó código ni datos durante esta auditoría.
**Credenciales:** omitidas; el rol de conexión se cita por nombre, nunca por cadena.

---

## Respuestas A.0

### 1 · ¿Los E2E de `fase3-admin-unico.e2e-spec.ts` corrieron? ¿Contra qué base y en qué entorno?

**Sí, corrieron** — 4 veces en la sesión de trabajo, siempre contra el **Postgres local de `docker-compose`** (no producción), con `APP_ENV=dev`.

Invocación y salida literal (última corrida completa de la suite):

```
$ cd backend-barberias && npx vitest run --config ./vitest.config.e2e.ts
 ✓ test/fase3-admin-unico.e2e-spec.ts (11 tests) 1033ms
 Test Files  39 passed (39)
      Tests  320 passed (320)
   Duration  97.61s
```

Salida del archivo suelto tras añadir los casos 9–11 (Fase 4):

```
 ✓ test/fase3-admin-unico.e2e-spec.ts (11 tests) 1033ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

De dónde salen el entorno y la base:

- `vitest.config.e2e.ts` → `setupFiles: ./test/setup.e2e.ts`, `include: **/*.e2e-spec.ts`, `fileParallelism: false`.
- `test/setup.e2e.ts` carga `.env.test` y **aborta si `APP_ENV !== 'dev'`** (guarda explícita contra producción).
- `.env.test` apunta a `localhost:5432` (contenedor local). En esa misma sesión el `.env` principal apuntaba a Neon: por eso cada corrida exportó `DATABASE_URL` desde `.env.test`.

**Limitación honesta:** al momento de esta auditoría el daemon de Docker está detenido, así que los E2E **no se pueden reejecutar ahora mismo**; los resultados citados son de las corridas de las fases 3 y 4 (16-nov).

### 2 · ¿La migración del trigger pasó por PR con CI verde, o se aplicó directo en Neon?

**Ambas cosas, en este orden: primero se aplicó a Neon, después se abrió el PR.** Es el hallazgo más relevante de esta sección.

```
$ git log --oneline -- backend-barberias/prisma/migrations/ | head -3
d69656d feat(roles): garantizar en PostgreSQL un solo dueño activo por sede
...
```

- **Commit que contiene la migración:** `d69656d` (`20261116023000_admin_barberia_unico_por_sede/migration.sql`).
- **PR:** **#149** `feat/fase4-db-trigger-e2e` → `main`, fusionado con merge commit **`d24e452`**. CI en verde: `build-and-test`, `validacion-lint`, `validacion-pruebas` y preview de Vercel, todos `SUCCESS` (`mergeStateStatus: CLEAN`).
- **Pero** la migración se aplicó a Neon **antes** de que existiera el PR, con:

```
$ export DATABASE_URL=… (tomado de backend-barberias/.env)
$ npx prisma migrate deploy
The following migration(s) have been applied:
  └─ 20261116023000_admin_barberia_unico_por_sede/migration.sql
All migrations have been successfully applied.
$ npx prisma migrate status
32 migrations found · Database schema is up to date!
```

  Rol utilizado: **`neondb_owner`** (el mismo que usa la aplicación), host directo del proyecto `barberias-db`, branch `production`. No hubo paso por CI ni revisión previa de ese DDL en producción.

### 3 · ¿Se hizo backup o branch de Neon antes de las limpiezas en producción?

**No.** No se creó ninguna branch de Neon ni punto de restauración nombrado antes de ejecutar `purge-test-relics.ts --aplicar` ni `regularizar-administradores-sede.ts --aplicar`.

Lo único disponible como red es la **historia propia de Neon**, y en este proyecto está al mínimo: el panel del branch `production` mostraba **«History retention: 6 hours»** (plan Free). Es decir, la ventana de recuperación era de 6 horas y ya expiró.

Secuencia ejecutada en Neon el 16-nov (registrada en la sesión):

| Ejecución | Cuentas | Sedes | Reservas | Pagos | Vínculos | Rol |
|---|---|---|---|---|---|---|
| `purge --aplicar` #1 | 8 | 5 | 2 | 0 | 11 + 2 huérfanos | neondb_owner |
| `seed-demo` | — | — | 2 | 1 | — | neondb_owner |
| `purge --aplicar` #2 | 6 | 2 | 2 | 1 | 4 | neondb_owner |
| `seed-demo` (final) | — | — | 2 | 1 | — | neondb_owner |

**Recomendación:** antes de cualquier limpieza futura, `neonctl branches create --name pre-purge-<fecha>` (o subir el plan para ampliar retención). Sin eso, un error de patrón es irreversible más allá de 6 horas.

### 4 · ¿Qué criterio usó `regularizar-administradores-sede.ts` para decidir qué admin conservar?

Archivo: `backend-barberias/prisma/regularizar-administradores-sede.ts`, líneas **49–61**:

```ts
/** Orden de preferencia: cuenta activa primero, luego la cuenta más antigua. */
function compararCandidatos(a: Vinculo, b: Vinculo): number {
  const aActiva = a.usuario.estadoCuenta === 'ACTIVO' ? 0 : 1;
  const bActiva = b.usuario.estadoCuenta === 'ACTIVO' ? 0 : 1;
  if (aActiva !== bActiva) return aActiva - bActiva;

  const diferencia = a.usuario.creadoAt.getTime() - b.usuario.creadoAt.getTime();
  if (diferencia !== 0) return diferencia;

  return a.id.localeCompare(b.id);
}
```

Regla: **(1)** cuenta `ACTIVO` antes que suspendida; **(2)** cuenta más antigua (`usuarios.creado_at`); **(3)** empate por `id` para que dos ejecuciones elijan lo mismo. A los sobrantes **no se les borra**: se desactiva el vínculo (`estado = 'INACTIVO'`, líneas 158–164).

**Sedes con duplicados y desactivaciones:**

| Base | Sedes con más de un `ADMIN_BARBERIA` ACTIVO | Vínculos desactivados |
|---|---|---|
| Neon (`production`) | **0** | **0** (`Nada que regularizar.`) |
| Local (`docker`) | **0** | **0** |

Es decir: **no se conservó ni se desactivó a nadie por duplicidad**, porque el estado de partida ya era 0 duplicados en ambas bases (las filas problemáticas de la auditoría original ya se habían resuelto antes de esta ejecución). No hay tabla de «a quién se desactivó» que reportar: la lista está vacía, y eso mismo es la evidencia.

---

## Tabla de fallos

| # | Fallo | Veredicto | Evidencia | Severidad | Fix propuesto |
|---|-------|-----------|-----------|-----------|---------------|
| **F1** | `ADMIN_BARBERIA` con `barberia_id` nulo | **CONFIRMADO** | Sin `CHECK` sobre `usuario_roles` (solo existen `chk_usuario_telefono_10_digitos` y `chk_barberia_telefono_10_digitos`). El trigger sale por la puerta de atrás: `migration.sql:20` `IF NEW."barberia_id" IS NULL … RETURN NEW;`. Y `analytics.controller.ts:79` trata el nulo como comodín: `(rol.barberiaId === shopId \|\| !rol.barberiaId)` → **un ADMIN_BARBERIA sin sede lee las analíticas de CUALQUIER sede**. Hoy: `admin_sin_sede=0` en Neon. | **Alta** | `CHECK (barberia_id IS NOT NULL)` para roles de ámbito `BARBERIA` (vía trigger/constraint) + quitar `\|\| !rol.barberiaId` de `verificarAcceso`. Rama `fix/t17-f1-rol-sede-nulo`. |
| **F2** | Auto-aprobación en cuenta dual | **PARCIAL** | No existe ninguna comprobación `solicitante !== aprobador`: `solicitud-cambio.service.ts` valida rol del solicitante (líneas 69–84) y rol del aprobador (`ADMINISTRADOR`), pero nunca que sean usuarios distintos. Un usuario con `ADMINISTRADOR` global + `ADMIN_BARBERIA` en la sede podría pedir y aprobar su propio cambio de responsable. `pago.service.ts:332-369`: anular exige admin de sede, pero no aplica a auto-aprobación (no hay flujo de aprobación). La auditoría guarda `usuarioId` + `contexto`, no la «capacidad» usada. | **Media** | Rechazo explícito `NO_AUTOAPROBACION` cuando `solicitud.solicitadoPor === usuario.id`; y añadir `capacidad`/`rolUsado` al evento de auditoría. Rama `fix/t17-f2-autoaprobacion`. |
| **F3** | Transferencia / retiro de propiedad | **PARCIAL** | Sí existe flujo: `POST /barberias/:id/solicitudes-cambio` (tipo `RESPONSABLE`) + `PATCH …/:id/resolver`, cubierto por `test/e3-13-solicitudes-cambio.e2e-spec.ts` (20 casos, incluido «aprobar mueve responsable_id y el rol»). Orden frente al trigger: la aprobación **borra** los vínculos ajenos y luego activa/crea el del nuevo (`solicitud-cambio.service.ts:386-404`), probado en `fase3-admin-unico.e2e-spec.ts` caso 10. **Pero** crear la solicitud exige ser el `ADMIN_BARBERIA` de la sede (`solicitud-cambio.service.ts:69-84`): si el dueño es inaccesible, el ADMINISTRADOR global **no puede iniciar la transferencia**; solo queda suspenderlo y ejecutar `regularizar…` o SQL manual. | **Media** | Permitir que `ADMINISTRADOR` cree la solicitud `RESPONSABLE` (aprobación seguiría en otra mano) o un endpoint `PATCH /plataforma/sedes/:id/responsable` auditado. Rama `fix/t17-f3-transferencia`. |
| **F4** | Semántica de «ACTIVO» | **CONFIRMADO** | Trigger y dominio miran **solo `usuario_roles.estado`**, nunca `usuarios.estado_cuenta`: `migration.sql:20` (`NEW."estado" <> 'ACTIVO'`) y `administrador-sede.ts:64-72` (`estado: 'ACTIVO'`). El propio script lo advierte (`regularizar-administradores-sede.ts:131-150`: «Sedes con administrador ACTIVO pero cuenta suspendida»). Efecto: dueño suspendido ⇒ la sede devuelve `409 SEDE_YA_TIENE_ADMIN` al intentar nombrar reemplazo y **queda operativamente muerta** (nadie puede entrar). Ocurrió de verdad: `Sede PU-mwb6hfjbjmss` y `Sede QA Mutacion 20261113` aparecieron así en Neon. Hoy: `sedes_sin_admin_util=0` (purgadas). | **Alta** (operativa) | Que `asegurarSedeSinAdmin` ignore vínculos cuyo `usuario.estadoCuenta != 'ACTIVO'` **y** que el trigger haga lo mismo (join a `usuarios`), o desactivar el vínculo al suspender la cuenta. Rama `fix/t17-f4-suspension-deshuesa`. |
| **F5** | Alcance real del «absoluto» | **CONFIRMADO (no como se asumía)** | La app se conecta como **`neondb_owner`, que ES el `tableowner` de `usuario_roles`** → `has_table_privilege('usuario_roles','TRIGGER') = true` ⇒ **puede ejecutar `ALTER TABLE … DISABLE TRIGGER`**. `superuser=false`, así que `session_replication_role=replica` no está disponible (`rolsuper=false`, y `current_setting` = `origin`). `TRUNCATE` **sí** saltaría el trigger (es FOR EACH ROW): no hay `BEFORE TRUNCATE`. | **Alta** | Crear rol de aplicación `barberias_app` **sin ownership** (`NOLOGIN`/`NOINHERIT`, solo DML) y migrar `DATABASE_URL` a él; documentar que el trigger es defensa en profundidad, no una caja fuerte frente al dueño de la tabla. Rama `fix/t17-f5-rol-app`. |
| **F6** | Trigger vs 409 en carrera | **PARCIAL** | Mapeo existente: `prisma-exception.filter.ts:136-143` convierte `P2002` en **409** (`code: 'UNIQUE_CONSTRAINT_VIOLATION'`), y las condiciones 40001/P2034 en 409 `CONCURRENCY_CONFLICT` (`:88-110`). Por tanto **no hay 500** por el trigger. El desajuste es de **contrato**: el camino normal responde `409 SEDE_YA_TIENE_ADMIN` con `adminActual`, y el camino de carrera responde `409 UNIQUE_CONSTRAINT_VIOLATION` **sin `adminActual`**. La UI que ramifica por `codigo` solo entiende el primero. | **Media** | Mapear el `constraint` `uk_admin_barberia_unico_por_sede` del error P2002 a `409 SEDE_YA_TIENE_ADMIN` con `adminActual` (el filtro puede consultar la sede ocupada) — rama `fix/t17-f6-contrato-409`. |
| **F7** | `rolEfectivo()` con cuenta dual | **PARCIAL** | `frontend-barberias/src/app/core/utils/rol.ts:19-24` prioriza `ADMINISTRADOR > ADMIN_BARBERIA > BARBERO > CLIENTE` ⇒ una cuenta dual dueño+barbero devuelve **`ADMIN_BARBERIA`**. La agenda lo respeta: `agenda.service.ts:47` da acceso completo a quien tenga `ADMIN_BARBERIA` (no a la columna propia), documentado en el comentario E1-04. Cubierto por `agenda.service.spec.ts:84,179`, pero **no hay un test específico de «dual ve agenda completa»** ni la prioridad del frontend está testeada como tal. | **Baja** | Test explícito dual→agenda completa (backend) + `rol.spec.ts` con `['ADMIN_BARBERIA','BARBERO']`. Rama `fix/t17-f7-prioridad-dual`. |
| **F8** | Invitaciones pendientes | **DESCARTADO** | **No existe modelo de invitaciones pendientes** (`grep Invitacion prisma/schema.prisma` → sin resultados): invitar crea la cuenta ahí mismo (`barberia.service.ts:638`) y la cardinalidad se comprueba **en la misma transacción** (`:616-620`), no al aceptar. No hay invitaciones creadas antes del trigger: cualquier fila previa ya está cubierta por la regularización (`0` duplicados hoy). | **Informativa** | Ninguno. Documentar que «invitación» = alta inmediata. |
| **F9** | Borrados vs retención de auditoría | **PARCIAL** | `purge-test-relics.ts` borra: `reportes`, `antecedentes`, `pagos`, `reservas`, `servicios_barbero`, `usuario_roles`, `barberias`, `propuestas_horario` y `usuarios` (líneas 325–396). **No toca `auditoria`**: se conserva. `Auditoria.usuario` no declara `onDelete` ⇒ Prisma usa `SET NULL`; `barberiaId` es `onDelete: SetNull` (schema:693-712). Medición: `auditoria_huerfana_usuario=0` y `auditoria_sede_inexistente=0` en Neon. **Pero** al borrar cuentas/sedes se pierde la **autoría** del evento (`usuario_id` → NULL) y quedan `entidad_id` colgando sin FK, así que la traza «quién hizo qué» sobrevive solo en `contexto` JSON. | **Media** | Para cuentas con historial: suspender en lugar de borrar (`estado_cuenta='SUSPENDIDO'`), y/o snapshot del correo/rol en `contexto` antes del borrado. Rama `fix/t17-f9-auditoria-retencion`. |

**Consultas ejecutadas (solo lectura, motor Neon `production`):**

```sql
-- F1
SELECT ur.usuario_id, r.nombre, ur.barberia_id
  FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
 WHERE r.nombre = 'ADMIN_BARBERIA' AND ur.barberia_id IS NULL;      -- 0 filas
-- F9
SELECT COUNT(*) FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
 WHERE a.usuario_id IS NOT NULL AND u.id IS NULL;                    -- 0
-- F5
SELECT current_user, (SELECT tableowner FROM pg_tables WHERE tablename='usuario_roles'),
       has_table_privilege('usuario_roles','TRIGGER'),
       current_setting('session_replication_role'),
       (SELECT rolsuper FROM pg_roles WHERE rolname=current_user);
-- → neondb_owner | neondb_owner | true | origin | false
```

Resumen numérico de la base de producción en el momento de la auditoría:

```
admin_sin_sede=0  auditoria_huerfana_usuario=0  auditoria_sede_inexistente=0
sedes_sin_admin_util=0  sedes_con_duplicados=0
```

---

## Conclusión de la Parte A

El blindaje **funciona en el camino normal** (tres puertas + trigger + advisory lock, con tests), pero deja cuatro huecos de severidad alta que no son de lógica del trigger sino de **supuestos**:

1. **F1** — `barberia_id` nulo en un rol de sede es «comodín» en analíticas (fuga de datos entre sedes si alguna vez aparece esa fila).
2. **F4** — «ACTIVO» significa estado del rol, no de la cuenta: una sede puede quedar bloqueada sin nadie que pueda entrar.
3. **F5** — la app conecta como dueña de las tablas: `DISABLE TRIGGER` está a su alcance, y `TRUNCATE` no lo dispara.
4. **F6** — en carrera el cliente recibe un 409 con **otro código y sin `adminActual`**, que la UI no sabe interpretar.

F2, F3, F7 y F9 son de severidad media/baja y en su mayoría se resuelven con validaciones explícitas y tests. F8 queda descartado.

**No se ha aplicado ningún fix.** Cada propuesta indica su rama `fix/<id>` con su test rojo/verde, pendiente de aprobación.
