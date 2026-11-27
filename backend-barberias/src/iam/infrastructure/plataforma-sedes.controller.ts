import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UsuariosPlataformaService } from '../application/usuarios-plataforma.service.js';
import { TransferirAdministracionDto } from '../application/dto/transferir-administracion.dto.js';
import { CurrentUser } from './current-user.decorator.js';
import { Roles } from './roles.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';

/**
 * F7 / T-73 · transferencia de la administración de una sede.
 *
 * Vive aparte del controlador de usuarios porque la ruta es de SEDES, no de
 * cuentas: el ADMINISTRADOR global la usa cuando necesita eliminar al dueño
 * actual de un local y T-72 responde 409 `USUARIO_ES_ADMIN_SEDE`.
 *
 * Solo `ADMINISTRADOR` (D05). Responde 200: no crea una sede, cambia quién la
 * administra.
 */
@Controller('plataforma/sedes')
export class PlataformaSedesController {
  constructor(private readonly usuariosPlataformaService: UsuariosPlataformaService) {}

  /**
   * PATCH /plataforma/sedes/:sedeId/transferir-admin · `{ nuevoAdminId }`.
   *
   * El nuevo administrador debe ser una cuenta ACTIVA de la plataforma; si no
   * tiene vínculo en la sede, el servicio crea el `ADMIN_BARBERIA`. El anterior
   * queda con el vínculo `INACTIVO` (el backend no borra filas de rol) y el
   * evento `ADMIN_TRANSFERIDO` guarda a los dos.
   */
  @Patch(':sedeId/transferir-admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  transferirAdministracion(
    @Param('sedeId', ParseUUIDPipe) sedeId: string,
    @Body() dto: TransferirAdministracionDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.usuariosPlataformaService.transferirAdministracionSede(sedeId, dto, user);
  }
}
