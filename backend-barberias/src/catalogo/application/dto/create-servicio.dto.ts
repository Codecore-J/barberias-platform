import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsBoolean, Min } from 'class-validator';

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

  @IsBoolean()
  @IsOptional()
  destacado?: boolean;
}
