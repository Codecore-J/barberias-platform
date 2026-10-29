import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CategoriasService } from '../application/categorias.service.js';
import { CreateCategoriaServicioDto } from '../application/dto/create-categoria-servicio.dto.js';
import { UpdateCategoriaServicioDto } from '../application/dto/update-categoria-servicio.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';
import { OperadorBarberiaGuard } from './operador-barberia.guard.js';

/**
 * V3 · Categorías de servicio de la sede.
 *
 * La ESCRITURA es del ADMIN_BARBERIA: el modelo de negocio pone la taxonomía en
 * manos de la sede, no del barbero (que elige dentro de ella) ni del
 * ADMINISTRADOR global (que supervisa). `RolesGuard` ya acota la ruta a los roles
 * declarados y al `barberiaId` del parámetro; `OperadorBarberiaGuard` cierra el
 * paso transversal del ADMINISTRADOR por la misma razón que en el catálogo (D16).
 *
 * La LECTURA la comparten el ADMIN_BARBERIA y el BARBERO: el barbero necesita ver
 * las categorías para publicar sus servicios. El CLIENTE no la necesita: recibe
 * el catálogo ya anidado en `GET /shops/:shopId/servicios`.
 */
@Controller('shops/:shopId/categorias')
export class CategoriasController {
  constructor(private readonly categoriasService: CategoriasService) {}

  @Post()
  @Roles('ADMIN_BARBERIA')
  @UseGuards(OperadorBarberiaGuard, VinculoBarberiaGuard)
  @HttpCode(HttpStatus.CREATED)
  crear(
    @CurrentBarberiaId() barberiaId: string,
    @Body() dto: CreateCategoriaServicioDto,
  ) {
    return this.categoriasService.crear(barberiaId, dto);
  }

  @Get()
  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @UseGuards(VinculoBarberiaGuard)
  listar(@CurrentBarberiaId() barberiaId: string) {
    return this.categoriasService.listar(barberiaId);
  }

  @Patch(':id')
  @Roles('ADMIN_BARBERIA')
  @UseGuards(OperadorBarberiaGuard, VinculoBarberiaGuard)
  actualizar(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoriaServicioDto,
  ) {
    return this.categoriasService.actualizar(barberiaId, id, dto);
  }
}
