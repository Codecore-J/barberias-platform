import { Controller, Get, Post, Query } from '@nestjs/common';
import { AuditoriaService } from '../application/auditoria.service.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly auditoriaService: AuditoriaService) {}

  @Get('estadisticas')
  @Roles('SUPER_ADMIN', 'ADMINISTRADOR')
  obtenerEstadisticas() {
    return this.auditoriaService.obtenerEstadisticas();
  }

  @Get()
  @Roles('SUPER_ADMIN', 'ADMINISTRADOR', 'ADMIN_BARBERIA')
  consultarAuditorias(
    @CurrentUser() user: UsuarioAutenticado,
    @Query('entidad') entidad?: string,
    @Query('entidadId') entidadId?: string,
    @Query('accion') accion?: string,
    @Query('usuarioId') usuarioId?: string,
    @Query('barberiaId') barberiaId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    // E1-02: el servicio decide la barbería según el usuario; un
    // ADMIN_BARBERIA sin barberiaId recibe 400 y nunca un `where` vacío.
    return this.auditoriaService.consultarAuditorias(
      {
        entidad,
        entidadId,
        accion,
        usuarioId,
        barberiaId,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 50,
      },
      user,
    );
  }

  @Post('purgar')
  @Roles('SUPER_ADMIN', 'ADMINISTRADOR')
  ejecutarPurgaManual(@Query('dias') dias?: string) {
    const diasNum = dias ? parseInt(dias, 10) : 365;
    return this.auditoriaService.purgarAuditoriasAntiguas(diasNum);
  }
}