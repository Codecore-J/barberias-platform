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

  @IsString()
  @Matches(/^\d{10}$/)
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
