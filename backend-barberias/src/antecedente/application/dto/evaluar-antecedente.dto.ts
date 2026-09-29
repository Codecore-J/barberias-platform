import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export enum DecisionAntecedente {
  APROBADO = 'APROBADO',
  RECHAZADO = 'RECHAZADO',
}

export class EvaluarAntecedenteDto {
  @IsEnum(DecisionAntecedente, {
    message: 'decision debe ser APROBADO o RECHAZADO',
  })
  decision: DecisionAntecedente;

  @ValidateIf((o) => o.decision === DecisionAntecedente.RECHAZADO)
  @IsString({ message: 'El motivo de rechazo debe ser texto' })
  @IsNotEmpty({ message: 'El motivo de rechazo es obligatorio cuando se rechaza' })
  @MaxLength(500, { message: 'El motivo de rechazo no puede superar los 500 caracteres' })
  motivoRechazo?: string;
}
