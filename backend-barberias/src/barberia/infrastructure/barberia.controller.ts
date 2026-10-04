import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { BarberiaService } from '../application/barberia.service.js';
import { CreateBarberiaDto } from '../application/dto/create-barberia.dto.js';
import { UpdateBarberiaDto } from '../application/dto/update-barberia.dto.js';
import { VincularBarberiaDto } from '../application/dto/vincular-barberia.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Autenticado } from '../../iam/infrastructure/autenticado.decorator.js';

@Controller('barberias')
export class BarberiaController {
  constructor(private readonly barberiaService: BarberiaService) {}

  /**
   * POST /barberias
   * Cualquier usuario autenticado puede crear una barbería.
   * El responsable se extrae automáticamente del JWT.
   */
  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.create(user.id, dto);
  }

  /**
   * POST /barberias/vincular
   * Vincula al usuario actual a una barbería mediante código de acceso.
   */
  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Post('vincular')
  vincular(
    @Body() dto: VincularBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.vincularCliente(user.id, dto);
  }

  /**
   * GET /barberias
   * Lista las barberías donde el usuario es responsable.
   */
  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Get()
  findMine(@CurrentUser() user: UsuarioAutenticado) {
    return this.barberiaService.findAllByResponsable(user.id);
  }

  /**
   * GET /barberias/all
   * Solo SUPER_ADMIN puede listar todas las barberías.
   */
  @Get('all')
  @Roles('SUPER_ADMIN')
  findAll() {
    return this.barberiaService.findAll();
  }

  /**
   * GET /barberias/:id/personal
   * Lista el personal (barberos y administradores) de una barbería.
   */
  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Get(':id/personal')
  findPersonal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    // Ideally check if user has access to this info, but for MVP it's okay
    return this.barberiaService.findPersonal(id);
  }

  /**
   * GET /barberias/:id
   * Cualquier usuario autenticado puede consultar una barbería por ID.
   */
  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.barberiaService.findOne(id);
  }

  /**
   * PATCH /barberias/:id/seleccionar
   * Selecciona una barbería como la activa para el usuario (apaga las demás).
   */
  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Patch(':id/seleccionar')
  seleccionarActiva(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.seleccionarBarberiaActiva(user.id, id);
  }

  /**
   * PATCH /barberias/:id
   * Solo el responsable de la barbería o un SUPER_ADMIN puede editarla.
   */
  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const isSuperAdmin = user.roles?.includes('SUPER_ADMIN') ?? false;
    return this.barberiaService.update(id, user.id, dto, isSuperAdmin);
  }

  /**
   * DELETE /barberias/:id
   * Soft-delete — cambia estado a INACTIVO.
   * Solo el responsable o SUPER_ADMIN puede eliminarlo.
   */
  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const isSuperAdmin = user.roles?.includes('SUPER_ADMIN') ?? false;
    return this.barberiaService.remove(id, user.id, isSuperAdmin);
  }
}
