-- V3 fase 6 · pagos por método y cierre de caja diario.
--
-- Dos cambios, ambos aditivos:
--   1. `pagos.barberia_id`: la sede del cobro, copiada de la reserva. El arqueo
--      filtra por sede y por `registrado_at`; sin la columna, cada consulta de
--      caja tendría que unir `pagos` con `reservas`.
--   2. `cierres_caja`: la FOTO de un día. Un cierre no se recalcula: guarda sus
--      cuatro totales y sobrevive a anulaciones posteriores.
--
-- No se renombra nada: `metodo_pago` y `estado_pago` conservan sus nombres y sus
-- valores históricos (`EN_PERSONA`, `PAGADA`, `ANULADO`). Renombrarlos habría
-- obligado a reescribir el recibo y la auditoría de H68.

-- 1 · Sede del cobro -------------------------------------------------------
ALTER TABLE "pagos" ADD COLUMN "barberia_id" UUID;

-- Backfill desde la reserva: toda fila de `pagos` tiene `reserva_id` NOT NULL, así
-- que ninguna queda sin sede.
UPDATE "pagos" p
SET "barberia_id" = r."barberia_id"
FROM "reservas" r
WHERE r."id" = p."reserva_id"
  AND p."barberia_id" IS NULL;

ALTER TABLE "pagos" ALTER COLUMN "barberia_id" SET NOT NULL;

ALTER TABLE "pagos"
    ADD CONSTRAINT "pagos_barberia_id_fkey"
    FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_pagos_barberia_fecha" ON "pagos"("barberia_id", "registrado_at");

-- 2 · Cierre de caja -------------------------------------------------------
CREATE TABLE "cierres_caja" (
    "id"                  UUID           NOT NULL DEFAULT gen_random_uuid(),
    "barberia_id"         UUID           NOT NULL,
    "fecha_arqueo"        DATE           NOT NULL,
    "total_efectivo"      DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "total_tarjeta"       DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "total_transferencia" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "total_general"       DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "estado"              VARCHAR(20)    NOT NULL DEFAULT 'CERRADO',
    "abierto_por"         UUID,
    "cerrado_por"         UUID,
    "abierto_at"          TIMESTAMPTZ,
    "cerrado_at"          TIMESTAMPTZ,
    "creado_at"           TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT "cierres_caja_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cierres_caja_barberia_id_fkey"
        FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cierres_caja_abierto_por_fkey"
        FOREIGN KEY ("abierto_por") REFERENCES "usuarios"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "cierres_caja_cerrado_por_fkey"
        FOREIGN KEY ("cerrado_por") REFERENCES "usuarios"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- Un solo cierre por sede y día: es la restricción que hace imposible «cerrar
-- dos veces», incluso si dos peticiones llegan a la vez.
CREATE UNIQUE INDEX "uk_cierre_caja_sede_fecha" ON "cierres_caja"("barberia_id", "fecha_arqueo");
CREATE INDEX "idx_cierre_caja_sede_fecha" ON "cierres_caja"("barberia_id", "fecha_arqueo");

-- Reglas de dominio que Prisma no sabe expresar.
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_totales_check" CHECK (
    "total_efectivo" >= 0
    AND "total_tarjeta" >= 0
    AND "total_transferencia" >= 0
    AND "total_general" = "total_efectivo" + "total_tarjeta" + "total_transferencia"
);

ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_estado_check" CHECK (
    "estado" IN ('ABIERTO', 'CERRADO')
);
