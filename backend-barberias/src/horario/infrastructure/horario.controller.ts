import { Controller, Get, Post, Body, Param, Patch, Query, ParseUUIDPipe, ParseArrayPipe } from '@nestjs/common';
import { HorarioService } from '../application/horario.service.js';
import { CreateHorarioDto } from '../application/dto/create-horario.dto.js';
import { CreateExcepcionHorarioDto } from '../application/dto/create-excepcion-horario.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Autenticado } from '../../iam/infrastructure/autenticado.decorator.js';

@Controller('barberias/:barberiaId/horarios')
export class HorarioController {
  constructor(private readonly horarioService: HorarioService) {}

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Get()
  findSchedules(@Param('barberiaId', ParseUUIDPipe) barberiaId: string) {
    return this.horarioService.getSchedules(barberiaId);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Post()
  configureSchedules(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body(new ParseArrayPipe({ items: CreateHorarioDto })) dto: CreateHorarioDto[],
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.configureSchedules(user.id, barberiaId, dto);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
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

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Post('excepciones')
  addException(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CreateExcepcionHorarioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.addException(user.id, barberiaId, dto);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Get('mi-horario')
  findMyBarberSchedules(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.getBarberSchedules(barberiaId, user.id);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Post('mi-horario')
  configureMyBarberSchedules(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body(new ParseArrayPipe({ items: CreateHorarioDto })) dto: CreateHorarioDto[],
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.configureBarberSchedules(user.id, barberiaId, dto);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
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
