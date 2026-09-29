import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { PagoService } from '../application/pago.service.js';
import { RegistrarPagoDto } from '../application/dto/registrar-pago.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

@Controller('barberias/:barberiaId/pagos')
export class PagoController {
  constructor(private readonly pagoService: PagoService) {}

  @Post('en-persona')
  registrarPagoEnPersona(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: RegistrarPagoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.pagoService.registrarPagoEnPersona(user.id, barberiaId, dto);
  }

  @Get('auditoria')
  obtenerAuditoriaPagos(
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Query('limite') limite?: string,
    @Query('offset') offset?: string,
  ) {
    return this.pagoService.obtenerAuditoriaPagos(
      user.id,
      barberiaId,
      limite ? parseInt(limite, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }
}
