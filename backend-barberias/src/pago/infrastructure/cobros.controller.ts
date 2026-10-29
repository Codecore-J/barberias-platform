import { Body, Controller, Post } from '@nestjs/common';
import { PagoService } from '../application/pago.service.js';
import { CobrarPagoDto } from '../application/dto/cobrar-pago.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * V3 fase 6 · el cobro del modal de agenda.
 *
 * Coexiste con `POST /shops/:shopId/payments` a propósito: aquel es la ruta
 * histórica de caja (y la que siguen llamando las pantallas existentes), este es
 * el contrato que nace de la agenda y que la fase pide. Los dos entran al MISMO
 * `PagoService.registrarPagoEnPersona`, así que las reglas —una sola vez por
 * reserva, método válido, monto igual al total, cita ya iniciada— no se pueden
 * desincronizar entre uno y otro.
 *
 * La sede no viaja aquí: el servicio la lee de la reserva. Un `barberiaId` de
 * cuerpo o query permitiría empujar el cobro a una sede ajena.
 */
@Controller('pagos')
export class CobrosController {
  constructor(private readonly pagoService: PagoService) {}

  @Roles('BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Post('cobrar')
  cobrar(@Body() dto: CobrarPagoDto, @CurrentUser() user: UsuarioAutenticado) {
    return this.pagoService.registrarPagoEnPersona(user.id, null, {
      reservaId: dto.reservaId,
      monto: dto.monto,
      metodoPago: dto.metodo,
    });
  }
}
