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
import { ServiciosService } from '../application/servicios.service.js';
import { CreateServicioDto } from '../application/dto/create-servicio.dto.js';
import { UpdateServicioDto } from '../application/dto/update-servicio.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';
import { SoloBarberoGuard } from './solo-barbero.guard.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * Catálogo de servicios de una barbería (E1-05).
 *
 * D16 (corregido): el catálogo lo GESTIONA el BARBERO. Él crea, edita y
 * desactiva los servicios de su sede; el ADMIN_BARBERIA y el ADMINISTRADOR
 * global solo lo CONSULTAN, en modo lectura/supervisión. Antes estaba al revés
 * y el barbero —quien conoce precios y duración real— no podía mantener su
 * propio catálogo.
 *
 * Las lecturas conservan al CLIENTE: `GET /servicios` alimenta la vitrina
 * pública, el wizard de reserva y el walk-in. Es una lectura acotada por
 * `VinculoBarberiaGuard`, así que abrirla no da acceso a la escritura.
 *
 * `SoloBarberoGuard` es imprescindible en las escrituras: `RolesGuard` deja
 * pasar al ADMINISTRADOR global por jerarquía y, sin este guard, el 403 que pide
 * la regla de negocio no ocurriría nunca.
 *
 * E1-06 (paso 5): TODAS las rutas exigen `VinculoBarberiaGuard`. El rol decide
 * qué se puede hacer; el vínculo decide de qué sede. Sin él, un usuario leía o
 * escribía contra la sede que dijera la cabecera.
 */
@Controller(['catalogo/servicios', 'servicios'])
export class ServiciosController {
  constructor(private readonly serviciosService: ServiciosService) {}

  @Post()
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
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
  findAll(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() usuario?: UsuarioAutenticado,
  ) {
    return this.serviciosService.findAll(barberiaId, usuario);
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
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  update(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServicioDto: UpdateServicioDto,
  ) {
    return this.serviciosService.update(barberiaId, id, updateServicioDto);
  }

  /**
   * PATCH /catalogo/servicios/:id/desactivar · E2-07 (D29)
   *
   * El verbo describe el EFECTO: el servicio no se borra, pasa a INACTIVO y sale
   * del catálogo (`findAll` filtra por ACTIVO). Las reglas de cuándo se puede
   * viven en el servicio: 422 `SERVICIO_EN_USO` si hay reservas por confirmar y
   * 422 `SERVICIO_EN_COMBO_ACTIVO` si está dentro de un combo activo.
   */
  @Patch(':id/desactivar')
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  @HttpCode(HttpStatus.OK)
  desactivar(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviciosService.desactivar(barberiaId, id);
  }

  /**
   * PATCH /catalogo/servicios/:id/reactivar · E2-07 (D29)
   *
   * La vuelta atrás explícita: sin ella, `DELETE` era irreversible y recuperar
   * un servicio exigía tocar la base.
   */
  @Patch(':id/reactivar')
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  @HttpCode(HttpStatus.OK)
  reactivar(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviciosService.reactivar(barberiaId, id);
  }
}
