import { Controller, Post, Get, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ReservaService } from '../application/reserva.service.js';
import { CreateReservaDto } from '../application/dto/create-reserva.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

@Controller('barberias/:barberiaId/reservas')
export class ReservaController {
  constructor(private readonly reservaService: ReservaService) {}

  @Post()
  crearReserva(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CreateReservaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.crearReserva(user.id, barberiaId, dto);
  }

  @Get(':id')
  obtenerDetalle(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
  ) {
    return this.reservaService.obtenerDetalleReserva(barberiaId, reservaId);
  }

  @Post(':id/inasistencia')
  marcarInasistencia(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.marcarInasistencia(barberiaId, reservaId, user.id);
  }
}
