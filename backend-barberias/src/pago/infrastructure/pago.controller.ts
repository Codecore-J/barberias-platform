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
    @CurrentBarberiaId() barberiaId: string | null,
    @CurrentUser() user: UsuarioAutenticado,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    // E1-02: mismo criterio que GET /auditoria. La barbería sale de la ruta
    // (alias `barberias/:barberiaId/pagos`) o de la cabecera x-barberia-id;
    // sin ella y sin ADMINISTRADOR, la respuesta es 400.
    return this.pagoService.obtenerAuditoriaPagos(
      user,
      barberiaId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }
}
