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
import { ServiciosBarberoService } from '../application/servicios-barbero.service.js';
import { CreateServicioBarberoDto } from '../application/dto/create-servicio-barbero.dto.js';
import { UpdateServicioBarberoDto } from '../application/dto/update-servicio-barbero.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';
import { SoloBarberoGuard } from './solo-barbero.guard.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * V3 · Catálogo híbrido.
 *
 *  - `GET /shops/:shopId/servicios` · la vitrina del CLIENTE, anidada por
 *    categorías. Se conserva el vínculo con la sede (E1-06): el catálogo de una
 *    barbería no es un directorio abierto de precios, sigue exigiendo pertenencia
 *    —rol en la sede o `cliente_barberias` ACTIVO—, igual que `/services`.
 *  - `mis-servicios` · panel del BARBERO. El `barberoId` SIEMPRE sale del JWT;
 *    `SoloBarberoGuard` impide que el ADMINISTRADOR global «publique como» él y el
 *    servicio vuelve a comprobar el rol BARBERO en esa sede.
 *
 * `/mis-servicios` no se llama `/services` para no confundirse con el catálogo
 * heredado (`Servicio`, del ADMIN_BARBERIA), que sigue vivo para las reservas
 * existentes: son dos tablas y dos permisos distintos.
 */
@Controller('shops/:shopId')
export class ServiciosBarberoController {
  constructor(private readonly serviciosBarberoService: ServiciosBarberoService) {}

  @Get('servicios')
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  catalogo(@CurrentBarberiaId() barberiaId: string) {
    return this.serviciosBarberoService.catalogoAnidado(barberiaId);
  }

  @Post('mis-servicios')
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  @HttpCode(HttpStatus.CREATED)
  crear(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Body() dto: CreateServicioBarberoDto,
  ) {
    return this.serviciosBarberoService.crear(barberiaId, user.id, dto);
  }

  @Get('mis-servicios')
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  listarMios(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.serviciosBarberoService.listarMios(barberiaId, user.id);
  }

  @Patch('mis-servicios/:id')
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  actualizar(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServicioBarberoDto,
  ) {
    return this.serviciosBarberoService.actualizar(barberiaId, user.id, id, dto);
  }
}
