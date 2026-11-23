-- T-22 (23 nov 2026) · la descripción vuelve al catálogo de servicios de la sede.
--
-- DEF-03 había dejado el campo fuera del contrato y del modelo. La columna es
-- opcional (los 6 servicios de producción no tienen texto que migrar) y de 500
-- caracteres, el mismo tope que valida `CreateServicioDto`.
--
-- Idempotente a propósito: `ADD COLUMN IF NOT EXISTS` permite volver a correrla
-- sobre una base donde el campo ya exista sin recrear la tabla ni perder filas.

ALTER TABLE "servicios" ADD COLUMN IF NOT EXISTS "descripcion" VARCHAR(500);
