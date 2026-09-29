import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extrae el ID de la barbería del contexto de la petición HTTP.
 * Busca secuencialmente en:
 * 1. Parámetros de ruta: `req.params.barberiaId` o `req.params.id`
 * 2. Headers HTTP: `req.headers['x-barberia-id']`
 * 3. Query string: `req.query.barberiaId`
 */
export const CurrentBarberiaId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();
    const params = request.params;
    const headers = request.headers;
    const query = request.query;

    const barberiaId =
      params?.barberiaId ??
      headers?.['x-barberia-id'] ??
      query?.barberiaId ??
      params?.id ??
      null;

    return barberiaId;
  },
);
