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
import { Autenticado } from '../../iam/infrastructure/autenticado.decorator.js';

@Controller('barberias/:barberiaId/antecedentes')
export class AntecedenteController {
  constructor(private readonly antecedenteService: AntecedenteService) {}

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Post()
  crear(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: CreateAntecedenteDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.crear(user.id, barberiaId, dto);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Patch(':id/evaluar')
  evaluar(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('id', ParseUUIDPipe) antecedenteId: string,
    @Body() dto: EvaluarAntecedenteDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.evaluar(user.id, barberiaId, antecedenteId, dto);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Get('pendientes')
  listarPendientes(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.listarPendientes(user.id, barberiaId);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Get('cliente/:clienteId')
  listarPorCliente(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.antecedenteService.listarPorCliente(user.id, barberiaId, clienteId);
  }
}
