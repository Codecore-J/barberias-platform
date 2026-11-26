-- F6 / T-65 · catálogo de divisiones administrativas.
--
-- Nominatim devuelve el NOMBRE de la provincia y del municipio, no un código.
-- Para ofrecerlos como select (T-66) hacen falta filas de referencia: sin ellas
-- el formulario solo podría mostrar el texto que llegó del proveedor, y cualquier
-- diferencia de escritura («Santo Domingo» / «Santo Domingo de Guzmán») se vería
-- como dos divisiones distintas.
--
-- `nombre_nominatim` guarda cómo lo llama el proveedor cuando no coincide con el
-- nombre oficial; así se puede emparejar sin renombrar el catálogo.
--
-- Idempotente (`IF NOT EXISTS`). Solo AÑADE estructura: no borra ni reescribe
-- datos. Los datos entran con el seed `prisma/seed-divisiones-do.ts`.

CREATE TABLE IF NOT EXISTS "divisiones_administrativas" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "pais_codigo"     VARCHAR(2) NOT NULL,
  "nivel"           INTEGER NOT NULL,
  "nombre"          VARCHAR(100) NOT NULL,
  "nombre_nominatim" VARCHAR(100),
  "padre_id"        UUID,
  CONSTRAINT "divisiones_administrativas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "divisiones_administrativas_padre_fkey"
    FOREIGN KEY ("padre_id") REFERENCES "divisiones_administrativas"("id") ON DELETE CASCADE,
  -- Nivel 1 = provincia, nivel 2 = municipio. Cualquier otro valor sería una
  -- división que nadie sabe interpretar.
  CONSTRAINT "divisiones_administrativas_nivel_check" CHECK ("nivel" IN (1, 2))
);

-- Una división por (país, nivel, nombre): es la clave del `upsert` del seed, así
-- que correrlo dos veces no puede duplicar el catálogo.
CREATE UNIQUE INDEX IF NOT EXISTS "uk_divisiones_pais_nivel_nombre"
  ON "divisiones_administrativas"("pais_codigo", "nivel", "nombre");

-- El select de municipios consulta siempre por provincia.
CREATE INDEX IF NOT EXISTS "idx_divisiones_padre"
  ON "divisiones_administrativas"("padre_id");
