import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';

export class CreateBarberiaDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(150)
  nombre: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  descripcion?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  telefono: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  ubicacion: string;
}
