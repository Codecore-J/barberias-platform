import { UnprocessableEntityException } from '@nestjs/common';
import type { UsuarioAutenticado } from './jwt.interface.js';

/**
 * Roles reales de la tabla `roles`. D05: el rol global es SOLO
 * `ADMINISTRADOR`; `SUPER_ADMIN` no existe y se elimina del código (E1-04).
 */
export const ROL_ADMINISTRADOR = 'ADMINISTRADOR';
export const ROL_ADMIN_BARBERIA = 'ADMIN_BARBERIA';
export const ROL_BARBERO = 'BARBERO';
export const ROL_CLIENTE = 'CLIENTE';

export const AMBITO_GLOBAL = 'GLOBAL';
export const AMBITO_BARBERIA = 'BARBERIA';

/** Rol asignado con su ámbito y eventual barbería (lo que monta `JwtStrategy`). */
export interface RolConAlcance {
  nombre: string;
  barberiaId: string | null;
  ambito?: string | null;
}

/** Rol del catálogo, tal y como lo devuelve `prisma.rol.findUnique`. */
export interface RolDelCatalogo {
  nombre: string;
  ambito: string;
}

/**
 * Único lugar del backend que decide si un usuario es el administrador global.
 *
 * Todo el código debe pasar por aquí: antes cada servicio buscaba por su cuenta
 * un `SUPER_ADMIN` que no existe en la base, así que el `ADMINISTRADOR` real
 * pasaba el guard y luego el servicio lo rechazaba.
 */
export function esAdministradorGlobal(usuario?: UsuarioAutenticado | null): boolean {
  return usuario?.roles?.includes(ROL_ADMINISTRADOR) ?? false;
}

/** Cliente mínimo de Prisma que necesita la consulta por id. */
interface ClienteDeRoles {
  usuarioRol: {
    findFirst(args: unknown): Promise<unknown>;
  };
}

/**
 * Variante para los servicios que solo reciben `usuarioId` y no el objeto de
 * sesión (agenda, horario, pago, antecedentes, reservas). Consulta el rol que
 * existe de verdad, nunca `SUPER_ADMIN`.
 */
export async function esAdministradorGlobalPorId(
  prisma: ClienteDeRoles,
  usuarioId: string,
): Promise<boolean> {
  const asignacion = await prisma.usuarioRol.findFirst({
    where: { usuarioId, rol: { nombre: ROL_ADMINISTRADOR } },
  });

  return !!asignacion;
}

/**
 * Un rol de ámbito BARBERIA SIEMPRE lleva barbería (D05). Sin ella la fila no
 * identifica un tenant y el guard laractable como comodín, así que se rechaza
 * en el dominio en lugar de dejar que llegue a la base.
 */
export function validarAsignacionRol(
  rol: RolDelCatalogo,
  barberiaId?: string | null,
): void {
  if (rol.ambito === AMBITO_BARBERIA && !barberiaId) {
    throw new UnprocessableEntityException(
      `El rol ${rol.nombre} es de ámbito BARBERIA y exige barbería: no se puede asignar con barberiaId nulo.`,
    );
  }
}

/**
 * ¿Este rol alcanza la barbería pedida?
 *
 * Un `barberiaId` nulo solo actúa como comodín si el rol es de ámbito GLOBAL
 * (E1-04). Para ADMIN_BARBERIA y BARBERO, que son de ámbito BARBERIA, un nulo
 * significa una fila corrupta y no da acceso a ninguna barbería.
 */
export function alcanceCumple(rol: RolConAlcance, barberiaId: string): boolean {
  if (rol.barberiaId === barberiaId) {
    return true;
  }

  return rol.barberiaId === null && rol.ambito === AMBITO_GLOBAL;
}
