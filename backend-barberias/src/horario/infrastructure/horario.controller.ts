import { Controller, Get, Post, Body, Param, Patch, Query, ParseUUIDPipe, ParseArrayPipe } from '@nestjs/common';
import { HorarioService } from '../application/horario.service.js';
import { CreateHorarioDto } from '../application/dto/create-horario.dto.js';
import { CreateExcepcionHorarioDto } from '../application/dto/create-excepcion-horario.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';

@Controller('barberias/:barberiaId/horarios')
export class HorarioController {
  constructor(private readonly horarioService: HorarioService) {}

  /**
   * GET /barberias/:barberiaId/horarios
   * Lectura del horario de la barbería (decisión 8): el CLIENTE no entra, la
   * usa la pantalla de administración de horarios.
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get()
  findSchedules(@Param('barberiaId', ParseUUIDPipe) barberiaId: string) {
    return this.horarioService.getSchedules(barberiaId);
  }

  /**
   * POST /barberias/:barberiaId/horarios
   * Escribir el horario general es del responsable de la barbería; el BARBERO
   * solo escribe el suyo con `mi-horario`.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post()
  configureSchedules(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body(new ParseArrayPipe({ items: CreateHorarioDto })) dto: CreateHorarioDto[],
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.configureSchedules(user.id, barberiaId, dto);
  }

  /**
   * GET /barberias/:barberiaId/horarios/excepciones
   * Lectura de excepciones, misma política que la lectura de horarios
   * (decisión 8).
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get('excepciones')
  findExceptions(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const fromDate = from ? new Date(from) : new Date();
    const toDate = to ? new Date(to) : new Date(new Date().setMonth(new Date().getMonth() + 1));
    return this.horarioService.getExceptions(barberiaId, fromDate, toDate);
  }

  /**
   * POST /barberias/:barberiaId/horarios/excepciones
   * Excepción global de la barbería: la declara su responsable.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post('excepciones')
  addException(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CreateExcepcionHorarioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.addException(user.id, barberiaId, dto);
  }

  /**
   * GET /barberias/:barberiaId/horarios/mi-horario
   * El horario propio del barbero: el `barberoId` sale del token, nunca del
   * cuerpo ni de la ruta.
   */
  @Roles('BARBERO')
  @Get('mi-horario')
  findMyBarberSchedules(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.getBarberSchedules(barberiaId, user.id);
  }

  /**
   * POST /barberias/:barberiaId/horarios/mi-horario
   * El BARBERO declara sus horas; el resto usa el horario general de la sede.
   */
  @Roles('BARBERO')
  @Post('mi-horario')
  configureMyBarberSchedules(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body(new ParseArrayPipe({ items: CreateHorarioDto })) dto: CreateHorarioDto[],
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.configureBarberSchedules(user.id, barberiaId, dto);
  }

  /**
   * POST /barberias/:barberiaId/horarios/barberos/:barberoId/excepciones
   * Excepción puntual de un barbero concreto: la puede pedir el propio barbero
   * o su responsable.
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post('barberos/:barberoId/excepciones')
  addBarberException(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('barberoId', ParseUUIDPipe) barberoId: string,
    @Body() dto: CreateExcepcionHorarioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.addBarberException(user.id, barberiaId, barberoId, dto);
  }
}
