-- F3-01 · el nombre que el operador teclea para un cliente sin cuenta.
--
-- En un walk-in `reservas.cliente_id` es el OPERADOR de la sede (T-05), así que
-- el nombre visible de la cita necesita su propia columna. Nullable: las filas
-- existentes y las reservas del propio cliente no tienen nombre invitado.
ALTER TABLE "reservas" ADD COLUMN "nombre_invitado" VARCHAR(150);