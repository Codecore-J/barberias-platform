import { Controller, Get, Post, Body, Param, Query, ParseUUIDPipe, ParseArrayPipe } from '@nestjs/common';
import { HorarioService } from '../application/horario.service.js';
import { CreateHorarioDto } from '../application/dto/create-horario.dto.js';
import { CreateExcepcionHorarioDto } from '../application/dto/create-excepcion-horario.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';

@Controller('shops/:shopId/hours')
export class HorarioController {
  constructor(private readonly horarioService: HorarioService) {}

  /**
   * GET /barberias/:barberiaId/horarios
   * Lectura del horario de la barbería (decisión 8): el CLIENTE no entra, la
   * usa la pantalla de administración de horarios.
   */
  @Roles('ADMIN_BARBERIA')
  @Get()
  findSchedules(@Param('shopId', ParseUUIDPipe) barberiaId: string) {
    return this.horarioService.getSchedules(barberiaId);
  }

  /**
   * POST /barberias/:barberiaId/horarios
   * Escribir el horario general es del responsable de la barbería; el BARBERO
   * solo escribe el suyo con `mi-horario`.
   */
  @Roles('ADMIN_BARBERIA')
  @Post()
  configureSchedules(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
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
  @Roles('ADMIN_BARBERIA')
  @Get('exceptions')
  findExceptions(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
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
  @Roles('ADMIN_BARBERIA')
  @Post('exceptions')
  addException(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CreateExcepcionHorarioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.addException(user.id, barberiaId, dto);
  }

  /**
   * GET /barberias/:barberiaId/horarios/mi-horario
   * El horario propio del barbero: el `barberoId` sale del token, nunca del
   * cuerpo ni de la ruta.
   *
   * T-11: quien puede ESCRIBIR su horario propio (`POST`, más abajo) también
   * puede CONSULTARLO. El ADMIN_BARBERIA de la sede lee su propio horario desde
   * el mismo token, sin poder elegir a qué barbero mira; el ADMINISTRADOR global
   * queda fuera porque la matriz no le concede `agenda.propia.ver`.
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  @Get('mine')
  findMyBarberSchedules(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.getBarberSchedules(barberiaId, user.id);
  }

  /**
   * POST /barberias/:barberiaId/horarios/mi-horario
   * El BARBERO declara sus horas; el resto usa el horario general de la sede.
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  @Post('mine')
  configureMyBarberSchedules(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @Body(new ParseArrayPipe({ items: CreateHorarioDto })) dto: CreateHorarioDto[],
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.configureBarberSchedules(user.id, barberiaId, dto);
  }

  /**
   * POST /barberias/:barberiaId/horarios/barberos/:barberoId/excepciones
   * Excepción puntual de un barbero concreto: la puede pedir el propio barbero
   * o su responsable.
   *
   * F4-01: el decorador declaraba solo al ADMIN_BARBERIA, así que el BARBERO
   * recibía 403 del guard antes de llegar a la regla que ya vive en el servicio
   * (`resolverOrigenDeModificacion`: el propio barbero es origen `BARBERO` y la
   * agenda de un compañero la gestiona la sede). Ahora el barbero entra y es el
   * servicio quien exige que `barberoId` sea el suyo; el ADMIN_BARBERIA se
   * queda como estaba y el ADMINISTRADOR no gana la ruta.
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  @Post('barbers/:barberoId/exceptions')
  addBarberException(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @Param('barberoId', ParseUUIDPipe) barberoId: string,
    @Body() dto: CreateExcepcionHorarioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.addBarberException(user.id, barberiaId, barberoId, dto);
  }
}
