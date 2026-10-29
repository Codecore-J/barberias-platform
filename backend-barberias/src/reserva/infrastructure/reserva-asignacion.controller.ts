import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ReservaService } from '../application/reserva.service.js';
import { AsignarBarberoDto } from '../application/dto/asignar-barbero.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * V3 · Asignación de barbero a un turno existente.
 *
 * Vive en su propio controlador porque el contrato pedido
 * (`PATCH /reservas/:id/asignar-barbero`) NO lleva la sede en la ruta, a
 * diferencia del resto de `ReservaController`
 * (`/shops/:shopId/appointments/...`). Sin `:shopId`, `RolesGuard` solo filtra
 * por rol: la pertenencia a la sede de la reserva la exige
 * `ReservaService.asignarBarbero` (403 `RESERVA_AJENA`), que es donde se conoce
 * el `barberiaId` de la fila.
 *
 * Mismos roles que aceptar, rechazar o reprogramar (D02): asignar barbero es una
 * decisión de la SEDE, no del barbero que la recibe.
 */
@Controller('reservas')
export class ReservaAsignacionController {
  constructor(private readonly reservaService: ReservaService) {}

  @Patch(':id/asignar-barbero')
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  asignarBarbero(
    @Param('id', ParseUUIDPipe) reservaId: string,
    @Body() dto: AsignarBarberoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.reservaService.asignarBarbero(reservaId, dto, user);
  }
}
