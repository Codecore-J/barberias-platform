-- F5 / T-51 · solicitud de antecedente.
--
-- El flujo deja de escribir directo en `antecedentes`: ADMIN_BARBERIA y BARBERO
-- piden, y el ADMINISTRADOR global aprueba o deniega. Aprobar crea la fila de
-- `antecedentes` con `categoria = 'GENERAL'`, `contenido = motivo + evidencia` y
-- `compartido = false`.
--
-- Nada se borra: una solicitud resuelta se conserva como historial. El índice
-- único PARCIAL impide dos PENDIENTES del mismo cliente en la misma sede; la
-- segunda petición debe esperar a que la primera se resuelva (409).
--
-- Idempotente (`IF NOT EXISTS`). No toca la tabla `antecedentes` ni borra datos.

CREATE TABLE IF NOT EXISTS "solicitudes_antecedente" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "barberia_id"       UUID NOT NULL,
  "solicitante_id"    UUID NOT NULL,
  "cliente_id"        UUID NOT NULL,
  "motivo"            TEXT NOT NULL,
  "evidencia_texto"   TEXT,
  "estado"            VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  "resuelto_por"      UUID,
  "resuelto_at"       TIMESTAMPTZ,
  "motivo_denegacion" TEXT,
  "creado_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "solicitudes_antecedente_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "solicitudes_antecedente_sede_fkey"
    FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE,
  CONSTRAINT "solicitudes_antecedente_solicitante_fkey"
    FOREIGN KEY ("solicitante_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
  CONSTRAINT "solicitudes_antecedente_cliente_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "usuarios"("id") ON DELETE CASCADE,
  -- RESTRICT: una solicitud resuelta exige `resuelto_por`, así que borrar al
  -- ADMINISTRADOR que decidió dejaría la fila en un estado imposible.
  CONSTRAINT "solicitudes_antecedente_resolutor_fkey"
    FOREIGN KEY ("resuelto_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  CONSTRAINT "solicitudes_antecedente_estado_check"
    CHECK ("estado" IN ('PENDIENTE', 'APROBADA', 'DENEGADA')),
  -- PENDIENTE no tiene resolución; APROBADA/DENEGADA la tienen completa.
  CONSTRAINT "solicitudes_antecedente_resolucion_check"
    CHECK (
      ("estado" = 'PENDIENTE'
        AND "resuelto_por" IS NULL
        AND "resuelto_at" IS NULL
        AND "motivo_denegacion" IS NULL)
      OR
      ("estado" IN ('APROBADA', 'DENEGADA')
        AND "resuelto_por" IS NOT NULL
        AND "resuelto_at" IS NOT NULL)
    ),
  -- Denegar exige motivo con texto; aprobar no puede arrastrarlo.
  CONSTRAINT "solicitudes_antecedente_denegacion_check"
    CHECK (
      ("estado" = 'DENEGADA'
        AND "motivo_denegacion" IS NOT NULL
        AND btrim("motivo_denegacion") <> '')
      OR
      ("estado" <> 'DENEGADA' AND "motivo_denegacion" IS NULL)
    )
);

-- Una sola PENDIENTE por (cliente, sede): el segundo envío espera a la decisión.
CREATE UNIQUE INDEX IF NOT EXISTS "uk_solicitud_antecedente_pendiente"
  ON "solicitudes_antecedente"("cliente_id", "barberia_id")
  WHERE "estado" = 'PENDIENTE';

-- Perfil de antecedentes del cliente y bandeja de la sede.
CREATE INDEX IF NOT EXISTS "idx_solicitudes_antecedente_cliente_estado"
  ON "solicitudes_antecedente"("cliente_id", "estado");

CREATE INDEX IF NOT EXISTS "idx_solicitudes_antecedente_sede_estado"
  ON "solicitudes_antecedente"("barberia_id", "estado");
