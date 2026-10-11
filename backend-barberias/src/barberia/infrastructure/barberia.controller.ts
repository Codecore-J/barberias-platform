import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Delete,
  Patch,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { Autenticado } from '../../iam/infrastructure/autenticado.decorator.js';
import { esAdministradorGlobal } from '../../iam/domain/roles.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { BarberiaService } from '../application/barberia.service.js';
import { CreateBarberiaDto } from '../application/dto/create-barberia.dto.js';
import { UpdateBarberiaDto } from '../application/dto/update-barberia.dto.js';
import { VincularBarberiaDto } from '../application/dto/vincular-barberia.dto.js';

@Controller('barberias')
export class BarberiaController {
  constructor(private readonly barberiaService: BarberiaService) {}

  /** POST /barberias — cualquier usuario autenticado puede crear una barbería (E1-07). */
  @Autenticado()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.create(user.id, dto);
  }

  /** GET /barberias/por-enlace/:enlace — datos públicos de la sede para el QR (E3-12). */
  @Autenticado()
  @Get('por-enlace/:enlace')
  porEnlace(
    @Param('enlace') enlace: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.buscarPorEnlace(enlace, user);
  }

  /** POST /barberias/vincular — el CLIENTE se vincula con el código de acceso (T2.2). */
  @Roles('CLIENTE')
  @Post('vincular')
  vincular(
    @Body() dto: VincularBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.vincularCliente(user.id, dto);
  }

  /** GET /barberias — lista las sedes donde el usuario es responsable (E1-07). */
  @Autenticado()
  @Get()
  findMine(@CurrentUser() user: UsuarioAutenticado) {
    return this.barberiaService.findAllByResponsable(user.id, user);
  }

  /** GET /barberias/all — solo el ADMINISTRADOR global (D05). */
  @Get('all')
  @Roles('ADMINISTRADOR')
  findAll() {
    return this.barberiaService.findAll();
  }

  /** GET /barberias/:id/personal — personal de una sede (E1-03 · H19). */
  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @Get(':id/personal')
  findPersonal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.findPersonal(id, user);
  }

  /** POST /barberias/:id/desvincular — el CLIENTE deja el vínculo sin borrar historial (E3-12). */
  @Roles('CLIENTE')
  @Post(':id/desvincular')
  desvincular(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.desvincular(user.id, id);
  }

  /** GET /barberias/:id — lectura pública/privada según quién pregunta (E1-05). */
  @Autenticado()
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.findOne(id, user);
  }

  /** PATCH /barberias/:id/seleccionar — elige la barbería activa (T2.3, E1-06). */
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Patch(':id/seleccionar')
  seleccionarActiva(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.seleccionarBarberiaActiva(user.id, id, user);
  }

  /** PATCH /barberias/:id — edita la sede: ADMIN_BARBERIA propio o ADMINISTRADOR global. */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.update(id, user.id, dto, esAdministradorGlobal(user));
  }

  /** DELETE /barberias/:id — soft-delete a INACTIVO solo por ADMINISTRADOR global. */
  @Roles('ADMINISTRADOR')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.remove(id, user.id, esAdministradorGlobal(user));
  }
}
