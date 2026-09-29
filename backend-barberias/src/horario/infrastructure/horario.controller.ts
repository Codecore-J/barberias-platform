import { Controller, Get, Post, Body, Param, Patch, Query, ParseUUIDPipe, ParseArrayPipe } from '@nestjs/common';
import { HorarioService } from '../application/horario.service.js';
import { CreateHorarioDto } from '../application/dto/create-horario.dto.js';
import { CreateExcepcionHorarioDto } from '../application/dto/create-excepcion-horario.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

@Controller('barberias/:barberiaId/horarios')
export class HorarioController {
  constructor(private readonly horarioService: HorarioService) {}

  @Get()
  findSchedules(@Param('barberiaId', ParseUUIDPipe) barberiaId: string) {
    return this.horarioService.getSchedules(barberiaId);
  }

  @Post()
  configureSchedules(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body(new ParseArrayPipe({ items: CreateHorarioDto })) dto: CreateHorarioDto[],
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.configureSchedules(user.id, barberiaId, dto);
  }

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

  @Post('excepciones')
  addException(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CreateExcepcionHorarioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.addException(user.id, barberiaId, dto);
  }
}
