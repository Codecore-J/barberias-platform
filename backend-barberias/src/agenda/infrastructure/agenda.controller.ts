import { Controller, Post, Get, Delete, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { AgendaService } from '../application/agenda.service.js';
import { DisponibilidadService } from '../application/disponibilidad.service.js';
import { CreateBloqueoDto } from '../application/dto/create-bloqueo.dto.js';
import { ConsultarDisponibilidadDto } from '../application/dto/consultar-disponibilidad.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';

@Controller(['barberias/:barberiaId/agenda', 'agenda'])
export class AgendaController {
  constructor(
    private readonly agendaService: AgendaService,
    private readonly disponibilidadService: DisponibilidadService
  ) {}

  /**
   * GET /agenda/disponibilidad
   * Consultar disponibilidad es lectura de agenda: los cuatro roles (decisión 6).
   *
   * E1-06: el decorador fija la sede y el servicio comprueba que el solicitante
   * pertenece a ella. Antes bastaba con la cabecera `x-barberia-id` de otra sede.
   */
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get('disponibilidad')
  async consultarDisponibilidadGet(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Query('fecha') fecha: string,
    @Query('duracionMinutos') duracionMinutos?: string,
  ) {
    const duracion = duracionMinutos ? parseInt(duracionMinutos, 10) : 30;
    return this.disponibilidadService.calcularDisponibilidadDeSolicitante(
      {
        barberiaId,
        // E2-04: la etiqueta va tal cual; sin fecha, el servicio usa "hoy" en la
        // zona de la sede. Antes `new Date(fecha || new Date())` mezclaba una
        // etiqueta con el instante del servidor.
        fecha,
        duracionTotal: duracion,
        margenRequerido: 0,
      },
      user.id,
    );
  }

  /**
   * POST /agenda/bloqueos
   * Crear un bloqueo es escribir la agenda: ADMIN_BARBERIA de la barbería y
   * ADMINISTRADOR global. El BARBERO solo gestiona su propio horario.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post('bloqueos')
  crearBloqueo(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CreateBloqueoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.agendaService.crearBloqueo(user.id, barberiaId, dto);
  }

  // E1-03 · H20: un CLIENTE nunca lee bloqueos ni sus motivos; para su
  // disponibilidad usa `GET .../agenda/disponibilidad`.
  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @Get('bloqueos')
  obtenerBloqueos(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const fromDate = from ? new Date(from) : new Date();
    const toDate = to ? new Date(to) : new Date(new Date().setMonth(new Date().getMonth() + 1));
    return this.agendaService.obtenerBloqueos(user.id, barberiaId, fromDate, toDate);
  }

  /**
   * DELETE /agenda/bloqueos/:id
   * Misma política que la creación: el bloqueo pertenece a la barbería y solo
   * su ADMIN_BARBERIA o el ADMINISTRADOR global pueden retirarlo.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Delete('bloqueos/:id')
  eliminarBloqueo(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.agendaService.eliminarBloqueo(user.id, barberiaId, id);
  }

  /**
   * POST /agenda/disponibilidad
   * Mismo cálculo que el GET, con el cuerpo tipado. Los cuatro roles
   * (decisión 6).
   *
   * E1-06: misma comprobación de pertenencia que el GET. Además esta ruta leía
   * `params.barberiaId` con ParseUUIDPipe, que en el alias `/agenda/disponibilidad`
   * no existe y devolvía 400 por un id vacío; ahora la sede sale del decorador,
   * que es la misma cadena que usa el guard.
   */
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post('disponibilidad')
  async obtenerDisponibilidad(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Body() dto: ConsultarDisponibilidadDto,
  ) {
    return this.disponibilidadService.calcularDisponibilidadDeSolicitante(
      {
        barberiaId,
        fecha: dto.fecha,
        duracionTotal: dto.duracionTotal,
        margenRequerido: dto.margenRequerido ?? 0,
      },
      user.id,
    );
  }
}
