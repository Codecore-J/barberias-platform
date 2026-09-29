import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

export enum TipoExcepcionHorario {
  CERRADA = 'CERRADA',
  HORARIO_ESPECIAL = 'HORARIO_ESPECIAL',
}

export class CreateExcepcionHorarioDto {
  @IsDateString()
  fecha: string;

  @IsEnum(TipoExcepcionHorario)
  tipo: TipoExcepcionHorario;

  @ValidateIf(o => o.tipo === TipoExcepcionHorario.HORARIO_ESPECIAL)
  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'horaInicio debe estar en formato HH:mm' })
  horaInicio?: string;

  @ValidateIf(o => o.tipo === TipoExcepcionHorario.HORARIO_ESPECIAL)
  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'horaFin debe estar en formato HH:mm' })
  horaFin?: string;

  @IsOptional()
  @IsString()
  motivo?: string;
}
