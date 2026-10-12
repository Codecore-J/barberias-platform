import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ClientesRestringidosService } from '../application/clientes-restringidos.service.js';
import { ReactivarClienteDto } from '../application/dto/reactivar-cliente.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * E4-03 · bandeja de la SEDE para su propia lista de restringidos (D48).
 *
 * Las rutas usan `:id` (no `:barberiaId`), así que el `RolesGuard` solo filtra
 * el ROL y no puede acotar la sede: la pertenencia real la comprueba el
 * servicio (403), igual que en `POST /barberias/:id/solicitudes-cambio` de
 * E3-13. Sin `@Roles` la ruta quedaría abierta a cualquier autenticado, que es
 * lo que el principio de seguridad «fail-closed» prohíbe.
 */
@Controller('barberias')
export class ClientesRestringidosController {
  constructor(private readonly clientesRestringidosService: ClientesRestringidosService) {}

  /**
   * GET /barberias/:id/clientes-restringidos
   * Lista negra LOCAL de esa sede: contador de inasistencias y motivo.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get(':id/clientes-restringidos')
  listar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.clientesRestringidosService.listar(id, user);
  }

  /**
   * POST /barberias/:id/clientes/:clienteId/reactivar
   * Levanta la restricción de esa sede y reinicia su contador (auditado).
   * Responde 200: no crea un recurso, resuelve una restricción.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post(':id/clientes/:clienteId/reactivar')
  @HttpCode(HttpStatus.OK)
  reactivar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @Body() dto: ReactivarClienteDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.clientesRestringidosService.reactivar(id, clienteId, user, dto.motivo);
  }
}
