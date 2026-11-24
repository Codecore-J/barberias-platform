-- Imagen del servicio · `public_id` de Cloudinary en su propia columna.
--
-- Hasta ahora el `public_id` se deducía de la URL guardada. Guardarlo aparte
-- permite borrar la imagen anterior con el identificador exacto que devolvió
-- Cloudinary, sin depender de cómo esté formada la URL.
--
-- Idempotente: si una entrega anterior ya añadió la columna, no falla ni la
-- recrea. No se toca ninguna otra columna ni se recrea la tabla.

ALTER TABLE "servicios_barbero"
  ADD COLUMN IF NOT EXISTS "imagen_public_id" VARCHAR(255);
