import { Exclude, Expose } from 'class-transformer';

/**
 * DTO de respuesta al registrar, autenticar o consultar el perfil de un usuario.
 * Nunca expone el passwordHash — está explícitamente excluido.
 */
@Exclude()
export class UsuarioResponseDto {
  @Expose()
  id: string;

  @Expose()
  nombreCompleto: string;

  @Expose()
  correo: string;

  @Expose()
  telefono: string;

  @Expose()
  cedula?: string | null;

  @Expose()
  estadoCuenta: string;

  @Expose()
  creadoAt: Date | null;

  @Expose()
  roles?: string[];

  // passwordHash está excluido por @Exclude() en la clase — nunca se expone.
  passwordHash: string;
}
