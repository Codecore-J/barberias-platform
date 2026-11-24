import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsOptional,
  MaxLength,
  Min,
} from 'class-validator';
import { BooleanoEstricto } from '../../../shared/booleano-estricto.decorator.js';

export class CreateServicioDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  /**
   * T-22 · descripción opcional del servicio. DEF-03 la había retirado porque el
   * panel la enviaba y la API la rechazaba; ahora forma parte del contrato con
   * el mismo tope que la columna (VARCHAR(500)).
   */
  @IsString()
  @MaxLength(500)
  @IsOptional()
  descripcion?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  precio: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  duracionEstimada?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  duracionMinutos?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  margenOperativo?: number;

  @BooleanoEstricto()
  @IsOptional()
  destacado?: boolean;
}
