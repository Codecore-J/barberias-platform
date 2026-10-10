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
import { RechazarReservaDto } from '../application/dto/rechazar-reserva.dto.js';
import { ReprogramarReservaDto } from '../application/dto/reprogramar-reserva.dto.js';
import { CancelacionEspecialDto } from '../application/dto/cancelacion-especial.dto.js';
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

  // E2-02: aquí vivía `PATCH /reservas/:id/estado`, un «pon el estado que
  // quieras» que escribía directo sobre `reservas.estado` sin comprobar el
  // grafo de §5.2 (H45). Se eliminó: los flujos de E3-03 a E3-08 son los caminos
  // válidos y cada uno trae sus condiciones (ventana de 30 min, motivo
  // obligatorio, bandera D17, revalidación del hueco), y el no presentado tiene
  // su propia ruta (`POST :id/inasistencia`). El único punto de escritura de
  // estado es ahora `ReservaService.cambiarEstado`, privado.

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
  @Post('walk-in')
  crearReservaWalkIn(
    @CurrentBarberiaId() barberiaId: string,
    @Body() dto: CreateReservaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.crearReserva(user.id, barberiaId, dto);
  }

  /**
   * POST /reservas/cotizar (D44): cotización sin persistir. Devuelve bloque total, hora de fin, margen, precio total y desglose de servicios. El cálculo es puro (E2-05) y no escribe en la base de datos.
   * Declara los cuatro roles: el CLIENTE consume la cotización como paso previo a su propia reserva; el wizard del cliente y el modal de walk-in comparten este mismo blanco.
   */
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post('cotizar')
  async cotizar(@CurrentBarberiaId() barberiaId: string, @Body() dto: CreateReservaDto) {
    return this.reservaService.cotizar(barberiaId, dto);
  }

  /**
   * POST /reservas/:id/aceptar (E3-04)
   * Confirmar una solicitud MANUAL: `PENDIENTE → CONFIRMADA`. Solo el responsable
   * de la sede y el ADMINISTRADOR global (la decisión D02 aplicada a aceptar).
   * El `RolesGuard` acota la ruta al `barberiaId` del parámetro, así que un
   * admin de otra sede recibe 403 antes de llegar al servicio.
   */
  @Post(':id/aceptar')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  aceptarReserva(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.aceptarReserva(barberiaId, reservaId, user);
  }

  /**
   * POST /reservas/:id/rechazar (E3-04)
   * `PENDIENTE → RECHAZADA` con `motivoCodigo` obligatorio del catálogo §5.5.
   * Mismos roles que aceptar.
   */
  @Post(':id/rechazar')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  rechazarReserva(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @Body() dto: RechazarReservaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.rechazarReserva(barberiaId, reservaId, dto, user);
  }

  /**
   * POST /reservas/:id/cancelar (E3-05)
   * Cancelación manual de una reserva vigente: `→ CANCELADA`. La declaran los
   * tres roles porque el CLIENTE dueño cancela lo suyo y la sede cancela por
   * teléfono o mostrador; la pertenencia de la reserva (que el guard no puede
   * ver) la valida el servicio, que exige que sea suya cuando no hay rol de
   * sede. Cancela el job de expiración y audita `RESERVA_CANCELADA`.
   */
  @Post(':id/cancelar')
  @Roles('CLIENTE', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  cancelarReserva(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.cancelarReserva(barberiaId, reservaId, user);
  }

  /**
   * PATCH /reservas/:id/reprogramar (E3-06)
   * Mover una reserva vigente a otro bloque horario: `→` mismo estado, nueva
   * fecha y rango. Es una decisión de la SEDE —igual que aceptar, rechazar o
   * marcar el no presentado— y no del barbero: el `RolesGuard` la acota al
   * `barberiaId` del parámetro, así que un admin de otra sede recibe 403 antes de
   * llegar al servicio. El CLIENTE no reprograma por su cuenta: la vía del cliente
   * es la propuesta de horario con sus 10 minutos de ventana (§5.4 / E3-06 del
   * backlog), que todavía no existe.
   */
  @Patch(':id/reprogramar')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  reprogramarReserva(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @Body() dto: ReprogramarReservaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.reprogramarReserva(barberiaId, reservaId, dto, user);
  }

  /**
   * POST /reservas/:id/cancelacion-especial (E3-08/D17)
   * Cancelación fuera de la ventana de los 30 minutos, resuelta por la SEDE con
   * motivo obligatorio del catálogo §5.5. Solo el responsable de la sede y el
   * ADMINISTRADOR global; el `RolesGuard` la acota al `barberiaId` del parámetro.
   */
  @Post(':id/cancelacion-especial')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  cancelacionEspecial(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @Body() dto: CancelacionEspecialDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.cancelacionEspecial(barberiaId, reservaId, dto, user);
  }

  /**
   * POST /reservas/:id/proponer-horario (E3-08/D18)
   * El CLIENTE dueño propone un bloque nuevo para su cita. No ocupa agenda: deja
   * una propuesta PENDIENTE con 10 minutos de ventana que la sede resuelve.
   */
  @Post(':id/proponer-horario')
  @Roles('CLIENTE')
  proponerHorario(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @Body() dto: ReprogramarReservaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.proponerHorario(barberiaId, reservaId, dto, user);
  }

  /**
   * POST /reservas/:id/propuesta-horario/aceptar (E3-08/D18)
   * La sede acepta la propuesta: mueve la cita tras revalidar el hueco bajo el
   * lock de la sede. Mismos roles que la reprogramación directa.
   */
  @Post(':id/propuesta-horario/aceptar')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  aceptarPropuestaHorario(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.aceptarPropuestaHorario(barberiaId, reservaId, user);
  }

  /**
   * POST /reservas/:id/propuesta-horario/rechazar (E3-08/D18)
   * La sede rechaza la propuesta sin mover la cita.
   */
  @Post(':id/propuesta-horario/rechazar')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  rechazarPropuestaHorario(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.rechazarPropuestaHorario(barberiaId, reservaId, user);
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

