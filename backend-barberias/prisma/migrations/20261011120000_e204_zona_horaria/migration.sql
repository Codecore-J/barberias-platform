-- E2-04 / D15 · Zona horaria de la barbería (hallazgo H36).
--
-- Las fechas y horas de cita (`reservas.fecha_cita`, `hora_inicio`, `hora_fin`,
-- `horarios`, `excepciones_horario`, `bloqueos_agenda`) son ETIQUETAS de
-- calendario locales a la sede; los instantes (`expira_at`, `creado_at`) son
-- UTC (`TIMESTAMPTZ`). Sin esta columna el instante real de una cita se
-- reconstruía con la zona del SERVIDOR (Render corre en UTC), y una sede en
-- UTC-4 quedaba con la ventana de cancelación ~4 h tarde.
--
-- El DEFAULT es el valor del catálogo D15 y cubre las filas existentes; el
-- CHECK del catálogo de zonas llega con E2-03.
ALTER TABLE "barberias"
  ADD COLUMN "zona_horaria" VARCHAR(50) NOT NULL DEFAULT 'America/Santo_Domingo';
