import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { CombosService } from '../application/combos.service.js';
import { CreateComboDto } from '../application/dto/create-combo.dto.js';
import { UpdateComboDto } from '../application/dto/update-combo.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';
import { OperadorBarberiaGuard } from './operador-barberia.guard.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * Catálogo de combos de una barbería (E1-05).
 *
 * Misma política que los servicios (D16): el BARBERO y el ADMIN_BARBERIA de la
 * sede gestionan los combos; el ADMINISTRADOR global solo supervisa. El combo
 * se arma con servicios, así que el que opera la sede es el que lo mantiene.
 *
 * E1-06 (paso 5): TODAS las rutas exigen `VinculoBarberiaGuard`, igual que en
 * los servicios. El fallo era el mismo: el rol CLIENTE tiene `barberia_id` nulo
 * y `alcanceCumple` lo trata como comodín, así que sin vínculo cualquier cliente
 * autenticado leía los precios de cualquier sede con solo la cabecera.
 */
@Controller('catalogo/combos')
export class CombosController {
  constructor(private readonly combosService: CombosService) {}

  @Post()
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  @UseGuards(OperadorBarberiaGuard, VinculoBarberiaGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentBarberiaId() barberiaId: string,
    @Body() createComboDto: CreateComboDto,
  ) {
    return this.combosService.create(barberiaId, createComboDto);
  }

  @Get()
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'CLIENTE', 'ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  findAll(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() usuario?: UsuarioAutenticado,
  ) {
    return this.combosService.findAll(barberiaId, usuario);
  }

  @Get(':id')
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'CLIENTE', 'ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  findOne(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combosService.findOne(barberiaId, id);
  }

  @Patch(':id')
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  @UseGuards(OperadorBarberiaGuard, VinculoBarberiaGuard)
  update(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateComboDto: UpdateComboDto,
  ) {
    return this.combosService.update(barberiaId, id, updateComboDto);
  }

  /**
   * PATCH /catalogo/combos/:id/desactivar · E2-07 (D29)
   * El combo pasa a INACTIVO y sale del catálogo. Es además la acción que
   * desbloquea la regla `SERVICIO_EN_COMBO_ACTIVO` de sus servicios.
   */
  @Patch(':id/desactivar')
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  @UseGuards(OperadorBarberiaGuard, VinculoBarberiaGuard)
  @HttpCode(HttpStatus.OK)
  desactivar(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combosService.desactivar(barberiaId, id);
  }

  /** PATCH /catalogo/combos/:id/reactivar · E2-07 (D29) */
  @Patch(':id/reactivar')
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  @UseGuards(OperadorBarberiaGuard, VinculoBarberiaGuard)
  @HttpCode(HttpStatus.OK)
  reactivar(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combosService.reactivar(barberiaId, id);
  }
}
