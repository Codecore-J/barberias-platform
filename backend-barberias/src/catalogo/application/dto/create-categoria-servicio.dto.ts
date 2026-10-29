import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * V3 · alta de una categoría de la sede.
 *
 * El `barberiaId` NO viaja en el cuerpo: sale del contexto de tenant de la ruta
 * (`/shops/:shopId/categorias`). Aceptarlo aquí permitiría crear la categoría en
 * una sede distinta de la de la URL.
 */
export class CreateCategoriaServicioDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la categoría es obligatorio.' })
  @MinLength(2, { message: 'El nombre de la categoría debe tener al menos 2 caracteres.' })
  @MaxLength(100, { message: 'El nombre de la categoría no puede superar los 100 caracteres.' })
  nombre: string;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'La descripción no puede superar los 500 caracteres.' })
  descripcion?: string;
}
