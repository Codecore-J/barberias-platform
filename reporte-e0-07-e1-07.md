TAREA: E0-07 (arranque de base limpia) + E1-07 (límite de 2 barberías y auditoría)
RAMA: fix/e0-e1-cimientos-finales

## 1. QUÉ HICE

- El seed crea los cuatro roles (CLIENTE, ADMIN_BARBERIA, BARBERO, ADMINISTRADOR) y asigna permisos a ADMIN_BARBERIA.
- `BarberiaService.create` cuenta las sedes ACTIVAS dentro de la transacción SERIALIZABLE y rechaza la tercera con 422 `LIMITE_BARBERIAS`.
- El creador recibe ADMIN_BARBERIA en la sede nueva; el ADMINISTRADOR global queda exento. Sin rol, ya no se crea la sede en silencio: falla con 500 explícito.
- Se emite `BARBERIA_CREADA` en la misma transacción, con `barberia_id` en columna propia (`auditoria.barberia_id`) e índice.
- Nuevo `npm run admin:create` (con `tsx`) y pruebas unitarias de límite, borde, rol y guardia del seed.

## 2. ARCHIVOS TOCADOS (`git diff --cached --stat`, literal)

```
 backend-barberias/package.json                     |   1 +
 .../migration.sql                                  |  23 ++++
 backend-barberias/prisma/schema.prisma             |  23 ++--
 backend-barberias/prisma/seed.ts                   |  22 +++-
 .../application/auditoria.service.spec.ts          |  19 ++-
 .../src/auditoria/application/auditoria.service.ts |  26 +++-
 .../barberia/application/barberia.service.spec.ts  | 103 ++++++++++++++++
 .../src/barberia/application/barberia.service.ts   | 108 +++++++++++++----
 .../barberia/infrastructure/barberia.controller.ts |   4 +-
 backend-barberias/src/cli/create-admin.ts          | 131 +++++++++++++++++++++
 backend-barberias/test/barberia.e2e-spec.ts        |  19 +--
 backend-barberias/test/seed-roles.spec.ts          |  40 +++++++
 12 files changed, 469 insertions(+), 50 deletions(-)
```

## 3. TEST ROJO

Ejecutado contra el `BarberiaService` anterior (stash temporal del archivo de producción):

```
       × crea la sede y asigna ADMIN_BARBERIA al responsable en ESA sede 341ms
       ✓ permite crear la segunda sede ACTIVA (borde del límite) 5ms
       × rechaza la tercera sede ACTIVA con 422 LIMITE_BARBERIAS 6ms
       × no crea la sede si falta el rol ADMIN_BARBERIA (E0-07, sin silencio) 5ms
       × un ADMINISTRADOR global no necesita la fila de ADMIN_BARBERIA 7ms
 Tests  4 failed | 1 passed | 72 skipped (77)
```

## 4. TEST VERDE

```
 ✓ src/barberia/application/barberia.service.spec.ts (77 tests | 72 skipped) 320ms
       ✓ crea la sede y asigna ADMIN_BARBERIA al responsable en ESA sede  301ms
 Test Files  1 passed (1)
      Tests  5 passed | 72 skipped (77)
```

## 5. SUITE COMPLETA (`npm run test`, resumen literal)

```
 Test Files  52 passed (52)
      Tests  634 passed (634)
```

También ejecutado, con el mismo resultado:

- `TZ=UTC`: 52 archivos, 634/634.
- `TZ=America/Santo_Domingo`: 52 archivos, 634/634.
- `npm run lint`: EXIT=0 (103 warnings, 0 errores; el baseline era 85 warnings).
- `npm run build`: EXIT=0.

## 6. CRITERIOS DE ACEPTACIÓN

- [x] El seed crea `ADMIN_BARBERIA` además de CLIENTE, BARBERO y ADMINISTRADOR. Evidencia: `prisma/seed.ts` + `test/seed-roles.spec.ts` (2/2).
- [x] Si al creador le falta el rol, la sede no se crea sin responsable operativo. Evidencia: prueba "no crea la sede si falta el rol ADMIN_BARBERIA" (500 y `barberia.create` no llamado).
- [x] El creador recibe ADMIN_BARBERIA en la sede nueva. Evidencia: `usuarioRol.upsert` con `barberiaId` de la sede creada.
- [x] Un ADMINISTRADOR global no requiere la fila por tenant. Evidencia: prueba dedicada (no llama a `usuarioRol.upsert`).
- [x] Existe `npm run admin:create` con alta idempotente y fallo seguro. Evidencia: script `src/cli/create-admin.ts`; sin `APP_ENV`, sin correo, sin teléfono y en producción sin confirmación aborta con mensaje y EXIT=1.
- [x] El límite cuenta solo sedes ACTIVAS del responsable y es 2. Evidencia: `barberia.count({ where: { responsableId, estado: 'ACTIVO' } })` y constantes `MAX_BARBERIAS_POR_RESPONSABLE = 2`; prueba de borde con 1 sede (permite) y con 2 (rechaza).
- [x] La tercera sede ACTIVA devuelve 422 `LIMITE_BARBERIAS` y no escribe. Evidencia: prueba con `status 422`, `codigo LIMITE_BARBERIAS` y `barberia.create` no llamado.
- [x] `BARBERIA_CREADA` se audita con la sede correcta en columna. Evidencia: `barberiaId: barberia.id` y prueba que verifica `auditoria.registrarEvento` con esa columna.
- [x] La auditoría por sede deja de depender solo del JSON. Evidencia: modelo `Auditoria.barberiaId` + índice `(barberia_id, creado_at)` + migración con backfill de UUID y fallback para filas históricas.

## 7. DECISIONES O DESVIACIONES

- **`tsx` en lugar de `ts-node`**: el proyecto no tiene `ts-node` instalado; `seed` ya usa `npx tsx`. El script quedó como `"admin:create": "tsx src/cli/create-admin.ts"`.
- **`ADMIN_PHONE` obligatorio**: `usuarios.telefono` es UNIQUE; un relleno fijo rompía el segundo administrador. Se valida antes de tocar la base. En una rotación de contraseña el valor se ignora.
- **El script no escribe `estado_cuenta`**: el alta nace ACTIVO por defecto y una cuenta suspendida no se reactiva al crear un administrador; así se conserva la guardia D48 (`test/estado-cuenta-guard.spec.ts`).
- **`entidad: 'barberias'`** para `BARBERIA_CREADA`, alineado con `BARBERIA_SUSPENDIDA`/`BARBERIA_REACTIVADA` del mismo servicio.
- **Columna `auditoria.barberia_id`**: se añadió para atender la observación de E3-01/A-15 (no filtrar solo por JSON). El servicio promueve `contexto.barberiaId` a la columna para los llamadores existentes.
- **Fixture del e2e de vinculación**: `test/barberia.e2e-spec.ts` creaba 6 sedes por API para probar el límite de vinculaciones (D10). Con E1-07 eso ya no es posible; las 5 sedes extra se siembran con Prisma porque son fixtures, no el objeto de la prueba.
- **Sin throttling de 3 altas/hora**: la recomendación de auditoría lo menciona, pero no formaba parte del alcance pedido y no se añadió un límite de peticiones nuevo.

## 8. HALLAZGOS NUEVOS

- **E0-07-A (media)**: la migración `20261019120000_e0e1_auditoria_barberia_id` está creada pero **no aplicada** en la base de `dev` (Neon): `prisma migrate status` la reporta como pendiente. Hasta aplicarla, el código que escribe `auditoria.barberia_id` fallaría contra esa base.
- **E1-07-A (baja)**: el e2e no se pudo ejecutar localmente (no hay Postgres/Docker disponible en este entorno); el ajuste del fixture quedó verificado solo por revisión y por el build.
- **E0-07-B (baja)**: `test/seed-roles.spec.ts` es una guardia estática sobre el fuente del seed; no prueba contra una base real que el seed sea idempotente dos veces.

## 9. PENDIENTE O NO VERIFICADO

- Aplicar la migración en `dev` y ejecutar el seed dos veces sobre una base limpia.
- Ejecutar `npm run admin:create` contra una base real (requiere seed y variables válidas).
- Ejecutar la suite e2e con Postgres/Redis (`npm run test:e2e`); en este entorno no hay base ni Docker.
- `npm run check:integridad` requiere base de datos y no se ejecutó.
- No se tocó el frontend; sus 93 pruebas no se volvieron a ejecutar en esta rama.

## 10. GIT

`git status --short` antes del commit: solo los 12 archivos de la tarea en staging; los informes de auditoría preexistentes quedaron sin tocar y sin stage.

`git log --oneline -5`:

```
07e8b2e Merge pull request #77 from Codecore-J/fix/cierre-salvedades-estabilizacion
bf5544d fix: cerrar salvedades de estabilización (H72, T4, H65, H66)
7afbb95 Merge pull request #76 from Codecore-J/chore/h76-e2e-pagos-anulacion
71d2ae5 fix: resolve merge conflict in pago.service.ts (stray markers)
4c9547b Merge branch 'main' into chore/h76-e2e-pagos-anulacion
```

No se hace merge. Se sube la rama para revisión.
