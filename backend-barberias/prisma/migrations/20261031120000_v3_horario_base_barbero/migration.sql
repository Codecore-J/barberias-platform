-- V3 · plantilla semanal del barbero y autoría de las excepciones de horario.
--
-- Dos cambios independientes que viajan juntos porque el segundo describe
-- quién tocó el horario que el primero modela:
--
--   1. `excepciones_horario_barbero` gana el rastro de autoría. El ORIGEN
--      (el propio barbero o un admin de la sede) es obligatorio con default
--      BARBERO; el usuario concreto es opcional porque las filas anteriores a
--      esta migración no lo tienen y preferimos un autor desconocido a uno
--      inventado.
--   2. `horarios_base_barbero` es la plantilla semanal recurrente SIN sede:
--      una fila por barbero y día de la semana. El horario efectivo dentro de
--      la sede sigue viviendo en `horarios_barbero`.
--
-- ⚠️ Convención de `dia_semana`: AQUÍ 0 = domingo … 6 = sábado, mientras que
-- `horarios`, `horarios_barbero` y `TiempoService.diaSemana` usan ISO
-- 1 = lunes … 7 = domingo. El CHECK acota esta tabla a 0–6; cualquier lectura
-- cruzada debe convertir con `diaIso = diaBase === 0 ? 7 : diaBase`.

-- CreateEnum · quién modificó una excepción de horario.
CREATE TYPE "OrigenModificacionHorario" AS ENUM ('BARBERO', 'ADMIN_SEDE');

-- AlterTable · autoría del cambio en la excepción.
--
-- `modificado_por` es NOT NULL con default: las filas históricas quedan como
-- BARBERO, que es la lectura correcta (nadie más tenía acceso a ese horario
-- cuando se crearon).
ALTER TABLE "excepciones_horario_barbero"
  ADD COLUMN "modificado_por" "OrigenModificacionHorario" NOT NULL DEFAULT 'BARBERO',
  ADD COLUMN "modificado_por_id" UUID;

-- CreateTable · plantilla semanal recurrente del barbero (sin sede).
CREATE TABLE "horarios_base_barbero" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "barbero_id" UUID NOT NULL,
  "dia_semana" SMALLINT NOT NULL,
  "hora_inicio" VARCHAR(5) NOT NULL,
  "hora_fin" VARCHAR(5) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "horarios_base_barbero_pkey" PRIMARY KEY ("id")
);

-- CreateIndex · una sola plantilla por barbero y día.
CREATE UNIQUE INDEX "uk_horario_base_barbero_dia"
  ON "horarios_base_barbero"("barbero_id", "dia_semana");

-- AddForeignKey · borrar al usuario se lleva su plantilla.
ALTER TABLE "horarios_base_barbero"
  ADD CONSTRAINT "horarios_base_barbero_barbero_id_fkey"
  FOREIGN KEY ("barbero_id") REFERENCES "usuarios"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey · borrar al autor deja la excepción sin autor, no sin fila.
ALTER TABLE "excepciones_horario_barbero"
  ADD CONSTRAINT "excepciones_horario_barbero_modificado_por_id_fkey"
  FOREIGN KEY ("modificado_por_id") REFERENCES "usuarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Reglas de dominio. Prisma no sabe expresar CHECK, así que viven en la base y
-- `scripts/check-integridad.cjs` las compara con las del repo por el sufijo
-- `_check`.
--
-- 1) La convención propia de esta tabla es 0 = domingo … 6 = sábado. Un 7 (que
--    es el domingo del resto del motor) aquí sería un día inexistente y la
--    plantilla dejaría de aplicarse en silencio.
ALTER TABLE "horarios_base_barbero" ADD CONSTRAINT "horarios_base_barbero_dia_check"
  CHECK ("dia_semana" BETWEEN 0 AND 6);

-- 2) Las horas son texto "HH:mm": se valida el formato además del orden, porque
--    una cadena libre como "9:5" se guardaría sin protestar y luego no
--    compararía contra las horas `TIME` del motor de disponibilidad.
ALTER TABLE "horarios_base_barbero" ADD CONSTRAINT "horarios_base_barbero_jornada_check"
  CHECK (
    "hora_inicio" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "hora_fin" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "hora_inicio" < "hora_fin"
  );
