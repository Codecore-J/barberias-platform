import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { UsuariosPlataformaService } from '../application/usuarios-plataforma.service.js';
import { CambiarEstadoCuentaDto } from '../application/dto/cambiar-estado-cuenta.dto.js';
import { CurrentUser } from './current-user.decorator.js';
import { Roles } from './roles.decorator.js';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';

/**
 * E4-03/5 · D09/D24 · bandeja de plataforma para el estado de una cuenta.
 *
 * Solo el ADMINISTRADOR global (D05): ni la sede ni el barbero ni el cliente
 * pueden suspender una cuenta, y la penalización LOCAL de una sede jamás puede
 * llegar aquí (D48). El `RolesGuard` deniega al resto por fail-closed.
 *
 * Responde 200, no 201: no crea un recurso, cambia el estado de uno existente
 * (mismo criterio que `POST /barberias/:id/clientes/:clienteId/reactivar`).
 */
@Controller('plataforma/usuarios')
export class PlataformaUsuariosController {
  constructor(private readonly usuariosPlataformaService: UsuariosPlataformaService) {}

  /**
   * PATCH /plataforma/usuarios/:id/estado
   * `{ estadoCuenta: 'ACTIVO' | 'SUSPENDIDO', motivo }`. El motivo es obligatorio
   * (422 `MOTIVO_REQUERIDO`) y queda auditado junto al valor anterior y al nuevo.
   */
  @Roles('ADMINISTRADOR')
  @Patch(':id/estado')
  @HttpCode(HttpStatus.OK)
  cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarEstadoCuentaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.usuariosPlataformaService.cambiarEstado(id, user, dto);
  }
}
