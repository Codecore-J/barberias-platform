import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Headers, UnauthorizedException } from '@nestjs/common';
import { ClienteService } from '../application/cliente.service.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';

@Controller('clientes')
export class ClienteController {
  constructor(private readonly clienteService: ClienteService) {}

  @Get(':id/ficha')
  // `ADMIN` no existe en el catálogo de roles: quien lo tuviera no podría
  // autenticarse nunca. El ADMIN_BARBERIA de la sede es quien gestiona a sus
  // clientes, así que es el rol que corresponde aquí.
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  obtenerFicha(
    @Param('id', ParseUUIDPipe) clienteId: string,
    @Headers('x-barberia-id') barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado
  ) {
    if (!barberiaId) throw new UnauthorizedException('x-barberia-id es requerido');
    return this.clienteService.obtenerFicha(clienteId, barberiaId);
  }

  @Post(':id/notas')
  // Misma política que la ficha, y por el mismo motivo: `ADMIN` no es un rol del
  // catálogo y dejaba fuera al ADMIN_BARBERIA con un 403 sin querer.
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  guardarNota(
    @Param('id', ParseUUIDPipe) clienteId: string,
    @Headers('x-barberia-id') barberiaId: string,
    @Body('contenido') contenido: string,
    @CurrentUser() user: UsuarioAutenticado
  ) {
    if (!barberiaId) throw new UnauthorizedException('x-barberia-id es requerido');
    return this.clienteService.guardarNota(clienteId, barberiaId, user.id, contenido);
  }
}
