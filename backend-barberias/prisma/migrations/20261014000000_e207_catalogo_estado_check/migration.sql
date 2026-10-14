-- E2-07 · D29: el estado del CATÁLOGO deja de ser texto libre.
--
-- Al pasar de borrado a cambio de estado (`PATCH .../desactivar` y
-- `.../reactivar`) el estado de un servicio o de un combo pasó a ser una pieza
-- de vocabulario del diseño, como el de una reserva o el de una sede. Pero la
-- base seguía admitiendo cualquier cadena en esas dos columnas: `barberias` y
-- `reservas` tenían su CHECK desde E2-03 y el catálogo no (H50 · hueco P-SD-4).
--
-- Auditoría de datos previa (SOLO LECTURA sobre `dev`, 2026-10-14) — ningún
-- valor queda fuera del catálogo, así que el ALTER no puede fallar por datos:
--   servicios.estado → ACTIVO (125); combos.estado → ACTIVO (4)
-- ambas columnas son VARCHAR(20) NOT NULL DEFAULT 'ACTIVO' y las dos tablas
-- tenían 0 CHECK antes de esta migración (`pg_constraint` por `conrelid`).
--
-- Aditiva: declara los dos CHECK con el NOMBRE que espera la guardia
-- (`npm run check:integridad` los recoge solo, sin tocar el script: compara
-- `prisma/migrations/**` contra `pg_constraint` en las dos direcciones). No
-- reformula ningún CHECK existente ni toca datos.

ALTER TABLE "servicios"
  ADD CONSTRAINT "servicios_estado_check"
  CHECK ("estado" IN ('ACTIVO', 'INACTIVO'));

ALTER TABLE "combos"
  ADD CONSTRAINT "combos_estado_check"
  CHECK ("estado" IN ('ACTIVO', 'INACTIVO'));
