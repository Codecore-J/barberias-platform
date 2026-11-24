-- T-24 (24 nov 2026) · imagen del servicio del catálogo híbrido.
--
-- El barbero puede subir una foto de su servicio. Solo se guarda la URL que
-- devuelve Cloudinary; el archivo vive en Cloudinary y nunca en la base.
--
-- Idempotente a propósito: si `imagen_url` ya existe (por ejemplo, en un
-- entorno donde se aplicó a mano), `ADD COLUMN IF NOT EXISTS` no la recrea ni
-- pierde las URLs ya guardadas.

ALTER TABLE "servicios_barbero" ADD COLUMN IF NOT EXISTS "imagen_url" VARCHAR(500);
