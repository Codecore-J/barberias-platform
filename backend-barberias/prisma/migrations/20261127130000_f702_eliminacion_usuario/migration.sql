-- F7 / T-72 · soporte de esquema para la eliminación real de una cuenta.
--
-- El borrado desvincula el historial en vez de destruirlo:
--
-- 1. `pagos` y `cierres_caja` guardan el NOMBRE de quien operó. Sin esa copia,
--    poner el FK en NULL dejaría un cobro o un arqueo sin nadie identificable y
--    la sede perdería el rastro de quién lo hizo. El nombre es el único dato que
--    la fila necesita para seguir siendo legible.
-- 2. `reservas.cliente_id` pasa a NULL en el borrado: las reservas PASADAS se
--    conservan como historial de la sede (con su importe y su servicio
--    congelados), aunque ya no apunten a una cuenta. Las futuras las cancela el
--    servicio antes de borrar. Con RESTRICT, cualquier cuenta con historial era
--    imposible de eliminar.
--
-- Idempotente: no borra ni reescribe datos.

ALTER TABLE "pagos"
  ADD COLUMN IF NOT EXISTS "usuario_nombre_snapshot" VARCHAR(150);

ALTER TABLE "cierres_caja"
  ADD COLUMN IF NOT EXISTS "usuario_nombre_snapshot" VARCHAR(150);

ALTER TABLE "reservas"
  ALTER COLUMN "cliente_id" DROP NOT NULL;

-- La FK nace con RESTRICT; se recrea como SET NULL. `DROP ... IF EXISTS` cubre
-- el caso de una base donde ya se aplicó a mano.
ALTER TABLE "reservas" DROP CONSTRAINT IF EXISTS "reservas_cliente_id_fkey";

ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_cliente_id_fkey"
  FOREIGN KEY ("cliente_id") REFERENCES "usuarios"("id") ON DELETE SET NULL;
