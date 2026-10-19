-- E3-01 / A-15 · la auditoría guarda la sede en COLUMNA, no solo en el JSON.
--
-- El filtro por `contexto->>'barberiaId'` funcionaba, pero obligaba a que cada
-- llamador recordara la clave y no tenía índice. Esta migración añade la
-- columna, rellena el histórico que ya la llevaba en el contexto y crea el
-- índice que usa `GET /auditoria?barberiaId=...`.
--
-- Idempotente a propósito: un intento anterior puede haber dejado la migración
-- marcada como fallida en `_prisma_migrations` (la transacción se revierte,
-- pero el registro no). Repetirla no debe romper nada.
ALTER TABLE "auditoria"
  ADD COLUMN IF NOT EXISTS "barberia_id" UUID;

-- Backfill seguro:
--  1. Solo convierte valores que son UUID (un contexto con una clave
--     `barberiaId` no UUID se deja en NULL en vez de romper la migración).
--  2. Solo rellena si la sede EXISTE. La auditoría es histórica y sobrevive a
--     la desactivación de una sede; hay eventos antiguos cuyo `barberiaId` ya
--     no está en `barberias`, y la FK no puede aceptarlos. Esos quedan en NULL
--     (el UUID sigue en el JSON) en lugar de perder la fila de auditoría.
UPDATE "auditoria" AS a
SET "barberia_id" = (a."contexto"->>'barberiaId')::uuid
WHERE a."contexto" ? 'barberiaId'
  AND (a."contexto"->>'barberiaId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1
    FROM "barberias" b
    WHERE b."id" = (a."contexto"->>'barberiaId')::uuid
  );

CREATE INDEX IF NOT EXISTS "auditoria_barberia_id_creado_at_idx"
  ON "auditoria"("barberia_id", "creado_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auditoria_barberia_id_fkey'
      AND conrelid = '"auditoria"'::regclass
  ) THEN
    ALTER TABLE "auditoria"
      ADD CONSTRAINT "auditoria_barberia_id_fkey"
      FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
