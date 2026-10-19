-- E3-01 / A-15 · la auditoría guarda la sede en COLUMNA, no solo en el JSON.
--
-- El filtro por `contexto->>'barberiaId'` funcionaba, pero obligaba a que cada
-- llamador recordara la clave y no tenía índice. Esta migración añade la
-- columna, rellena el histórico que ya la llevaba en el contexto y crea el
-- índice que usa `GET /auditoria?barberiaId=...`.
ALTER TABLE "auditoria"
  ADD COLUMN "barberia_id" UUID;

-- Backfill seguro: solo convierte valores que son UUID. Un contexto con una
-- clave `barberiaId` no UUID se deja en NULL en vez de romper la migración.
UPDATE "auditoria"
SET "barberia_id" = ("contexto"->>'barberiaId')::uuid
WHERE "contexto" ? 'barberiaId'
  AND ("contexto"->>'barberiaId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

CREATE INDEX "auditoria_barberia_id_creado_at_idx"
  ON "auditoria"("barberia_id", "creado_at");

ALTER TABLE "auditoria"
  ADD CONSTRAINT "auditoria_barberia_id_fkey"
  FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
