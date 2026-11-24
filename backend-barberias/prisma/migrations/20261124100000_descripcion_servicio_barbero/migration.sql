-- T-23 (24 nov 2026) · descripción del servicio del catálogo híbrido.
--
-- El servicio que publica el BARBERO (`servicios_barbero`) solo tenía nombre,
-- precio y duración. T-23 le añade una descripción OPCIONAL de 500 caracteres,
-- el mismo tope que `servicios.descripcion` (migración 20261123190000).
--
-- Idempotente a propósito: `ADD COLUMN IF NOT EXISTS` permite volver a correrla
-- sobre una base donde el campo ya exista sin recrear la tabla ni perder filas.

ALTER TABLE "servicios_barbero" ADD COLUMN IF NOT EXISTS "descripcion" VARCHAR(500);
