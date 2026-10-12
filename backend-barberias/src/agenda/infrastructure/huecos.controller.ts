import { Controller, Get, Query } from '@nestjs/common';
import { DisponibilidadService } from '../application/disponibilidad.service.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * E4-02 · Carril A, segunda parte (§E4-02/2): los MISMOS huecos que devuelve el
 * error de una reserva fallida, consultables de forma proactiva.
 *
 * Ruta y política según el backlog: `GET /barberias/:barberiaId/disponibilidad/huecos`
 * para CLIENTE vinculado, ADMIN_BARBERIA y ADMINISTRADOR (no BARBERO: leer
 * huecos es consultar la capacidad de venta de la sede, no gestión de agenda).
 *
 * D37/H41 garantizado por diseño: el cálculo pasa por
 * `DisponibilidadService.buscarAlternativas`, que no acepta cliente
 * transaccional, así que aquí no hay transacción ni `FOR UPDATE`: es una
 * lectura pura que no retiene NADA de lo que sugiere.
 */
@Controller(['barberias/:barberiaId/disponibilidad', 'disponibilidad'])
export class HuecosController {
  constructor(private readonly disponibilidadService: DisponibilidadService) {}

  /**
   * `GET .../disponibilidad/huecos?fecha=&duracionMinutos=&participantes=`
   *
   * - `fecha` (opcional): etiqueta `YYYY-MM-DD`; sin ella se usa "hoy" en la
   *   zona de la sede (E2-04).
   * - `duracionMinutos` (opcional, 30): duración TOTAL del bloque, sin margen.
   *   El frontend la trae de `POST .../reservas/cotizar` (D44): nunca la calcula.
   * - `participantes` (opcional, 1): tamaño del grupo, que gobierna la puerta
   *   de capacidad D46 y añade el margen grupal (D42) al bloque.
   *
   * Con `configuracion_barberia.oportunidades_espacio_activas = false` la
   * respuesta sigue siendo 200 con `alternativas: []`: el contrato del endpoint
   * no depende de la configuración de cada tenant (E4-02/8, D22).
   */
  @Roles('CLIENTE', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get('huecos')
  async huecos(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Query('fecha') fecha?: string,
    @Query('duracionMinutos') duracionMinutos?: string,
    @Query('participantes') participantes?: string,
  ) {
    const duracion = duracionMinutos ? parseInt(duracionMinutos, 10) : 30;
    const personas = participantes ? parseInt(participantes, 10) : 1;

    const alternativas = await this.disponibilidadService.huecosDeLaSede(
      barberiaId,
      user.id,
      {
        fecha,
        duracionTotal: Number.isFinite(duracion) && duracion > 0 ? duracion : 30,
        participantes: Number.isFinite(personas) && personas > 0 ? personas : 1,
      },
    );

    return { barberiaId, fecha: fecha ?? null, alternativas };
  }
}
