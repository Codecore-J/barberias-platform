/**
 * Rol asignado a un usuario con su ámbito y eventual barbería vinculada.
 */
export interface RolAsignado {
  nombre: string;
  barberiaId: string | null;
  ambito: string;
}

/**
 * Payload que se firma dentro del JWT.
 * Regla: NO incluir datos sensibles (contraseña, cédula, etc.).
 */
export interface JwtPayload {
  sub: string;         // ID del usuario (UUID)
  correo: string;      // Correo del usuario
  roles: string[];     // Nombres de los roles asignados (ej. ['CLIENTE', 'BARBERO'])
}

/**
 * Estructura del usuario autenticado que Passport inyecta
 * en cada request protegido (req.user).
 */
export interface UsuarioAutenticado {
  id: string;
  correo: string;
  roles: string[];
  rolesDetallados?: RolAsignado[];
}
