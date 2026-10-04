import {
  Controller,
  Post,
  Get,
  Body,
  Query,
} from '@nestjs/common';
import { PagoService } from '../application/pago.service.js';
import { RegistrarPagoDto } from '../application/dto/registrar-pago.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Autenticado } from '../../iam/infrastructure/autenticado.decorator.js';

@Controller(['barberias/:barberiaId/pagos', 'cobros', 'pagos'])
export class PagoController {
  constructor(private readonly pagoService: PagoService) {}

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Post(['en-persona', ''])
  registrarPagoEnPersona(
    @CurrentBarberiaId() barberiaId: string,
    @Body() dto: RegistrarPagoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.pagoService.registrarPagoEnPersona(user.id, barberiaId, dto);
  }

  // TODO(E1-05): E1-05 sustituye @Autenticado por el rol o decorador real.
  @Autenticado()
  @Get('auditoria')
  obtenerAuditoriaPagos(
    @CurrentBarberiaId() barberiaId: string,
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
