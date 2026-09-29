import { PartialType } from '@nestjs/mapped-types';
import { CreateComboDto } from './create-combo.dto.js';
import { IsString, IsOptional } from 'class-validator';

export class UpdateComboDto extends PartialType(CreateComboDto) {
  @IsString()
  @IsOptional()
  estado?: string;
}
