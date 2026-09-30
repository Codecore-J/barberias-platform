import { Controller, Post, Get, Delete, Param, Body, Query, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { AgendaService } from '../application/agenda.service.js';
import { DisponibilidadService } from '../application/disponibilidad.service.js';
import { CreateBloqueoDto } from '../application/dto/create-bloqueo.dto.js';
import { ConsultarDisponibilidadDto } from '../application/dto/consultar-disponibilidad.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

@Controller(['barberias/:barberiaId/agenda', 'agenda'])
export class AgendaController {
  constructor(
    private readonly agendaService: AgendaService,
    private readonly disponibilidadService: DisponibilidadService
  ) {}

  @Get('disponibilidad')
  async consultarDisponibilidadGet(
    @CurrentBarberiaId() barberiaId: string,
    @Query('fecha') fecha: string,
    @Query('duracionMinutos') duracionMinutos?: string,
  ) {
    if (!barberiaId) {
      throw new BadRequestException('ID de barbería es requerido');
    }
    const duracion = duracionMinutos ? parseInt(duracionMinutos, 10) : 30;
    return this.disponibilidadService.calcularDisponibilidad({
      barberiaId,
      fecha: new Date(fecha || new Date()),
      duracionTotal: duracion,
      margenRequerido: 0,
    });
  }

  @Post('bloqueos')
  crearBloqueo(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CreateBloqueoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.agendaService.crearBloqueo(user.id, barberiaId, dto);
  }

  @Get('bloqueos')
  obtenerBloqueos(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const fromDate = from ? new Date(from) : new Date();
    const toDate = to ? new Date(to) : new Date(new Date().setMonth(new Date().getMonth() + 1));
    return this.agendaService.obtenerBloqueos(barberiaId, fromDate, toDate);
  }

  @Delete('bloqueos/:id')
  eliminarBloqueo(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.agendaService.eliminarBloqueo(user.id, barberiaId, id);
  }

  @Post('disponibilidad')
  async obtenerDisponibilidad(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: ConsultarDisponibilidadDto,
  ) {
    return this.disponibilidadService.calcularDisponibilidad({
      barberiaId,
      fecha: new Date(dto.fecha),
      duracionTotal: dto.duracionTotal,
      margenRequerido: dto.margenRequerido ?? 0,
    });
  }
}
