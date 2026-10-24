import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsNotEmpty,
  Matches,
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

  /** Formato local: exactamente 10 dígitos numéricos, sin separadores. */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, {
    message: 'El teléfono debe tener exactamente 10 dígitos numéricos.',
  })
  telefono: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  ubicacion: string;
}
