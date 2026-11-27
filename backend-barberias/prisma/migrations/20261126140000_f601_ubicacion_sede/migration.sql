-- F6 / T-60 · ubicación geográfica de la sede.
--
-- La sede gana coordenadas y divisiones político-administrativas. Hasta ahora
-- solo tenía `ubicacion` (texto libre), que no sirve para buscar «la barbería
-- más cercana» ni para agrupar por provincia.
--
-- TODAS las columnas son NULLABLES: las sedes que ya existen se crearon sin
-- coordenadas y esta migración no las rellena con un punto inventado. La
-- obligatoriedad es del alta (T-62, `CreateBarberiaDto` exige latitud y
-- longitud), no de la tabla; así una sede histórica sigue siendo válida.
--
-- Idempotente (`ADD COLUMN IF NOT EXISTS`): la columna puede llegar también de
-- otra migración o de un ensayo previo y la base no debe reventar con
-- «column already exists» (H50). No hay `DROP`, `TRUNCATE`, `DELETE` ni
-- `UPDATE`: esta migración no borra ni reescribe ninguna fila.
--
-- `DECIMAL(10,7)` ≈ precisión de 1 cm, de sobra para una dirección.

ALTER TABLE "barberias"
  ADD COLUMN IF NOT EXISTS "latitud"            DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "longitud"           DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "pais_codigo"        VARCHAR(2),
  ADD COLUMN IF NOT EXISTS "division_nivel1"    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "division_nivel2"    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "direccion_completa" VARCHAR(300);
