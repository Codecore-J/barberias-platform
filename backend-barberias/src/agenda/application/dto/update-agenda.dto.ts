import { PartialType } from '@nestjs/mapped-types';
import { CreateAgendaDto } from './create-agenda.dto.js';

export class UpdateAgendaDto extends PartialType(CreateAgendaDto) {}
