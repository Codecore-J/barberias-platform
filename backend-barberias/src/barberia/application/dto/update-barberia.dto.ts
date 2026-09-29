import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class UpdateBarberiaDto {
  @IsString()
  @IsOptional()
  @MinLength(3)
  @MaxLength(150)
  nombre?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  descripcion?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  telefono?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  ubicacion?: string;

  @IsString()
  @IsOptional()
  estado?: string;
}
