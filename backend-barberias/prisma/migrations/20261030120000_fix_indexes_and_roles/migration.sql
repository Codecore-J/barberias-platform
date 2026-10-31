-- E0 · Integridad de roles e índices de las consultas calientes.
--
-- Orden obligatorio: primero se limpian los duplicados, después se borra la
-- restricción que no los impedía y solo al final se crean los índices únicos
-- parciales. Si se crearan antes, el propio CREATE UNIQUE INDEX fallaría con
-- los 27 duplicados que ya existen en `dev`.

-- 1. Deduplicar `usuario_roles` conservando una sola fila por combinación.
--
-- El `@@unique([usuario_id, rol_id, barberia_id])` anterior era inútil para los
-- roles globales: PostgreSQL considera DISTINTOS dos NULL, así que
-- `(usuario, rol, NULL)` se podía insertar sin límite y el JWT acababa con
-- roles repetidos. `IS NOT DISTINCT FROM` compara NULL = NULL (que es justo lo
-- que GROUP BY hace y lo que aquí queremos); el `ctid` deja vivo un único
-- representante físico, que basta porque las filas del grupo son idénticas en
-- todas sus columnas.
DELETE FROM "usuario_roles" a
USING "usuario_roles" b
WHERE a.ctid > b.ctid
  AND a."usuario_id" = b."usuario_id"
  AND a."rol_id" = b."rol_id"
  AND a."barberia_id" IS NOT DISTINCT FROM b."barberia_id";

-- 2. Retirar la restricción no parcial.
--
-- El nombre depende de cómo se creó la base: las migraciones la declaraban como
-- `uk_usuario_rol_barberia`, mientras que las bases levantadas con `db push`
-- tienen el nombre por defecto de Prisma. `IF EXISTS` cubre ambos casos y hace
-- la migración re-ejecutable si el índice ya no está.
DROP INDEX IF EXISTS "uk_usuario_rol_barberia";
DROP INDEX IF EXISTS "usuario_roles_usuario_id_rol_id_barberia_id_key";

-- 3. Unicidad real, en dos índices PARCIALES (Prisma no puede expresarlos).
--
-- Dos filas con el mismo (usuario, rol) y barbería nula son el mismo rol global;
-- dos con la misma sede son el mismo rol de sede. Al separar el caso nulo del no
-- nulo, el motor sí compara lo que hay que comparar.
CREATE UNIQUE INDEX "uk_usuario_rol_global"
ON "usuario_roles"("usuario_id", "rol_id")
WHERE "barberia_id" IS NULL;

CREATE UNIQUE INDEX "uk_usuario_rol_sede"
ON "usuario_roles"("usuario_id", "rol_id", "barberia_id")
WHERE "barberia_id" IS NOT NULL;

-- 4. Índices de las consultas que hoy hacen Seq Scan.
--
-- `idx_reservas_concurrencia` empieza por `barberia_id`, así que no sirve para
-- el cron de expiración (`estado IN (...) AND expira_at <= now`), ni para "mis
-- reservas" (cliente), ni para la agenda por barbero.
CREATE INDEX "reservas_cliente_id_idx" ON "reservas"("cliente_id");
CREATE INDEX "reservas_barbero_id_idx" ON "reservas"("barbero_id");
CREATE INDEX "reservas_estado_expira_at_idx" ON "reservas"("estado", "expira_at");

-- La bandeja de notificaciones filtra por usuario y estado; la tabla no tenía
-- ningún índice.
CREATE INDEX "notificaciones_usuario_id_estado_idx" ON "notificaciones"("usuario_id", "estado");

-- El catálogo se lista siempre por sede.
CREATE INDEX "servicios_barberia_id_idx" ON "servicios"("barberia_id");
