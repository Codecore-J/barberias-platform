import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';/**
 * Un UUID, y solo un UUID, es una sede válida. La columna `barberia_id` es de
 * tipo uuid: dejar pasar otra cosa convierte un error del cliente en un fallo
 * de base de datos.
 */
const UUID_BARBERIA =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * E1-06: la sede sale del CONTEXTO DEL TENANT y solo de ahí.
 *
 * Fuentes, en este orden, y ninguna más:
 * 1. Parámetro de ruta `barberiaId` (`/barberias/:barberiaId/...`).
 * 2. Cabecera `x-barberia-id`, que es lo que manda el frontend (`auth.interceptor.ts`).
 * 3. Query `?barberiaId=`.
 *
 * Antes añadía una cuarta fuente, `params.id`, y en las rutas con `:id` —el
 * catálogo— eso era el id del recurso, no el de la sede: el servicio buscaba
 * `{ id, barberiaId }` con los dos iguales y no encontraba nunca nada. Peor,
 * `RolesGuard` NO usa ese fallback, así que el guard verificaba una sede y el
 * servicio consultaba otra. La cadena de aquí es ahora idéntica a la del guard.
 *
 * E1-06 (parte 2): lo que sale de aquí tiene que ser un UUID o nada. Antes
 * `x-barberia-id: no-es-uuid` llegaba intacto al `where` de una columna uuid y
 * era Prisma quien decidia el 400, despues de abrir la conexion. Ahora se
 * responde 400 aquí, y un valor no reconocido se trata como sede no indicada.
 */
export function resolverBarberiaId(request: any): string | null {
  const cabecera = request?.headers?.['x-barberia-id'];
  // Express entrega `string | string[]` si la cabecera llega repetida.
  const header = Array.isArray(cabecera) ? cabecera[0] : cabecera;
  const valor =
    request?.params?.barberiaId ?? header ?? request?.query?.barberiaId ?? null;

  if (typeof valor !== 'string') {
    return null;
  }
  const sede = valor.trim();
  return UUID_BARBERIA.test(sede) ? sede : null;
}

/**
 * Variante obligatoria: es la que usan las rutas que no pueden trabajar sin
 * sede. Si el cliente no la indica —o la indica en un formato que no es un
 * UUID— se responde 400 con un mensaje que dice cómo indicarla, en vez de
 * inventarse un tenant y devolver siempre 404.
 */
export const CurrentBarberiaId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const barberiaId = resolverBarberiaId(ctx.switchToHttp().getRequest());
    if (!barberiaId) {
      throw new BadRequestException(
        'No se indicó una barbería válida: usa un UUID en la cabecera x-barberia-id, en la ruta /barberias/:barberiaId/... o en el parámetro ?barberiaId=.',
      );
    }
    return barberiaId;
  },
);

/**
 * Variante opcional: solo para las rutas donde "sin sede" es una consulta
 * legítima. Hoy es `GET /cobros/auditoria`, que el ADMINISTRADOR global llama
 * sin cabecera para ver todas las sedes (`pago.service.ts` lo trata con
 * `esAdministradorGlobal`) y que el panel de inicio consume.
 */
export const CurrentBarberiaIdOpcional = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null =>
    resolverBarberiaId(ctx.switchToHttp().getRequest()),
);