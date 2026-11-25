-- F4-03 · propuesta de horario base del barbero.
--
-- La decisión 9 del dueño (22 nov 2026): `PUT /shops/:shopId/mi-horario/base`
-- deja de escribir la plantilla vigente y crea una PROPUESTA que el
-- ADMIN_BARBERIA resuelve con `horario.base.aprobar` (ruta nueva de F4-04).
--
-- `dias` guarda la semana COMPLETA propuesta (7 filas con dia_semana, horas y
-- activo) porque aprobar aplica la propuesta entera: un upsert parcial sobre la
-- plantilla vigente dejaría la decisión a medias.
--
-- El historial no se borra: una APROBADA o RECHAZADA se conserva y la siguiente
-- propuesta del barbero para esa sede es otra fila. Lo que sí impide el índice
-- único parcial es tener DOS pendientes a la vez: un segundo envío reemplaza a
-- la anterior en lugar de encolar dos versiones de lo mismo.
--
-- Idempotente (`IF NOT EXISTS`). No toca ninguna tabla existente ni borra datos.

CREATE TABLE IF NOT EXISTS "propuestas_horario_base" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "barberia_id"    UUID NOT NULL,
  "barbero_id"     UUID NOT NULL,
  "estado"         VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  "dias"           JSONB NOT NULL,
  "motivo_rechazo" VARCHAR(500),
  "resuelto_por"   UUID,
  "resuelta_at"    TIMESTAMPTZ,
  "creado_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "actualizado_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "propuestas_horario_base_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "propuestas_horario_base_sede_fkey"
    FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE,
  CONSTRAINT "propuestas_horario_base_barbero_fkey"
    FOREIGN KEY ("barbero_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
  CONSTRAINT "propuestas_horario_base_resolutor_fkey"
    FOREIGN KEY ("resuelto_por") REFERENCES "usuarios"("id") ON DELETE SET NULL,
  CONSTRAINT "propuestas_horario_base_estado_check"
    CHECK ("estado" IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  -- Una RECHAZADA exige motivo con texto; las demás no pueden tenerlo.
  CONSTRAINT "propuestas_horario_base_motivo_check"
    CHECK (
      ("estado" = 'RECHAZADA' AND "motivo_rechazo" IS NOT NULL AND btrim("motivo_rechazo") <> '')
      OR ("estado" <> 'RECHAZADA' AND "motivo_rechazo" IS NULL)
    ),
  -- La semana propuesta es una lista no vacía: aprobarla debe aplicar algo.
  CONSTRAINT "propuestas_horario_base_dias_check"
    CHECK (jsonb_typeof("dias") = 'array' AND jsonb_array_length("dias") > 0)
);

-- Una sola propuesta PENDIENTE por (barbero, sede): el segundo envío la
-- reemplaza. Prisma no expresa índices parciales; la garantía vive aquí.
CREATE UNIQUE INDEX IF NOT EXISTS "uk_propuesta_base_pendiente"
  ON "propuestas_horario_base"("barbero_id", "barberia_id")
  WHERE "estado" = 'PENDIENTE';

-- Bandeja de la sede (F4-04): pendientes de esta barbería.
CREATE INDEX IF NOT EXISTS "idx_propuestas_base_sede_estado"
  ON "propuestas_horario_base"("barberia_id", "estado");
