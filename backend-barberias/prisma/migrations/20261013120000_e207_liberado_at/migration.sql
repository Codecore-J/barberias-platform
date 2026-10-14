-- E2-07 · D29 (vocabulario del diseño): un bloqueo de agenda no se elimina, se
-- LIBERA. Spec 01 §9 prohíbe la eliminación física para representar un cambio
-- de estado, y `DELETE /agenda/bloqueos/:id` hacía exactamente eso: borraba la
-- fila y con ella la única prueba de que ese hueco estuvo bloqueado y quién lo
-- retiró.
--
-- `liberado_at` marca el instante (UTC) en que el bloqueo dejó de ocupar agenda:
--   * la liberación MANUAL (`POST .../bloqueos/:id/liberar`) y la AUTOMÁTICA
--     (job `liberar-bloqueo`) lo escriben;
--   * `DisponibilidadService` filtra `liberado_at IS NULL`, así que la
--     ocupación no cambia de forma observable;
--   * NULL = el bloqueo sigue vigente.
--
-- Aditiva y sin impacto en los datos vivos: las filas existentes son bloqueos
-- vigentes, y NULL es justo su valor correcto.
ALTER TABLE "bloqueos_agenda" ADD COLUMN "liberado_at" TIMESTAMPTZ;

-- El cálculo de disponibilidad filtra por sede, día y `liberado_at IS NULL`; el
-- índice parcial evita pagar por las filas ya liberadas acumuladas.
CREATE INDEX "bloqueos_agenda_vigentes_idx"
  ON "bloqueos_agenda" ("barberia_id", "fecha")
  WHERE "liberado_at" IS NULL;
