/**
 * Fase 3 · derivación del rol que se pinta en la cabecera.
 *
 * El token puede no traer ningún rol (cuenta recién creada, invitación sin
 * aceptar o membresía todavía no aprobada). Ese caso NO es `CLIENTE`: forzar
 * ese rol mostraba una navegación de cliente a quien aún no tiene permisos.
 * Aquí se devuelve `SIN_ROL`, que la cabecera pinta como estado neutro.
 *
 * La jerarquía replica la del backend (E1-04): el rol más alto del token manda.
 */
export type RolSesion =
  | 'ADMINISTRADOR'
  | 'ADMIN_BARBERIA'
  | 'BARBERO'
  | 'CLIENTE'
  | 'SIN_ROL';

/** Orden de precedencia: el primero que aparezca en el token gana. */
const PRIORIDAD: readonly Exclude<RolSesion, 'SIN_ROL'>[] = [
  'ADMINISTRADOR',
  'ADMIN_BARBERIA',
  'BARBERO',
  'CLIENTE',
];

/** Etiqueta legible de cada rol; `SIN_ROL` es el estado neutro de la cabecera. */
export const ETIQUETA_ROL: Readonly<Record<RolSesion, string>> = {
  ADMINISTRADOR: 'Administrador',
  ADMIN_BARBERIA: 'Admin. de barbería',
  BARBERO: 'Barbero',
  CLIENTE: 'Cliente',
  SIN_ROL: 'Sin rol asignado',
};

/**
 * Rol efectivo de la sesión. Sin roles (o con roles que el frontend no
 * conoce) devuelve `SIN_ROL`, nunca `CLIENTE`.
 */
export function rolEfectivo(roles: readonly string[] | null | undefined): RolSesion {
  if (!roles || roles.length === 0) return 'SIN_ROL';
  return PRIORIDAD.find((rol) => roles.includes(rol)) ?? 'SIN_ROL';
}
