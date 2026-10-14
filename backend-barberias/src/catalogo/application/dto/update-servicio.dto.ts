import { PartialType } from '@nestjs/mapped-types';
import { CreateServicioDto } from './create-servicio.dto.js';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { ESTADOS_CATALOGO_VALORES } from '../../../shared/domain/estados.js';

export class UpdateServicioDto extends PartialType(CreateServicioDto) {
  /**
   * E2-07 · P-SD-4: `estado` es un CATÁLOGO, no texto libre. El cambio de
   * estado en sí se hace por `PATCH :id/desactivar` y `PATCH :id/reactivar`;
   * este campo queda para `PATCH :id` y solo admite los dos valores que la
   * base ya acepta (`servicios_estado_check`), así que un valor fuera de
   * catálogo responde 400 y no un 500 por violación de CHECK.
   */
  @IsIn(ESTADOS_CATALOGO_VALORES as unknown as string[])
  @IsString()
  @IsOptional()
  estado?: string;
}
