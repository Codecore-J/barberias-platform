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

  /**
   * Formato local: exactamente 10 dígitos numéricos, sin guiones, espacios ni
   * prefijo internacional. `usuarios.telefono` es UNIQUE, así que una cadena
   * con formato libre acababa siendo la clave de identidad de la cuenta.
   */
  @IsString()
  @IsNotEmpty({ message: 'El teléfono es obligatorio.' })
  @Matches(/^\d{10}$/, {
    message: 'El teléfono debe tener exactamente 10 dígitos numéricos.',
  })
  telefono: string;

  /**
   * La cédula es OPCIONAL. Cuando existe, debe ser única en la base de datos.
   * La unicidad se garantiza a nivel de BD (índice parcial) y en el servicio.
   * Regla: exactamente 11 dígitos numéricos, sin guiones.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, {
    message: 'La cédula debe tener exactamente 11 dígitos numéricos.',
  })
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
