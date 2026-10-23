/**
 * DTO de salida para la lista de usuarios de la plataforma.
 *
 * Contrato expuesto a `GET /plataforma/usuarios`.
 *
 * Solo viaja lo que la bandeja necesita: identificación, contacto, estado,
 * fecha de alta y nombres de los roles. Lo sensible —`passwordHash`,
 * `tokenVersion` y `cedula`— NO se selecciona en la consulta, así que no puede
 * filtrarse aunque alguien cambie el mapeo: nunca sale de Prisma.
 *
 * `nombreCompleto` es el nombre que guarda el esquema (`usuarios.nombre_completo`,
 * un solo campo, sin apellido separado), igual que en `UsuarioResponseDto`.
 */
export class UsuarioListResponseDto {
  id: string;

  nombreCompleto: string;

  correo: string;

  telefono?: string | null;

  estadoCuenta: string;

  /** `usuarios.creado_at`: fecha de registro de la cuenta. */
  fechaRegistro: Date | null;

  /** Nombres de los roles asignados, sin repetir: `['ADMINISTRADOR', 'CLIENTE']`. */
  roles: string[];
}
