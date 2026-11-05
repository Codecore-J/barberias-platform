import {
  IsEmail,
  IsIn,
  IsNotEmpty,
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

export class ActualizarPersonalDto {
  @IsIn(['ACTIVO', 'INACTIVO'])
  estado!: 'ACTIVO' | 'INACTIVO';

  @IsIn([...ROLES_PERSONAL_SEDE])
  rolNombre!: RolPersonalSede;
}
