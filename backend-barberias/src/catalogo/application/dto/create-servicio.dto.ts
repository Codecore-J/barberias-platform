import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, Min } from 'class-validator';
import { BooleanoEstricto } from '../../../shared/booleano-estricto.decorator.js';

export class CreateServicioDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

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
