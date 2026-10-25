import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Roles que la PLATAFORMA puede asignar al dar de alta una cuenta (D05). Son
 * los cuatro del catálogo del seed; `SUPER_ADMIN` no existe.
 */
export const ROLES_PLATAFORMA = [
  'ADMINISTRADOR',
  'ADMIN_BARBERIA',
  'BARBERO',
  'CLIENTE',
] as const;

export type RolPlataforma = (typeof ROLES_PLATAFORMA)[number];

/**
 * Cuerpo de `POST /plataforma/usuarios` (alta administrativa de una cuenta).
 *
 * Diferencia con `/auth/register`: aquí el ADMINISTRADOR elige el ROL y, para
 * los roles de ámbito BARBERIA, la sede. El registro público siempre crea un
 * CLIENTE.
 *
 * `telefono` es OBLIGATORIO aunque el alta lo describa como opcional: en el
 * esquema `usuarios.telefono` es `String @unique` (NOT NULL), y el registro
 * público también lo exige. `cedula` sí es opcional, como en `RegisterDto`.
 *
 * La regla «rol de sede exige barbería» NO se valida aquí: es negocio, y el
 * contrato D40 la responde como 422 en el servicio, no como 400 del
 * `ValidationPipe`.
 */
export class CrearUsuarioPlataformaDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio.' })
  @MaxLength(150, { message: 'El nombre no puede superar los 150 caracteres.' })
  nombreCompleto!: string;

  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(150, { message: 'El correo no puede superar los 150 caracteres.' })
  correo!: string;

  /** Mismo contrato que `/auth/register`: bcrypt, mínimo 8, letra y número. */
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(72, { message: 'La contraseña no puede superar los 72 caracteres.' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'La contraseña debe contener al menos una letra y un número.',
  })
  password!: string;

  /** Mismo formato que `/auth/register`: 10 dígitos, sin separadores. */
  @IsString()
  @IsNotEmpty({ message: 'El teléfono es obligatorio.' })
  @Matches(/^\d{10}$/, {
    message: 'El teléfono debe tener exactamente 10 dígitos numéricos.',
  })
  telefono!: string;

  /**
   * Mismo contrato que `/auth/register`: opcional, y 11 dígitos si se indica.
   * El `@Transform` convierte `""` en `undefined` para no chocar con el índice
   * único parcial de `cedula` ni fallar la validación de formato.
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (value.trim() === '' ? undefined : value.trim()) : value,
  )
  @Matches(/^\d{11}$/, {
    message: 'La cédula debe tener exactamente 11 dígitos numéricos.',
  })
  cedula?: string;

  @IsIn([...ROLES_PLATAFORMA], {
    message: `rolNombre debe ser uno de: ${ROLES_PLATAFORMA.join(', ')}.`,
  })
  rolNombre!: RolPlataforma;

  /** Obligatorio para ADMIN_BARBERIA y BARBERO; prohibido para roles GLOBAL. */
  @IsOptional()
  @IsUUID()
  barberiaId?: string;
}
