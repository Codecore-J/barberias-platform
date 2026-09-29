import { PartialType } from '@nestjs/mapped-types';
import { CreateHorarioDto } from './create-horario.dto.js';

export class UpdateHorarioDto extends PartialType(CreateHorarioDto) {}
