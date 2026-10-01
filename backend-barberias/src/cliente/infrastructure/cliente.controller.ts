import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Headers, UnauthorizedException } from '@nestjs/common';
import { ClienteService } from '../application/cliente.service.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';

@Controller('clientes')
export class ClienteController {
  constructor(private readonly clienteService: ClienteService) {}

  @Get(':id/ficha')
  @Roles('BARBERO', 'ADMIN')
  obtenerFicha(
    @Param('id', ParseUUIDPipe) clienteId: string,
    @Headers('x-barberia-id') barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado
  ) {
    if (!barberiaId) throw new UnauthorizedException('x-barberia-id es requerido');
    return this.clienteService.obtenerFicha(clienteId, barberiaId);
  }

  @Post(':id/notas')
  @Roles('BARBERO', 'ADMIN')
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
