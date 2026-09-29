import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(150)
  correo: string;

  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  @MaxLength(72)
  password: string;
}
