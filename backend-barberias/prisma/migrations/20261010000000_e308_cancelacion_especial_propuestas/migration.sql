-- E3-08 · Cancelación especial (D17) + Propuesta de horario (D18).

-- ─────────────────────────────────────────────────────────────────────────────
-- D17 · Cancelación especial
-- ─────────────────────────────────────────────────────────────────────────────
-- La bandera por defecto es FALSE: una sede no acepta cancelaciones especiales
-- hasta que lo habilita explícitamente (fail-closed).
ALTER TABLE "configuracion_barberia"
  ADD COLUMN "permite_cancelacion_especial" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "reservas"
  ADD COLUMN "cancelado_por_id" UUID,
  ADD COLUMN "cancelacion_especial_estado" VARCHAR(20),
  ADD COLUMN "cancelacion_especial_motivo" VARCHAR(40),
  ADD COLUMN "cancelacion_especial_detalle" TEXT;

ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_cancelado_por_id_fkey"
  FOREIGN KEY ("cancelado_por_id") REFERENCES "usuarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Estados del ciclo de la cancelación especial. `SOLICITADA` queda previsto para
-- el flujo de solicitud del cliente; en esta entrega el admin la resuelve de una
-- vez y la fila queda en `APROBADA` (o `RECHAZADA` si no procede).
ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_cancelacion_especial_estado_check"
  CHECK (
    "cancelacion_especial_estado" IS NULL
    OR "cancelacion_especial_estado" IN ('SOLICITADA', 'APROBADA', 'RECHAZADA')
  );

-- Catálogo de cancelación de §5.5. Es un CHECK aparte del `reservas_motivo_codigo_check`
-- (que enumera el catálogo de RECHAZO): son catálogos distintos sobre columnas distintas.
ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_cancelacion_especial_motivo_check"
  CHECK (
    "cancelacion_especial_motivo" IS NULL
    OR "cancelacion_especial_motivo" IN (
      'EMERGENCIA',
      'ENFERMEDAD',
      'CIERRE_IMPREVISTO',
      'FUERZA_MAYOR',
      'OTRO'
    )
  );

-- §5.5: `OTRO` exige un detalle de al menos 5 caracteres.
ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_cancelacion_especial_otro_detalle_check"
  CHECK (
    "cancelacion_especial_motivo" IS DISTINCT FROM 'OTRO'
    OR char_length(coalesce("cancelacion_especial_detalle", '')) >= 5
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- D18 · Propuesta de horario
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "propuestas_horario" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "reserva_id"  UUID        NOT NULL,
  "fecha_cita"  DATE        NOT NULL,
  "hora_inicio" TIME        NOT NULL,
  "hora_fin"    TIME        NOT NULL,
  "tipo"        VARCHAR(30) NOT NULL,
  "estado"      VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  "expira_at"   TIMESTAMPTZ,
  "creado_por"  UUID        NOT NULL,
  "creado_at"   TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT "propuestas_horario_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "propuestas_horario_reserva_id_fkey"
    FOREIGN KEY ("reserva_id") REFERENCES "reservas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "propuestas_horario_creado_por_fkey"
    FOREIGN KEY ("creado_por") REFERENCES "usuarios"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "propuestas_horario_tipo_check"
    CHECK ("tipo" IN ('PROPUESTA_INICIAL', 'REPROGRAMACION', 'ADELANTO')),
  CONSTRAINT "propuestas_horario_estado_check"
    CHECK ("estado" IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'EXPIRADA'))
);

CREATE INDEX "idx_propuestas_horario_reserva" ON "propuestas_horario"("reserva_id");

-- Índice parcial para la consulta caliente "la propuesta viva de esta reserva".
CREATE INDEX "idx_propuestas_horario_pendiente"
  ON "propuestas_horario"("reserva_id")
  WHERE "estado" = 'PENDIENTE';
