import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export const MODOS_RESERVA = ['MANUAL', 'AUTOMATICO'] as const;
export type ModoReserva = (typeof MODOS_RESERVA)[number];

/** Campos que el cliente puede enviar al actualizar la configuración de la barbería. */
export class ConfiguracionBarberiaDto {
  @IsOptional()
  @IsIn(MODOS_RESERVA)
  modoReserva?: ModoReserva;

  @IsOptional()
  @IsBoolean()
  aceptaIndividual?: boolean;

  @IsOptional()
  @IsBoolean()
  aceptaGrupal?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPendientes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  horizonteReservaDias?: number;

  @IsOptional()
  @IsBoolean()
  nuevasReservasActivas?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  margenGrupalMinutos?: number;

  @IsOptional()
  @IsBoolean()
  permiteCancelacionEspecial?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxNinos?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPersonasTotal?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  motivoPausa?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  reactivacionMotivo?: string;
}

/** Campos que el sistema completa y el cliente no puede enviar. */
export class ConfiguracionBarberiaResponseDto {
  barberiaId: string;
  modoReserva: ModoReserva;
  aceptaIndividual: boolean;
  aceptaGrupal: boolean;
  maxPendientes: number | null;
  maxNinos: number | null;
  maxPersonasTotal: number | null;
  horizonteReservaDias: number | null;
  nuevasReservasActivas: boolean;
  margenGrupalMinutos: number;
  permiteCancelacionEspecial: boolean;
  motivoPausa: string | null;
  pausaDesde: Date | null;
  reactivacionProgramada: Date | null;
  reactivacionReal: Date | null;
}
