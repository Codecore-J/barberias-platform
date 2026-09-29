import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio.' })
  @MaxLength(150, { message: 'El nombre no puede superar los 150 caracteres.' })
  nombreCompleto: string;

  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(150, { message: 'El correo no puede superar los 150 caracteres.' })
  correo: string;

  @IsString()
  @IsNotEmpty({ message: 'El teléfono es obligatorio.' })
  @MaxLength(30, { message: 'El teléfono no puede superar los 30 caracteres.' })
  telefono: string;

  /**
   * La cédula es OPCIONAL. Cuando existe, debe ser única en la base de datos.
   * La unicidad se garantiza a nivel de BD (índice parcial) y en el servicio.
   * Regla: máximo 30 caracteres, solo dígitos.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'La cédula solo debe contener dígitos.' })
  @MaxLength(30, { message: 'La cédula no puede superar los 30 caracteres.' })
  cedula?: string;

  /**
   * La contraseña nunca se guarda en texto plano.
   * El servicio aplica bcrypt antes de persistir.
   * Mínimo 8 caracteres, debe incluir al menos una letra y un número.
   */
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(72, { message: 'La contraseña no puede superar los 72 caracteres.' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'La contraseña debe contener al menos una letra y un número.',
  })
  password: string;
}
