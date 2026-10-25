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
 * Las rutas usan `:shopId`, así que el `RolesGuard` acota la sede desde el
 * parámetro; aun así la pertenencia real la vuelve a comprobar el
 * servicio (403), igual que en `POST /shops/:shopId/change-requests` de
 * E3-13. Sin `@Roles` la ruta quedaría abierta a cualquier autenticado, que es
 * lo que el principio de seguridad «fail-closed» prohíbe.
 */
@Controller('shops/:shopId/restricted-clients')
export class ClientesRestringidosController {
  constructor(private readonly clientesRestringidosService: ClientesRestringidosService) {}

  /**
   * GET /shops/:shopId/restricted-clients
   * Lista negra LOCAL de esa sede: contador de inasistencias y motivo.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get()
  listar(
    @Param('shopId', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.clientesRestringidosService.listar(id, user);
  }

  /**
   * POST /shops/:shopId/restricted-clients/:clientId/reactivate
   * Levanta la restricción de esa sede y reinicia su contador (auditado).
   * Responde 200: no crea un recurso, resuelve una restricción.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post(':clientId/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivar(
    @Param('shopId', ParseUUIDPipe) id: string,
    @Param('clientId', ParseUUIDPipe) clienteId: string,
    @Body() dto: ReactivarClienteDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.clientesRestringidosService.reactivar(id, clienteId, user, dto.motivo);
  }
}
