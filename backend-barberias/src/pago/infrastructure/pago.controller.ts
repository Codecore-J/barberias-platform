import {
  Controller,
  Post,
  Body,
  Param,
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
}
