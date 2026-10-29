import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { HorarioService } from '../application/horario.service.js';
import { ConfigurarMiHorarioDto } from '../application/dto/configurar-mi-horario.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * V3 fase 5 · semana laboral propia del BARBERO.
 *
 * Vive en su propio controlador porque su contrato es otro que el de
 * `/hours/mine` (que recibe solo rangos sueltos): aquí se envía LA SEMANA, con
 * días libres y descansos, y el `PUT` reemplaza lo anterior en una transacción.
 *
 * El `barberoId` NUNCA viaja en la ruta ni en el cuerpo: sale del JWT. Aceptarlo
 * del cliente permitiría escribir el horario de un compañero.
 */
@Controller('shops/:shopId/mi-horario')
export class HorarioBarberoController {
  constructor(private readonly horarioService: HorarioService) {}

  /** GET · la semana del barbero autenticado, con los siete días. */
  @Roles('BARBERO')
  @UseGuards(VinculoBarberiaGuard)
  @Get()
  obtener(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.getMiHorario(user.id, barberiaId);
  }

  /**
   * PUT · guarda la semana completa (días libres incluidos).
   *
   * Es `PUT` y no `POST` porque reemplaza la semana entera: repetir la misma
   * petición deja exactamente el mismo estado, sin filas duplicadas.
   */
  @Roles('BARBERO')
  @UseGuards(VinculoBarberiaGuard)
  @Put()
  guardar(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: ConfigurarMiHorarioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.configurarMiHorario(user.id, barberiaId, dto);
  }
}
