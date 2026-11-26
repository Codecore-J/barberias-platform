-- F6 / T-64 · logo de la sede por subida de archivo.
--
-- El logo deja de ser una URL que se escribe a mano y pasa a ser un archivo que
-- sube el ADMIN_BARBERIA de la sede. Para poder BORRAR el archivo anterior en
-- Cloudinary hace falta su `public_id`: deducirlo de la URL es posible
-- (`CloudinaryService.publicIdDe`) pero se rompe con transformaciones o con
-- URLs que no son de Cloudinary, y deja huérfanos en cada cambio.
--
-- Idempotente (`ADD COLUMN IF NOT EXISTS`): la misma base puede recibir la
-- columna desde otra migración o desde un ensayo previo (H50). Esta migración
-- solo AÑADE: las sedes existentes quedan con `NULL` y su logo actual (si lo
-- tienen) se sigue mostrando desde `logo_url`.

ALTER TABLE "barberias"
  ADD COLUMN IF NOT EXISTS "logo_public_id" VARCHAR(255);
