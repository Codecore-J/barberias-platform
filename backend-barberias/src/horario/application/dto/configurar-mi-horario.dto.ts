import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { DiaHorarioBarberoDto } from './dia-horario-barbero.dto.js';

/**
 * V3 fase 5 · `PUT /shops/:shopId/mi-horario`.
 *
 * El barbero envía SU semana. La pantalla manda los siete días (los libres
 * incluidos) para que el motor no tenga que adivinar: una semana completa es
 * explícita y el «día libre» deja de depender de la ausencia de fila.
 *
 * Se aceptan menos de siete días por comodidad de los clientes, pero nunca dos
 * filas del mismo día: el servicio lo rechaza con 400 y la base tiene su propio
 * UNIQUE.
 */
export class ConfigurarMiHorarioDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Debes enviar al menos un día.' })
  @ArrayMaxSize(7, { message: 'La semana tiene siete días como máximo.' })
  @ValidateNested({ each: true })
  @Type(() => DiaHorarioBarberoDto)
  dias: DiaHorarioBarberoDto[];
}
