import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateAntecedenteDto {
  @IsUUID('4', { message: 'usuarioId debe ser un UUID válido (ID del cliente)' })
  @IsNotEmpty({ message: 'El ID del cliente es obligatorio' })
  usuarioId: string;

  @IsString({ message: 'La categoría debe ser texto' })
  @IsNotEmpty({ message: 'La categoría es obligatoria' })
  @MaxLength(50, { message: 'La categoría no puede superar los 50 caracteres' })
  categoria: string; // TECNICA, CONDUCTA, PREFERENCIA, GENERAL

  @IsString({ message: 'El contenido debe ser texto' })
  @IsNotEmpty({ message: 'El contenido de la observación es obligatorio' })
  @MaxLength(1000, { message: 'El contenido no puede superar los 1000 caracteres' })
  contenido: string;

  @IsOptional()
  @IsBoolean({ message: 'compartido debe ser un valor booleano' })
  compartido?: boolean;
}
