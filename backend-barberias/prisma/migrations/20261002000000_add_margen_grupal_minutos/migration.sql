-- D42 (decisión 2026-10-02): margen grupal como campo propio de la barbería.
-- Default 10, rango permitido 0-60 minutos. Se snapshottea al crear la reserva.
ALTER TABLE "configuracion_barberia"
  ADD COLUMN "margen_grupal_minutos" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "configuracion_barberia"
  ADD CONSTRAINT "configuracion_barberia_margen_grupal_minutos_check"
  CHECK ("margen_grupal_minutos" >= 0 AND "margen_grupal_minutos" <= 60);
