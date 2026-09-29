import { PartialType } from '@nestjs/mapped-types';
import { CreateServicioDto } from './create-servicio.dto.js';
import { IsString, IsOptional } from 'class-validator';

export class UpdateServicioDto extends PartialType(CreateServicioDto) {
  @IsString()
  @IsOptional()
  estado?: string;
}
