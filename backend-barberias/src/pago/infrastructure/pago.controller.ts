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

@Controller('shops/:shopId/payments')
export class PagoController {
  constructor(private readonly pagoService: PagoService) {}

  /**
   * POST /shops/:shopId/payments
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
  @Post()
  registrarPagoEnPersona(
    @CurrentBarberiaId() barberiaId: string,
    @Body() dto: RegistrarPagoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.pagoService.registrarPagoEnPersona(user.id, barberiaId, dto);
  }

  /**
   * GET /shops/:shopId/payments/history
   *
   * H68 · el recibo de la sede: cada cobro con su estado VIVO (`PAGADA` o
   * `ANULADO`), su cliente, sus servicios con el precio histórico y quién lo
   * registró o lo anuló. Mismos roles y mismo criterio de sede que la auditoría
   * —la barbería sale de la ruta o de la cabecera `x-barberia-id`—, pero de otra
   * fuente: la tabla `pagos`, porque una anulación tiene que verse en el listado
   * y la auditoría es el rastro, no la vista.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get('history')
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
   * POST /shops/:shopId/payments/:id/void
   *
   * H68 · §7.3: corrige un cobro anulándolo con motivo obligatorio. Es una
   * decisión de la SEDE, no del barbero: el rol que cobra no es el que deshace un
   * ingreso, y el servicio vuelve a comprobarlo con la sede del pago (el guard
   * solo ve el rol cuando la ruta no lleva `:barberiaId`).
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post(':id/void')
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
   * GET /shops/:shopId/payments/audit
   * Auditoría de cobros: la lee el responsable de la barbería y el
   * ADMINISTRADOR global. El barbero ve sus cobros en la agenda, no la
   * auditoría.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get('audit')
  obtenerAuditoriaPagos(
    @CurrentBarberiaIdOpcional() barberiaId: string | null,
    @CurrentUser() user: UsuarioAutenticado,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    // Fase 5: la sede ya no viaja en cabecera; sale de la ruta
    // (`/shops/:shopId/payments/audit`) y, si la ruta es global, de la query.
    return this.pagoService.obtenerAuditoriaPagos(
      user,
      barberiaId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }
}
