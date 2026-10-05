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

  /**
   * GET /reservas/mis-reservas
   * Las reservas del propio cliente: el `clienteId` sale del token.
   */
  @Roles('CLIENTE')
  @Get('mis-reservas')
  obtenerMisReservas(@CurrentUser() user: UsuarioAutenticado) {
    return this.reservaService.obtenerMisReservas(user.id);
  }

  /**
   * PATCH /reservas/:id/estado
   * Cambiar el estado de una reserva queda restringido al responsable de la
   * barbería y al ADMINISTRADOR global (decisión 11): el no presentado es una
   * decisión de la sede, no del barbero.
   */
  @Patch(':id/estado')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  cambiarEstado(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @Body('estado') estado: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.cambiarEstado(barberiaId, reservaId, estado, user);
  }

  /**
   * POST /reservas
   * Crear reserva: los cuatro roles (decisión 10). El alias `/reservas` lo usan
   * tanto el wizard del cliente como el modal de walk-in de la pantalla de
   * agenda, de modo que restringirlo a CLIENTE dejaría sin walk-in a la
   * pantalla que más lo usa.
   */
  // TODO(E3-03): restringir a CLIENTE y crear una ruta aparte para el walk-in.
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
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

  /**
   * POST /reservas/:id/inasistencia
   * Marcar una reserva como no presentada (D02): del responsable de la sede y
   * del ADMINISTRADOR global.
   */
  @Post(':id/inasistencia')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  marcarInasistencia(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.marcarInasistencia(barberiaId, reservaId, user.id);
  }
}
