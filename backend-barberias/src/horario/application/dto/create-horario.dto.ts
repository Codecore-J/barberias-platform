import { IsInt, IsNotEmpty, IsString, Matches, Max, Min } from 'class-validator';

export class CreateHorarioDto {
  @IsInt()
  @Min(1)
  @Max(7)
  diaSemana: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'horaInicio debe estar en formato HH:mm' })
  horaInicio: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'horaFin debe estar en formato HH:mm' })
  horaFin: string;
}
