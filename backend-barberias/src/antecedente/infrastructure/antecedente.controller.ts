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

@Controller('barberias/:barberiaId/antecedentes')
export class AntecedenteController {
  constructor(private readonly antecedenteService: AntecedenteService) {}

  @Post()
  crear(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CreateAntecedenteDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.crear(user.id, barberiaId, dto);
  }

  @Patch(':id/evaluar')
  evaluar(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('id', ParseUUIDPipe) antecedenteId: string,
    @Body() dto: EvaluarAntecedenteDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.evaluar(user.id, barberiaId, antecedenteId, dto);
  }

  @Get('pendientes')
  listarPendientes(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.listarPendientes(user.id, barberiaId);
  }

  @Get('cliente/:clienteId')
  listarPorCliente(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.listarPorCliente(user.id, barberiaId, clienteId);
  }
}
