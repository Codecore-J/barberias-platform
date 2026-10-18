import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * H68 · §7.3: anular un cobro exige MOTIVO.
 *
 * Una operación de caja que deshace un ingreso sin explicación no se puede
 * auditar después: el motivo es obligatorio, con el mismo criterio que E3-08
 * para la cancelación especial y D26 para el rechazo de una solicitud. La
 * longitud se acota porque acaba en el contexto de la auditoría y en la fila
 * del pago, no en un campo libre de texto infinito.
 */
export class AnularPagoDto {
  @IsString({ message: 'El motivo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El motivo de la anulación es obligatorio' })
  @MaxLength(500, { message: 'El motivo no puede superar los 500 caracteres' })
  motivo: string;
}
