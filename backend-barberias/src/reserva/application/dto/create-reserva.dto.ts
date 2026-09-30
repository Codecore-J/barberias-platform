import { ArrayNotEmpty, IsArray, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, Min } from 'class-validator';

export class CreateReservaDto {
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

  @IsArray()
  @ArrayNotEmpty({ message: 'Debe incluir al menos un servicio en la reserva' })
  @IsUUID('4', { each: true })
  serviciosIds: string[];

  @IsNumber()
  @Min(0, { message: 'El precio total esperado no puede ser negativo' })
  precioTotalEsperado: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'El margen grupal histórico no puede ser negativo' })
  margenGrupalHistorico?: number;

  @IsOptional()
  @IsUUID('4')
  barberoId?: string;

  @IsOptional()
  @IsString()
  nombreInvitado?: string;
}

