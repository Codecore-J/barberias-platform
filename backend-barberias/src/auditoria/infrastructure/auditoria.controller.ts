import { Controller, Get, Post, Query } from '@nestjs/common';
import { AuditoriaService } from '../application/auditoria.service.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';

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
    @Query('entidad') entidad?: string,
    @Query('entidadId') entidadId?: string,
    @Query('accion') accion?: string,
    @Query('usuarioId') usuarioId?: string,
    @Query('barberiaId') barberiaId?: string,
    @Query('limite') limite?: string,
    @Query('offset') offset?: string,
  ) {
    return this.auditoriaService.consultarAuditorias({
      entidad,
      entidadId,
      accion,
      usuarioId,
      barberiaId,
      limite: limite ? parseInt(limite, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Post('purgar')
  @Roles('SUPER_ADMIN', 'ADMINISTRADOR')
  ejecutarPurgaManual(@Query('dias') dias?: string) {
    const diasNum = dias ? parseInt(dias, 10) : 365;
    return this.auditoriaService.purgarAuditoriasAntiguas(diasNum);
  }
}
