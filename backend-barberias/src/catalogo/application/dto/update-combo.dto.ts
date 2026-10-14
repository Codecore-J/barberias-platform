import { PartialType } from '@nestjs/mapped-types';
import { CreateComboDto } from './create-combo.dto.js';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { ESTADOS_CATALOGO_VALORES } from '../../../shared/domain/estados.js';

export class UpdateComboDto extends PartialType(CreateComboDto) {
  /**
   * E2-07 · P-SD-4: mismo catálogo que `servicios.estado` (`combos_estado_check`
   * en la base). El combo se apaga con `PATCH :id/desactivar`; aquí solo se
   * admite lo que la tabla admite.
   */
  @IsIn(ESTADOS_CATALOGO_VALORES as unknown as string[])
  @IsString()
  @IsOptional()
  estado?: string;
}
