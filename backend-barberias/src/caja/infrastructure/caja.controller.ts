import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CajaService } from '../application/caja.service.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * V3 fase 6 · caja diaria de la sede.
 *
 * La sede viaja como `?shopId=<uuid>` porque la ruta nace sin `:shopId`: el
 * contrato de la fase es `/api/v1/caja/hoy` y `/api/v1/caja/cierre`.
 * `CurrentBarberiaId` acepta el parámetro de consulta y responde 400 si falta o
 * no es un UUID, antes de tocar la base.
 *
 * `ADMIN_BARBERIA` y `ADMINISTRADOR`: el segundo es transversal por D05, y el
 * servicio vuelve a comprobar la sede concreta (un ADMIN_BARBERIA de otra sede no
 * entra aunque su rol sea correcto).
 */
@Controller('caja')
export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get('hoy')
  hoy(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.cajaService.hoy(user.id, barberiaId);
  }

  /**
   * `POST /caja/cierre` responde 201: nace un recurso (el arqueo). El 409 de
   * cierre duplicado es la única respuesta no-2xx esperada del flujo.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post('cierre')
  @HttpCode(HttpStatus.CREATED)
  cerrar(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.cajaService.cerrar(user.id, barberiaId);
  }
}
