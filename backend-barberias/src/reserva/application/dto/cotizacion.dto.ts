/**
 * Cotización (D44, E3-03/2): el cálculo del bloque y su precio es una regla de
 * negocio PURA que el frontend nunca hace. El endpoint `POST /reservas/cotizar`
 * devuelve el bloque total, la hora de fin, el margen, el precio total y el
 * desglose de servicios, SIN persistir ningún registro en la base de datos.
 *
 * La misma función pura (`calcularBloque`) se reutiliza en `reserva.service.ts`
 * (cuando se crea la reserva) y, junto con `disponibilidad.service.ts`, en el
 * cálculo de disponibilidad.
 */

import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, Min } from 'class-validator';

/**
 * Desglose de un servicio dentro de la cotización.
 */
export interface ServicioDesglose {
  servicioId: string;
  nombre: string;
  precio: number;
  duracionEstimada: number;
  margenOperativo: number;
}

/**
 * Resultado del cálculo puro del bloque.
 */
export interface BloqueCalculado {
  /** Duración total del bloque en minutos (Σ duraciones + margen grupal). */
  duracionTotal: number;
  /** Margen total aplicado al bloque en minutos (Σ márgenes individuales + margen grupal de la barbería). */
  margenTotal: number;
  /** Precio total inmutable congelado desde el catálogo de servicios. */
  precioTotal: number;
}

/**
 * Respuesta de cotización sin persistir (D44).
 */
export interface CotizacionResponse {
  /** Identificador de la barbería consultada. */
  barberiaId: string;
  /** Fecha solicitada. */
  fecha: string;
  /** Hora de fin del bloque. */
  horaFin: string;
  /** Total del bloque. */
  bloqueTotal: BloqueCalculado;
  /** Desglose de los servicios incluídos. */
  desgloseServicios: ServicioDesglose[];
}

/**
 * Invocación concreta (REST) de la regla de negocio. Representa la petición API
 * y puede ser empleada también como DTO de entrada para una llamada al servicio.
 */
export class CreateReservaDto {
  @IsDateString()
  fecha: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]d|2[0-3]):([0-5]d)$/, { message: 'horaInicio debe estar en formato HH:mm' })
  horaInicio: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]d|2[0-3]):([0-5]d)$/, { message: 'horaFin debe estar en formato HH:mm' })
  horaFin: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Debe incluir al menos un servicio en la reserva' })
  @IsUUID('4', { each: true })
  serviciosIds: string[];

  @IsNumber()
  @Min(0, { message: 'El precio total esperado no puede ser negativo' })
  precioTotalEsperado: number;

  @IsOptional()
  @IsUUID('4')
  barberoId?: string;

  @IsOptional()
  @IsString()
  nombreInvitado?: string;

  /** E3-03/2: el tipo de reserva es obligatorio; nunca se asume en silencio. */
  @IsString()
  @IsNotEmpty()
  @IsIn(['INDIVIDUAL', 'GRUPAL', 'AUTOMATICO', 'MANUAL'])
  tipo: string;
}
