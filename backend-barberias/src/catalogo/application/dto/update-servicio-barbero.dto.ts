import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * V3 · edición del servicio propio del barbero.
 *
 * `activo: false` es la forma de retirarlo del catálogo sin borrarlo (§9); el
 * barbero dueño puede reactivarlo después. Cambiar `categoriaId` exige que la
 * categoría destino sea de la MISMA sede (lo valida el servicio).
 */
export class UpdateServicioBarberoDto {
  @IsString()
  @IsOptional()
  @MinLength(2, { message: 'El nombre del servicio debe tener al menos 2 caracteres.' })
  @MaxLength(100, { message: 'El nombre del servicio no puede superar los 100 caracteres.' })
  nombre?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio admite como máximo dos decimales.' })
  @Min(0, { message: 'El precio no puede ser negativo.' })
  @IsOptional()
  precio?: number;

  @IsInt({ message: 'La duración debe ser un número entero de minutos.' })
  @Min(5, { message: 'La duración mínima es de 5 minutos.' })
  @Max(480, { message: 'La duración máxima es de 480 minutos (8 horas).' })
  @IsOptional()
  duracionMinutos?: number;

  @IsUUID('4', { message: 'La categoría indicada no es válida.' })
  @IsOptional()
  categoriaId?: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
