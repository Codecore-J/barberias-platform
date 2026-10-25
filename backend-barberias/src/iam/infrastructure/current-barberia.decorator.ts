import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Un UUID, y solo un UUID, es una sede válida. La columna `barberia_id` es de
 * tipo uuid: dejar pasar otra cosa convierte un error del cliente en un fallo
 * de base de datos.
 */
const UUID_BARBERIA =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fase 5 (Punto 5.3): la sede sale del CONTEXTO DEL TENANT y solo de ahí, y el
 * contrato RESTful la lleva SIEMPRE en la ruta.
 *
 * Fuentes, en este orden, y ninguna más:
 * 1. Parámetro de ruta `shopId` (`/shops/:shopId/...`).
 * 2. Query `?shopId=` (o su nombre histórico `?barberiaId=`), reservado a las
 *    rutas globales que pueden consultarse sin sede (`GET /auditoria`).
 *
 * La cabecera `x-barberia-id` se eliminó: era una fuente paralela de tenant que
 * el frontend inyectaba en `auth.interceptor.ts` y que permitía acotar una
 * petición a cualquier sede sin que la ruta lo dijera. Con ella fuera, la única
 * vía de entrada es el parámetro de ruta, que es lo que comprueban también
 * `RolesGuard` y `VinculoBarberiaGuard` (misma cadena, sin divergence).
 *
 * E1-06 (parte 2): lo que sale de aquí tiene que ser un UUID o nada. Un valor
 * no reconocido se trata como sede no indicada (400), en vez de llegar al
 * `where` de una columna uuid para que Prisma decidiera el error.
 */
/** `true` cuando el valor es un UUID de sede utilizable en un `where`. */
export function esUuidSede(valor: unknown): boolean {
  return typeof valor === 'string' && UUID_BARBERIA.test(valor.trim());
}

export function resolverBarberiaId(request: any): string | null {
  const valor =
    request?.params?.shopId ??
    request?.query?.shopId ??
    request?.query?.barberiaId ??
    null;

  if (typeof valor !== 'string') {
    return null;
  }
  const sede = valor.trim();
  return esUuidSede(sede) ? sede : null;
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
        'No se indicó una barbería válida: usa un UUID en la ruta /shops/:shopId/... o en el parámetro ?shopId=.',
      );
    }
    return barberiaId;
  },
);

/**
 * Variante opcional: solo para las rutas donde "sin sede" es una consulta
 * legítima. Hoy es `GET /shops/:shopId/payments/audit`, que el ADMINISTRADOR
 * global también puede llamar por la ruta global equivalente para ver todas
 * las sedes (`pago.service.ts` lo trata con `esAdministradorGlobal`).
 */
export const CurrentBarberiaIdOpcional = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null =>
    resolverBarberiaId(ctx.switchToHttp().getRequest()),
);