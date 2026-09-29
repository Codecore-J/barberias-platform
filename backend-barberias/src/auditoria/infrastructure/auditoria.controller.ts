import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuditoriaService } from '../application/auditoria.service.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { RolesGuard } from '../../iam/infrastructure/roles.guard.js';

@Controller('auditoria')
@UseGuards(RolesGuard)
export class AuditoriaController {
  constructor(private readonly auditoriaService: AuditoriaService) {}

  @Get('estadisticas')
  @Roles('SUPER_ADMIN', 'ADMINISTRADOR')
  obtenerEstadisticas() {
    return this.auditoriaService.obtenerEstadisticas();
  }

  @Post('purgar')
  @Roles('SUPER_ADMIN', 'ADMINISTRADOR')
  ejecutarPurgaManual(@Query('dias') dias?: string) {
    const diasNum = dias ? parseInt(dias, 10) : 365;
    return this.auditoriaService.purgarAuditoriasAntiguas(diasNum);
  }
}
