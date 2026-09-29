import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CombosService } from '../application/combos.service.js';
import { CreateComboDto } from '../application/dto/create-combo.dto.js';
import { UpdateComboDto } from '../application/dto/update-combo.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';

@Controller('catalogo/combos')
export class CombosController {
  constructor(private readonly combosService: CombosService) {}

  @Post()
  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentBarberiaId() barberiaId: string,
    @Body() createComboDto: CreateComboDto,
  ) {
    return this.combosService.create(barberiaId, createComboDto);
  }

  @Get()
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'CLIENTE')
  findAll(@CurrentBarberiaId() barberiaId: string) {
    return this.combosService.findAll(barberiaId);
  }

  @Get(':id')
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'CLIENTE')
  findOne(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combosService.findOne(barberiaId, id);
  }

  @Patch(':id')
  @Roles('ADMIN_BARBERIA', 'BARBERO')
  update(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateComboDto: UpdateComboDto,
  ) {
    return this.combosService.update(barberiaId, id, updateComboDto);
  }

  @Delete(':id')
  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combosService.deactivate(barberiaId, id);
  }
}
