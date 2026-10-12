-- E4-02 /8 · D22: la sede puede apagar las oportunidades de espacio.
-- Gobierna el endpoint GET .../disponibilidad/huecos: con FALSE la respuesta
-- sigue siendo 200 pero con la lista VACÍA (no 403), para que el contrato del
-- endpoint no dependa de la configuración de cada tenant.
ALTER TABLE "configuracion_barberia"
  ADD COLUMN "oportunidades_espacio_activas" BOOLEAN NOT NULL DEFAULT TRUE;
