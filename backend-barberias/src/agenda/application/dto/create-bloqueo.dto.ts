import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator';

export class CreateBloqueoDto {
  @IsDateString()
  fecha: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'horaInicio debe estar en formato HH:mm' })
  horaInicio: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'horaFin debe estar en formato HH:mm' })
  horaFin: string;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  liberacionAutomaticaMinutos?: number;
}
