import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const ROLES_PERSONAL_SEDE = ['BARBERO', 'ADMIN_BARBERIA'] as const;
export type RolPersonalSede = (typeof ROLES_PERSONAL_SEDE)[number];

export class InvitarPersonalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombreCompleto!: string;

  @IsEmail()
  @MaxLength(150)
  correo!: string;

  /**
   * Teléfono local: exactamente 10 dígitos, sin separadores.
   *
   * Se valida como texto (`@IsString`) y no como número a propósito: convertir
   * a `number` es lo que produjo los valores `600NaN2222` que había que limpiar
   * en la base. El mensaje es explícito porque el genérico de `@Matches` no dice
   * al usuario qué formato se espera.
   */
  @IsString({ message: 'El teléfono debe enviarse como texto.' })
  @IsNotEmpty({ message: 'El teléfono es obligatorio.' })
  @Matches(/^\d{10}$/, {
    message: 'El teléfono debe tener exactamente 10 dígitos numéricos, sin separadores.',
  })
  telefono!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/)
  password!: string;

  @IsIn([...ROLES_PERSONAL_SEDE])
  rolNombre!: RolPersonalSede;
}

/**
 * I-06 · cambio de rol y de estado del personal de una sede.
 *
 * Los dos campos son OPCIONALES por separado (al menos uno debe llegar, y lo
 * valida el servicio): apagar a un miembro y cambiarle el rol son operaciones
 * distintas, y exigir `rolNombre` para «Cambiar Estado» obligaba al cliente a
 * reenviar un rol que no quería tocar —y a fallar con 400 si lo omitía—.
 *
 * Revocar el acceso NO es asignar `CLIENTE`: los roles de sede viven en
 * `usuario_roles` con su `barberiaId`, y el rol base `CLIENTE` es GLOBAL (sin
 * sede). Revocar es `DELETE /shops/:shopId/staff/:userId`, que borra el vínculo.
 */
export class ActualizarPersonalDto {
  @IsOptional()
  @IsIn(['ACTIVO', 'INACTIVO'])
  estado?: 'ACTIVO' | 'INACTIVO';

  @IsOptional()
  @IsIn([...ROLES_PERSONAL_SEDE])
  rolNombre?: RolPersonalSede;
}
