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
import { CurrentBarberiaId, CurrentBarberiaIdOpcional } from '../../iam/infrastructure/current-barberia.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';

@Controller(['barberias/:barberiaId/pagos', 'cobros', 'pagos'])
export class PagoController {
  constructor(private readonly pagoService: PagoService) {}

  /**
   * POST /pagos (alias /cobros)
   * Registrar atención y pago: BARBERO, ADMIN_BARBERIA y ADMINISTRADOR
   * (decisión 9). Lo usa el modal de cobro de la pantalla de agenda, que
   * comparten el barbero y el responsable.
   */
  // TODO(E3-09): un BARBERO solo puede cobrar reservas que tenga asignadas.
  @Roles('BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post(['en-persona', ''])
  registrarPagoEnPersona(
    @CurrentBarberiaId() barberiaId: string,
    @Body() dto: RegistrarPagoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.pagoService.registrarPagoEnPersona(user.id, barberiaId, dto);
  }

  /**
   * GET /pagos/auditoria (alias /cobros/auditoria)
   * Auditoría de cobros: la lee el responsable de la barbería y el
   * ADMINISTRADOR global. El barbero ve sus cobros en la agenda, no la
   * auditoría.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get('auditoria')
  obtenerAuditoriaPagos(
    @CurrentBarberiaIdOpcional() barberiaId: string | null,
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
