-- T-20 (23 nov 2026) · las categorías de servicio pasan a ser GLOBALES.
--
-- Estado de partida en producción: 33 filas en `categorias_servicio` repartidas
-- entre 6 sedes para 11 nombres distintos (8 nombres repetidos: 7 compartidos por
-- 4 sedes y `qa_categoria_test` por 2). El objetivo es una fila por nombre, con
-- `barberia_id` en NULL, sin perder ningún vínculo de `servicios_barbero`.
--
-- El orden importa: se reapuntan los servicios ANTES de borrar las copias, y el
-- borrado solo toca filas cuyo vínculo ya quedó movido. Todo corre en una
-- transacción que Prisma ya envuelve; si algo falla, la migración no deja la
-- tabla a medias.

-- 1) La unicidad deja de ser por sede.
ALTER TABLE "categorias_servicio" DROP CONSTRAINT IF EXISTS "uk_categoria_sede_nombre";
DROP INDEX IF EXISTS "uk_categoria_sede_nombre";

-- 2) NULL = categoría global. `orden` decide el orden de presentación.
ALTER TABLE "categorias_servicio" ALTER COLUMN "barberia_id" DROP NOT NULL;
ALTER TABLE "categorias_servicio" ADD COLUMN "orden" INTEGER NOT NULL DEFAULT 0;

-- 3) La categoría ya no identifica la sede, así que el servicio guarda la suya.
--    Se rellena desde la categoría ORIGINAL antes de que esta quede en NULL.
ALTER TABLE "servicios_barbero" ADD COLUMN "barberia_id" UUID;

UPDATE "servicios_barbero" AS sb
SET "barberia_id" = c."barberia_id"
FROM "categorias_servicio" AS c
WHERE c."id" = sb."categoria_id"
  AND sb."barberia_id" IS NULL
  AND c."barberia_id" IS NOT NULL;

-- Producción tenía 1 servicio de barbero; si alguna base tuviera una fila sin
-- categoría de sede, el NOT NULL falla aquí en lugar de dejar servicios sin
-- tenant silenciosamente.
ALTER TABLE "servicios_barbero" ALTER COLUMN "barberia_id" SET NOT NULL;

ALTER TABLE "servicios_barbero"
  ADD CONSTRAINT "servicios_barbero_barberia_id_fkey"
  FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "idx_servicios_barbero_sede" ON "servicios_barbero" ("barberia_id", "activo");

-- 4) Superviviente por nombre normalizado, con la regla acordada:
--    sobrevive la fila con MÁS servicios de barbero vinculados; si empatan,
--    la ACTIVA y, entre ellas, la más antigua. Las filas sin nombre no
--    participan (jamás deberían existir).
--    El conteo va en un CTE para no meter una subconsulta dentro del
--    ORDER BY de la ventana.
DROP TABLE IF EXISTS "_tmp_categoria_global";
CREATE TABLE "_tmp_categoria_global" AS
WITH "candidatas" AS (
  SELECT
    c."id",
    c."nombre",
    c."activa",
    c."creado_at",
    (SELECT count(*) FROM "servicios_barbero" AS sb WHERE sb."categoria_id" = c."id") AS "servicios"
  FROM "categorias_servicio" AS c
  WHERE c."nombre" IS NOT NULL AND btrim(c."nombre") <> ''
)
SELECT
  "id" AS origen_id,
  first_value("id") OVER (
    PARTITION BY lower(btrim("nombre"))
    ORDER BY "servicios" DESC, "activa" DESC, "creado_at" ASC, "id" ASC
  ) AS destino_id
FROM "candidatas";

-- 4) Los servicios del barbero pasan a la categoría superviviente. Sin este paso
--    el borrado posterior dejaría huérfano el catálogo de esas sedes.
UPDATE "servicios_barbero" AS sb
SET "categoria_id" = t."destino_id"
FROM "_tmp_categoria_global" AS t
WHERE sb."categoria_id" = t."origen_id"
  AND t."origen_id" <> t."destino_id";

-- 5) Se borran SOLO las copias ya reasignadas y sin vínculos pendientes.
DELETE FROM "categorias_servicio" AS c
USING "_tmp_categoria_global" AS t
WHERE c."id" = t."origen_id"
  AND t."origen_id" <> t."destino_id"
  AND NOT EXISTS (
    SELECT 1 FROM "servicios_barbero" AS sb WHERE sb."categoria_id" = c."id"
  );

-- 6) Las supervivientes quedan globales y ordenadas alfabéticamente como punto
--    de partida (`orden` se puede reordenar desde la administración, T-21).
UPDATE "categorias_servicio" AS c
SET "barberia_id" = NULL
FROM "_tmp_categoria_global" AS t
WHERE c."id" = t."destino_id";

UPDATE "categorias_servicio" AS c
SET "orden" = o."posicion"
FROM (
  SELECT "id", row_number() OVER (ORDER BY lower(btrim("nombre"))) - 1 AS posicion
  FROM "categorias_servicio"
) AS o
WHERE c."id" = o."id";

-- 7) Unicidad global del nombre normalizado. La normalización incluye los
--    espacios INTERNOS (`\s+` → un espacio), la misma que aplica
--    `CategoriasService.normalizarNombre`: con solo `lower(btrim(...))`,
--    «Corte  Prueba» y «corte prueba» pasaban como filas distintas. Probado en
--    staging: con la expresión completa el duplicado responde 23505.
CREATE UNIQUE INDEX "uk_categoria_global_nombre"
  ON "categorias_servicio" (lower(btrim(regexp_replace("nombre", '\s+', ' ', 'g'))));

DROP TABLE IF EXISTS "_tmp_categoria_global";
