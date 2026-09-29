import { Controller, Get } from '@nestjs/common';
import { NotificacionService } from '../application/notificacion.service.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

@Controller('notificaciones')
export class NotificacionController {
  constructor(private readonly notificacionService: NotificacionService) {}

  @Get('mis-notificaciones')
  obtenerMisNotificaciones(@CurrentUser() user: UsuarioAutenticado) {
    return this.notificacionService.listarNotificacionesUsuario(user.id);
  }
}
