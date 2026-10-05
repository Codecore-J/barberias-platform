import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * E1-06: la sede sale del CONTEXTO DEL TENANT y solo de ahí.
 *
 * Fuentes, en este orden, y ninguna más:
 *  1. Parámetro de ruta `barberiaId` (`/barberias/:barberiaId/...`).
 *  2. Cabecera `x-barberia-id`, que es lo que manda el frontend (`auth.interceptor.ts`).
 *  3. Query `?barberiaId=`.
 *
 * Antes añadía una cuarta fuente, `params.id`, y en las rutas con `:id` —el
 * catálogo— eso era el id del recurso, no el de la sede: el servicio buscaba
 * `{ id, barberiaId }` con los dos iguales y no encontraba nunca nada. Peor,
 * `RolesGuard` NO usa ese fallback, así que el guard verificaba una sede y el
 * servicio consultaba otra. La cadena de aquí es ahora idéntica a la del guard.
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
  return valor.trim() === '' ? null : valor.trim();
}

/**
 * Variante obligatoria: es la que usan las 17 rutas que no pueden trabajar sin
 * sede. Si el cliente no la indica, se responde 400 con un mensaje que dice
 * cómo indicarla, en vez de inventarse un tenant y devolver siempre 404.
 */
export const CurrentBarberiaId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const barberiaId = resolverBarberiaId(ctx.switchToHttp().getRequest());
    if (!barberiaId) {
      throw new BadRequestException(
        'No se indicó la barbería: usa la cabecera x-barberia-id, la ruta /barberias/:barberiaId/... o el parámetro ?barberiaId=.',
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