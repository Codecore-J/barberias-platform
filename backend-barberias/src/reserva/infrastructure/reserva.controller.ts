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
   * Crear reserva desde el wizard del cliente (decisión 10 + E3-03).
   * Hasta E3-03 este alias lo compartía el walk-in de la pantalla de agenda,
   * y por eso declaraba los cuatro roles; con la ruta walk-in separada, el
   * alias vuelve a lo que es: la reserva del propio CLIENTE.
   */
  @Roles('CLIENTE')
  @Post()
  crearReserva(
    @CurrentBarberiaId() barberiaId: string,
    @Body() dto: CreateReservaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.crearReserva(user.id, barberiaId, dto);
  }

  /**
   * POST /reservas/walk-in
   * Turno manual para un cliente sin app, creado desde la pantalla de agenda
   * (E3-03). Es el mismo servicio que el wizard, pero la ruta es aparte porque
   * el caminante SIEMPRE lleva barbero asignado (`walk-in-modal.component.ts`
   * lo exige en su formulario) y quien lo crea es el staff de la sede, nunca
   * un cliente. El decorador separa lo que hasta E3-03 eran dos pantallas
   * compartiendo UNA sola ruta con los cuatro roles.
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  /**
   * POST /reservas/cotizar (D44): cotización sin persistir. Devuelve bloque total, hora de fin, margen, precio total y desglose de servicios. El cálculo es puro (E2-05) y no escribe en la base de datos.
   */
  @Post('cotizar')
  async cotizar(@CurrentBarberiaId() barberiaId: string, @Body() dto: CreateReservaDto) {
    return this.reservaService.cotizar(barberiaId, dto);
  }
  @Post('walk-in')
  crearReservaWalkIn(
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

