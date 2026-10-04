import { Controller, Get } from '@nestjs/common';
import { NotificacionService } from '../application/notificacion.service.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Autenticado } from '../../iam/infrastructure/autenticado.decorator.js';

@Controller('notificaciones')
export class NotificacionController {
  constructor(private readonly notificacionService: NotificacionService) {}

  /**
   * GET /notificaciones/mis-notificaciones
   * E1-05: `@Autenticado` es aquí la política definitiva. La ruta devuelve las
   * notificaciones del propio solicitante, así que no hay rol que exigir.
   */
  @Autenticado()
  @Get('mis-notificaciones')
  obtenerMisNotificaciones(@CurrentUser() user: UsuarioAutenticado) {
    return this.notificacionService.listarNotificacionesUsuario(user.id);
  }
}
