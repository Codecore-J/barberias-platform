import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * V3 · servicio que el BARBERO publica en una categoría de la sede.
 *
 * El `barberoId` sale del JWT (`@CurrentUser`), nunca del cuerpo: si viajara en el
 * payload, un barbero podría publicar servicios a nombre de otro. El `precio` y la
 * `duracionMinutos` son libres (nomenclatura del barbero) pero acotados: una
 * duración de 0 no se puede bloquear en la agenda y un precio negativo no existe.
 */
export class CreateServicioBarberoDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del servicio es obligatorio.' })
  @MinLength(2, { message: 'El nombre del servicio debe tener al menos 2 caracteres.' })
  @MaxLength(100, { message: 'El nombre del servicio no puede superar los 100 caracteres.' })
  nombre: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio admite como máximo dos decimales.' })
  @Min(0, { message: 'El precio no puede ser negativo.' })
  precio: number;

  @IsInt({ message: 'La duración debe ser un número entero de minutos.' })
  @Min(5, { message: 'La duración mínima es de 5 minutos.' })
  @Max(480, { message: 'La duración máxima es de 480 minutos (8 horas).' })
  duracionMinutos: number;

  @IsUUID('4', { message: 'La categoría indicada no es válida.' })
  categoriaId: string;
}
