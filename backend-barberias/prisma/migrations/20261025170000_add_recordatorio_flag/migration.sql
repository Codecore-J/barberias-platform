-- Fase 7 · recordatorio preventivo de no-show.
--
-- `recordatorio_enviado` es la barrera de idempotencia del cron: el servicio
-- marca la reserva con un `updateMany` condicionado a `false` y solo emite el
-- evento si ESE update ganó la carrera. Así dos ejecuciones solapadas —o dos
-- instancias del API— no avisan dos veces de la misma cita.
ALTER TABLE "reservas"
  ADD COLUMN IF NOT EXISTS "recordatorio_enviado" BOOLEAN NOT NULL DEFAULT false;

-- El barrido del cron filtra por fecha de cita, estado y flag. El índice de
-- concurrencia existente empieza por `barberia_id`, así que no sirve para una
-- consulta global por fecha.
CREATE INDEX IF NOT EXISTS "idx_reservas_recordatorio_pendiente"
  ON "reservas" ("fecha_cita", "estado", "recordatorio_enviado");
