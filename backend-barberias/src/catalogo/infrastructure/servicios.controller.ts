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
import { ServiciosService } from '../application/servicios.service.js';
import { CreateServicioDto } from '../application/dto/create-servicio.dto.js';
import { UpdateServicioDto } from '../application/dto/update-servicio.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';

@Controller('catalogo/servicios')
export class ServiciosController {
  constructor(private readonly serviciosService: ServiciosService) {}

  @Post()
  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentBarberiaId() barberiaId: string,
    @Body() createServicioDto: CreateServicioDto,
  ) {
    return this.serviciosService.create(barberiaId, createServicioDto);
  }

  @Get()
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'CLIENTE')
  findAll(@CurrentBarberiaId() barberiaId: string) {
    return this.serviciosService.findAll(barberiaId);
  }

  @Get(':id')
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'CLIENTE')
  findOne(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviciosService.findOne(barberiaId, id);
  }

  @Patch(':id')
  @Roles('ADMIN_BARBERIA', 'BARBERO')
  update(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServicioDto: UpdateServicioDto,
  ) {
    return this.serviciosService.update(barberiaId, id, updateServicioDto);
  }

  @Delete(':id')
  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviciosService.deactivate(barberiaId, id);
  }
}
