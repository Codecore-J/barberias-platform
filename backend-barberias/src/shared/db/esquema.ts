/**
 * H58 (sprint de estabilización, 2026-10-12) · el esquema de la base, resuelto
 * UNA vez y compartido por las consultas crudas.
 *
 * Por qué existe: las consultas `$queryRaw` escriben el nombre de la tabla entre
 * comillas (`"barberias"`) y eso NO es un nombre calificado, es un identificador
 * normal que Postgres resuelve contra el `search_path` de la sesión. Con un
 * pooler por delante (Neon/PgBouncer reutilizan sesiones entre clientes), una
 * sesión que haya movido su `search_path` —por ejemplo una herramienta que
 * trabaja en un esquema temporal— arrastra a los demás: la consulta responde
 * `42P01: relation "barberias" does not exist` y el endpoint devuelve 500. Pasó
 * de verdad durante el sprint: tiñó de rojo dos corridas completas de E2E que no
 * tenían ningún defecto.
 *
 * La cura es calificar: `"public"."barberias"` no depende de la sesión. En
 * producción y en el CI la URL no trae `?schema=`, así que el esquema es
 * `public`, el mismo que usa Prisma; y si algún día se despliega en otro
 * esquema, se declara en la URL y estas consultas lo siguen.
 *
 * El nombre se valida con una lista blanca antes de usarse: nunca se pega a mano
 * en el SQL (eso sí sería una inyección), se inyecta con `Prisma.raw` desde aquí.
 */

/** Esquema por defecto de Postgres y de Prisma cuando la URL no lo dice. */
export const ESQUEMA_POR_DEFECTO = 'public';

/** Un identificador de Postgres válido: letra o guion bajo y luego alfanumérico. */
const IDENTIFICADOR_VALIDO = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Esquema declarado en `DATABASE_URL` (`?schema=`), con `public` por defecto.
 *
 * Una URL ausente o ilegible no rompe el arranque: se cae al valor por defecto,
 * que es el de todos los entornos reales de este proyecto. Un nombre que no sea
 * un identificador válido tampoco se propaga al SQL.
 */
function resolverEsquema(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return ESQUEMA_POR_DEFECTO;

  let nombre: string;
  try {
    nombre = new URL(url).searchParams.get('schema') ?? ESQUEMA_POR_DEFECTO;
  } catch {
    return ESQUEMA_POR_DEFECTO;
  }

  return IDENTIFICADOR_VALIDO.test(nombre) ? nombre : ESQUEMA_POR_DEFECTO;
}

/** Esquema con el que se califican las tablas en las consultas crudas. */
export const ESQUEMA_DE_LA_BASE: string = resolverEsquema();

/**
 * Nombre CALIFICADO y entrecomillado de una tabla, listo para `Prisma.raw`.
 *
 * El nombre también se valida, y si no es un identificador se LANZA: son
 * literales del código, así que un nombre inválido es un error de programación y
 * no algo que deba resolverse en silencio con otra tabla.
 */
export function tablaCalificada(tabla: string): string {
  if (!IDENTIFICADOR_VALIDO.test(tabla)) {
    throw new Error(`tablaCalificada: «${tabla}» no es un identificador de tabla válido.`);
  }

  return `"${ESQUEMA_DE_LA_BASE}"."${tabla}"`;
}
