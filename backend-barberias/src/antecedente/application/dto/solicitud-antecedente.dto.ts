import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** F5 / T-52 · lo que el personal de la sede pide sobre un cliente. */
export class CrearSolicitudAntecedenteDto {
  @IsUUID('4', { message: 'clienteId debe ser un UUID válido' })
  @IsNotEmpty({ message: 'El cliente es obligatorio' })
  clienteId: string;

  @IsString({ message: 'El motivo debe ser texto' })
  @IsNotEmpty({ message: 'El motivo es obligatorio' })
  @MaxLength(2000, { message: 'El motivo no puede superar los 2000 caracteres' })
  motivo: string;

  @IsOptional()
  @IsString({ message: 'La evidencia debe ser texto' })
  @MaxLength(2000, { message: 'La evidencia no puede superar los 2000 caracteres' })
  evidenciaTexto?: string;
}

/** F5 / T-53 · la decisión de la plataforma. */
export enum DecisionSolicitudAntecedente {
  APROBAR = 'APROBAR',
  DENEGAR = 'DENEGAR',
}

export class ResolverSolicitudAntecedenteDto {
  @IsEnum(DecisionSolicitudAntecedente, {
    message: 'decision debe ser APROBAR o DENEGAR',
  })
  decision: DecisionSolicitudAntecedente;

  /**
   * Solo al denegar. La obligación real vive en el servicio (422
   * `MOTIVO_REQUERIDO`), igual que en las demás resoluciones de la plataforma:
   * el DTO no puede saber si el motivo llegó en blanco.
   */
  @IsOptional()
  @IsString({ message: 'El motivo debe ser texto' })
  @MaxLength(500, { message: 'El motivo no puede superar los 500 caracteres' })
  motivo?: string;
}
