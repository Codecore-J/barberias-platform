import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { PagoService } from '../application/pago.service.js';
import { RegistrarPagoDto } from '../application/dto/registrar-pago.dto.js';
import { AnularPagoDto } from '../application/dto/anular-pago.dto.js';
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
   *
   * E3-09: el BARBERO solo cobra las reservas que tiene asignadas; una reserva
   * sin barbero solo puede cobrarla el ADMIN_BARBERIA o el ADMINISTRADOR. La
   * comprobación vive en `PagoService.registrarPagoEnPersona`, porque necesita
   * la reserva concreta y el decorador solo ve el rol.
   */
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
   * GET /pagos/historial (alias /cobros/historial)
   *
   * H68 · el recibo de la sede: cada cobro con su estado VIVO (`PAGADA` o
   * `ANULADO`), su cliente, sus servicios con el precio histórico y quién lo
   * registró o lo anuló. Mismos roles y mismo criterio de sede que la auditoría
   * —la barbería sale de la ruta o de la cabecera `x-barberia-id`—, pero de otra
   * fuente: la tabla `pagos`, porque una anulación tiene que verse en el listado
   * y la auditoría es el rastro, no la vista.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get('historial')
  listarHistorial(
    @CurrentBarberiaIdOpcional() barberiaId: string | null,
    @CurrentUser() user: UsuarioAutenticado,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.pagoService.listarHistorial(
      user,
      barberiaId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  /**
   * POST /pagos/:id/anular (alias /cobros/:id/anular)
   *
   * H68 · §7.3: corrige un cobro anulándolo con motivo obligatorio. Es una
   * decisión de la SEDE, no del barbero: el rol que cobra no es el que deshace un
   * ingreso, y el servicio vuelve a comprobarlo con la sede del pago (el guard
   * solo ve el rol cuando la ruta no lleva `:barberiaId`).
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post(':id/anular')
  @HttpCode(HttpStatus.OK)
  anularPago(
    @Param('id') id: string,
    @CurrentBarberiaIdOpcional() barberiaId: string | null,
    @Body() dto: AnularPagoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.pagoService.anularPago(user.id, barberiaId, id, dto);
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
