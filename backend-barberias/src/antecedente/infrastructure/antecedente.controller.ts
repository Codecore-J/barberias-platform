import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AntecedenteService } from '../application/antecedente.service.js';
import { CreateAntecedenteDto } from '../application/dto/create-antecedente.dto.js';
import { EvaluarAntecedenteDto } from '../application/dto/evaluar-antecedente.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';

@Controller('barberias/:barberiaId/antecedentes')
export class AntecedenteController {
  constructor(private readonly antecedenteService: AntecedenteService) {}

  /**
   * POST /antecedentes
   * Proponer un antecedente sobre otro usuario es tarea del personal de la
   * barbería (decisión 7). La declaración propia del cliente (D43) necesita su
   * propia ruta y su campo de origen, y no se implementa en E1-05.
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post()
  crear(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CreateAntecedenteDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.crear(user.id, barberiaId, dto);
  }

  /**
   * PATCH /antecedentes/:id/evaluar
   * Evaluar la cola de antecedentes es del responsable de la barbería (D35).
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Patch(':id/evaluar')
  evaluar(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('id', ParseUUIDPipe) antecedenteId: string,
    @Body() dto: EvaluarAntecedenteDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.evaluar(user.id, barberiaId, antecedenteId, dto);
  }

  /**
   * GET /antecedentes/pendientes
   * Cola de evaluación: la lee quien puede evaluar (D35).
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get('pendientes')
  listarPendientes(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.listarPendientes(user.id, barberiaId);
  }

  /**
   * GET /antecedentes/cliente/:clienteId
   * Ficha de antecedentes de un cliente: datos de historial, los lee el
   * responsable de la barbería y el ADMINISTRADOR global (decisión 7).
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get('cliente/:clienteId')
  listarPorCliente(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.listarPorCliente(user.id, barberiaId, clienteId);
  }
}
