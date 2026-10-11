import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ConfiguracionBarberiaService } from '../application/configuracion-barberia.service.js';
import { ConfiguracionBarberiaDto } from '../application/dto/configuracion-barberia.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

@Controller('barberias')
export class ConfiguracionBarberiaController {
  constructor(
    private readonly configuracionService: ConfiguracionBarberiaService,
  ) {}

  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get(':barberiaId/configuracion')
  async configuracion(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    // Solo ADMIN_BARBERIA de esa barbería o ADMINISTRADOR global.
    const esGlobal = user?.roles?.includes('ADMINISTRADOR') ?? false;

    if (!esGlobal) {
      const esAdminDeEsta =
        user?.rolesDetallados?.some(
          (rol) =>
            rol.nombre === 'ADMIN_BARBERIA' &&
            (rol.barberiaId === barberiaId || !rol.barberiaId),
        ) ?? false;

      if (!esAdminDeEsta) {
        throw new ForbiddenException(
          'No tienes permisos para ver la configuración de esta barbería.',
        );
      }
    }

    return this.configuracionService.getConfiguracion(barberiaId);
  }

  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Patch(':barberiaId/configuracion')
  async actualizarConfiguracion(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: ConfiguracionBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    // Mismo criterio de acceso que GET.
    const esGlobal = user?.roles?.includes('ADMINISTRADOR') ?? false;

    if (!esGlobal) {
      const esAdminDeEsta =
        user?.rolesDetallados?.some(
          (rol) =>
            rol.nombre === 'ADMIN_BARBERIA' &&
            (rol.barberiaId === barberiaId || !rol.barberiaId),
        ) ?? false;

      if (!esAdminDeEsta) {
        throw new ForbiddenException(
          'No tienes permisos para modificar la configuración de esta barbería.',
        );
      }
    }

    return this.configuracionService.actualizarConfiguracion(barberiaId, dto, user);
  }
}
