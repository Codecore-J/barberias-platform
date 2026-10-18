-- H68 · §7.3: un pago puede corregirse después, y cada corrección se audita.
--
-- La corrección es una ANULACIÓN, no un borrado (la skill del proyecto prohíbe el
-- `DELETE` para representar un cambio de estado): la fila del pago se conserva y
-- pasa a `ANULADO` con autor, fecha y motivo, así que el ingreso se deshace sin
-- perder el rastro. Nada de la venta desaparece: la reserva sigue `COMPLETADA`
-- (el servicio se prestó) y su cobro puede volver a registrarse.
--
-- `metodo_pago` entra en la misma migración porque el recibo de la sede necesita
-- el dato EN LA FILA: hasta hoy vivía solo en el contexto JSON de la auditoría, y
-- el historial de cobros no puede reconstruir una tabla desde un log inmutable.
--
-- Aditiva y sin backfill: las dos columnas nuevas son `NOT NULL DEFAULT` /
-- nullable, así que las filas vivas quedan coherentes al aplicarla. Los pagos
-- existentes no tienen anulación, que es exactamente su estado real.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El catálogo de estados del pago gana ANULADO
-- ─────────────────────────────────────────────────────────────────────────────
-- Se recrea con el MISMO nombre para que la guardia de integridad
-- (`npm run check:integridad`) siga comparando un único CHECK por tabla.
ALTER TABLE "pagos" DROP CONSTRAINT "pagos_estado_pago_check";
ALTER TABLE "pagos"
  ADD CONSTRAINT "pagos_estado_pago_check"
  CHECK ("estado_pago" IN ('PENDIENTE_DE_PAGO', 'PAGADA', 'ANULADO'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Columnas del cobro y de su corrección
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "pagos" ADD COLUMN "metodo_pago" VARCHAR(30) NOT NULL DEFAULT 'EN_PERSONA';
ALTER TABLE "pagos" ADD COLUMN "anulado_at" TIMESTAMPTZ;
ALTER TABLE "pagos" ADD COLUMN "anulado_por" UUID;
ALTER TABLE "pagos" ADD COLUMN "motivo_anulacion" TEXT;

ALTER TABLE "pagos"
  ADD CONSTRAINT "pagos_anulado_por_fkey"
  FOREIGN KEY ("anulado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
