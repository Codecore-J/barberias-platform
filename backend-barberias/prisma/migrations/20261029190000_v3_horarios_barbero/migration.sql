-- V3 fase 5 · horario semanal del barbero: días libres y descansos.
--
-- La tabla `horarios_barbero` existía desde el esquema inicial con solo
-- `hora_inicio`/`hora_fin`, y el motor de disponibilidad nunca la leía. Esta
-- migración la completa:
--   * `hora_inicio`/`hora_fin` pasan a NULLABLE para poder representar un día
--     libre sin inventar horas;
--   * se añaden los dos extremos del descanso (almuerzo) y la bandera
--     `es_dia_libre`;
--   * se fija UNA fila por barbero y día dentro de la sede.
--
-- Convención de `dia_semana`: ISO, 1 = lunes … 7 = domingo, la misma que usa
-- `TiempoService.diaSemana` y la tabla `horarios` de la sede.

-- AlterTable · un día libre no tiene horas
ALTER TABLE "horarios_barbero" ALTER COLUMN "hora_inicio" DROP NOT NULL;
ALTER TABLE "horarios_barbero" ALTER COLUMN "hora_fin" DROP NOT NULL;

-- AlterTable · descansos y día libre
ALTER TABLE "horarios_barbero" ADD COLUMN "hora_inicio_descanso" TIME;
ALTER TABLE "horarios_barbero" ADD COLUMN "hora_fin_descanso" TIME;
ALTER TABLE "horarios_barbero" ADD COLUMN "es_dia_libre" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex · una sola fila por barbero y día en la sede
CREATE UNIQUE INDEX "uk_horario_barbero_dia" ON "horarios_barbero"("barberia_id", "barbero_id", "dia_semana");

-- Reglas de dominio. Prisma no sabe expresarlas, así que viven en la base y
-- `scripts/check-integridad.cjs` las compara con las del repo por el sufijo
-- `_check`.
--
-- 1) Un día libre no tiene horas; un día trabajado sí, y en orden.
ALTER TABLE "horarios_barbero" ADD CONSTRAINT "horarios_barbero_jornada_check" CHECK (
    ("es_dia_libre" = true AND "hora_inicio" IS NULL AND "hora_fin" IS NULL)
    OR
    ("es_dia_libre" = false AND "hora_inicio" IS NOT NULL AND "hora_fin" IS NOT NULL AND "hora_inicio" < "hora_fin")
);

-- 2) El descanso es opcional, va entero (los dos extremos o ninguno) y cae
--    dentro de la jornada. Un almuerzo que empieza antes de entrar no es un
--    descanso: es un error de captura que dejaría huecos negativos en la agenda.
ALTER TABLE "horarios_barbero" ADD CONSTRAINT "horarios_barbero_descanso_check" CHECK (
    ("hora_inicio_descanso" IS NULL AND "hora_fin_descanso" IS NULL)
    OR
    (
        "es_dia_libre" = false
        AND "hora_inicio_descanso" IS NOT NULL
        AND "hora_fin_descanso" IS NOT NULL
        AND "hora_inicio_descanso" >= "hora_inicio"
        AND "hora_fin_descanso" <= "hora_fin"
        AND "hora_inicio_descanso" < "hora_fin_descanso"
    )
);
