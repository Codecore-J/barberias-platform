import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ReservaService } from '../application/reserva.service.js';
import { CreateReservaDto } from '../application/dto/create-reserva.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Autenticado } from '../../iam/infrastructure/autenticado.decorator.js';

@Controller(['barberias/:barberiaId/reservas', 'reservas'])
export class ReservaController {
  constructor(private readonly reservaService: ReservaService) {}

  @Get('agenda')
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'ADMINISTRADOR')
  obtenerAgenda(
    @CurrentBarberiaId() barberiaId: string,
    @Query('fecha') fecha: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const fechaFiltro = fecha || new Date().toISOString().split('T')[0];
    return this.reservaService.obtenerAgendaDiaria(barberiaId, fechaFiltro, user);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Get('mis-reservas')
  obtenerMisReservas(@CurrentUser() user: UsuarioAutenticado) {
    return this.reservaService.obtenerMisReservas(user.id);
  }

  @Patch(':id/estado')
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'ADMINISTRADOR')
  cambiarEstado(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @Body('estado') estado: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.cambiarEstado(barberiaId, reservaId, estado, user);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Post()
  crearReserva(
    @CurrentBarberiaId() barberiaId: string,
    @Body() dto: CreateReservaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.crearReserva(user.id, barberiaId, dto);
  }

  @Get(':id')
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'CLIENTE') // SEC-E2: requiere rol en la barbería del parámetro
  obtenerDetalle(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.obtenerDetalleReserva(barberiaId, reservaId, user);
  }

  @Post(':id/inasistencia')
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'ADMINISTRADOR')
  marcarInasistencia(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.marcarInasistencia(barberiaId, reservaId, user.id);
  }
}
