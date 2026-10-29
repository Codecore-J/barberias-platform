import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * V3 · edición de una categoría de la sede.
 *
 * `activa` es la forma de retirar una categoría del catálogo (§9: nunca borrado
 * físico). Los servicios que cuelgan de ella se conservan y siguen visibles para
 * el barbero dueño, pero dejan de ofrecerse al cliente.
 */
export class UpdateCategoriaServicioDto {
  @IsString()
  @IsOptional()
  @MinLength(2, { message: 'El nombre de la categoría debe tener al menos 2 caracteres.' })
  @MaxLength(100, { message: 'El nombre de la categoría no puede superar los 100 caracteres.' })
  nombre?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'La descripción no puede superar los 500 caracteres.' })
  descripcion?: string;

  @IsBoolean()
  @IsOptional()
  activa?: boolean;
}
