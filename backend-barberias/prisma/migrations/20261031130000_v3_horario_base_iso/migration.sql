-- V3 · la plantilla semanal del barbero adopta la numeración ISO del motor.
--
-- La migración anterior la creó con 0 = domingo … 6 = sábado, mientras que
-- `horarios`, `horarios_barbero` y `TiempoService.diaSemana` usan ISO
-- 1 = lunes … 7 = domingo. Dos convenciones en la misma base obligan a
-- convertir en cada lectura cruzada y basta un despiste para desplazar la
-- semana entera un día; se unifica en ISO antes de que existan consumidores.
--
-- Orden obligatorio: convertir los datos ANTES de cambiar el CHECK (si no, el
-- UPDATE choca con el rango viejo) y resolver la posible colisión con el índice
-- único antes de convertir.

-- 1. Un domingo (0) pasa a ser 7. Si ese barbero ya tenía una fila para el 7
--    (imposible con el CHECK anterior, pero la tabla pudo llenarse a mano), la
--    conversión violaría `uk_horario_base_barbero_dia`: se descarta la fila del
--    0 y se conserva la del 7, que ya está en la numeración nueva.
DELETE FROM "horarios_base_barbero" a
USING "horarios_base_barbero" b
WHERE a."dia_semana" = 0
  AND b."dia_semana" = 7
  AND a."barbero_id" = b."barbero_id";

UPDATE "horarios_base_barbero"
SET "dia_semana" = 7
WHERE "dia_semana" = 0;

-- 2. El rango pasa a 1–7. Mismo nombre que el CHECK anterior para que el
--    inventario de `scripts/check-integridad.cjs` siga cuadrando con la base.
ALTER TABLE "horarios_base_barbero"
  DROP CONSTRAINT IF EXISTS "horarios_base_barbero_dia_check";

ALTER TABLE "horarios_base_barbero" ADD CONSTRAINT "horarios_base_barbero_dia_check"
  CHECK ("dia_semana" BETWEEN 1 AND 7);
