import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** T-27 · los dos tipos de solicitud que puede mandar el barbero. */
export const TIPOS_SOLICITUD_SERVICIO = ['ALTA', 'DESACTIVACION'] as const;
export type TipoSolicitudServicio = (typeof TIPOS_SOLICITUD_SERVICIO)[number];

/**
 * T-27 · cuerpo de la solicitud.
 *
 * `ALTA` exige categoría, nombre, precio y duración; `DESACTIVACION` exige el
 * servicio publicado. El DTO deja los dos juegos opcionales porque el tipo
 * viaja en el mismo cuerpo: la regla que los hace obligatorios vive en el
 * servicio, que responde 400/422 con el código D40 correspondiente.
 */
export class CrearSolicitudServicioDto {
  @IsIn(TIPOS_SOLICITUD_SERVICIO)
  tipo!: TipoSolicitudServicio;

  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(480)
  duracionMinutos?: number;

  @IsOptional()
  @IsUUID()
  servicioId?: string;
}
/** T-28 · resolución: aprobar o rechazar con motivo obligatorio. */
export class ResolverSolicitudServicioDto {
  @IsBoolean()
  aprobar!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivoRechazo?: string;
}
