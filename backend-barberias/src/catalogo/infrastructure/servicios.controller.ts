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
  UseGuards,
} from '@nestjs/common';
import { ServiciosService } from '../application/servicios.service.js';
import { CreateServicioDto } from '../application/dto/create-servicio.dto.js';
import { UpdateServicioDto } from '../application/dto/update-servicio.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';

/**
 * Catálogo de servicios de una barbería (E1-05).
 *
 * D16: el BARBERO consulta el catálogo pero no lo escribe. Quien crea, edita y
 * desactiva es el ADMIN_BARBERIA de la sede; el ADMINISTRADOR global entra como
 * en el resto de rutas de gestión, y así la pantalla /admin/servicios deja de
 * devolverle 403.
 *
 * E1-06 (paso 5): las dos lecturas exigen `VinculoBarberiaGuard`. El rol decide
 * si se puede consultar el catálogo; el vínculo decide de qué sede. Sin eso, un
 * CLIENTE con `barberia_id` nulo leía el catálogo de cualquier sede mandando la
 * cabecera. Las escrituras no lo necesitan: `RolesGuard` ya las acota al
 * ADMIN_BARBERIA de esa sede.
 */
@Controller(['catalogo/servicios', 'servicios'])
export class ServiciosController {
  constructor(private readonly serviciosService: ServiciosService) {}

  @Post()
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentBarberiaId() barberiaId: string,
    @Body() createServicioDto: CreateServicioDto,
  ) {
    return this.serviciosService.create(barberiaId, createServicioDto);
  }

  @Get()
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'CLIENTE', 'ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  findAll(@CurrentBarberiaId() barberiaId: string) {
    return this.serviciosService.findAll(barberiaId);
  }

  @Get(':id')
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'CLIENTE', 'ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  findOne(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviciosService.findOne(barberiaId, id);
  }

  @Patch(':id')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  update(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServicioDto: UpdateServicioDto,
  ) {
    return this.serviciosService.update(barberiaId, id, updateServicioDto);
  }

  @Delete(':id')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviciosService.deactivate(barberiaId, id);
  }
}
