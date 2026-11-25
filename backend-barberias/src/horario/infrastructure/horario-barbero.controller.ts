import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { HorarioService } from '../application/horario.service.js';
import { ConfigurarMiHorarioDto } from '../application/dto/configurar-mi-horario.dto.js';
import { GuardarPlantillaBaseDto } from '../application/dto/plantilla-base-barbero.dto.js';
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

  /**
   * GET · la semana del barbero autenticado, con los siete días.
   *
   * T-11 (23 nov 2026): la lectura acompaña a la escritura. Quien puede guardar
   * su semana (`PUT`, dual) puede leerla; el `barberoId` sale del JWT en las
   * dos, así que el ADMIN_BARBERIA no abre la semana de un compañero ni el
   * ADMINISTRADOR global gana una vía que la matriz no le da.
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA')
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
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  @UseGuards(VinculoBarberiaGuard)
  @Put()
  guardar(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: ConfigurarMiHorarioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.configurarMiHorario(user.id, barberiaId, dto);
  }

  /**
   * GET · plantilla semanal BASE del barbero (la que se repite cada semana).
   *
   * Es global —no cuelga de una sede—, pero se sirve bajo `shops/:shopId`
   * porque el acceso lo autoriza el vínculo con la sede: quien la lee es el
   * barbero autenticado, nunca un id que llegue del cliente.
   *
   * T-11 (23 nov 2026): la lectura acompaña a la escritura, igual que en la
   * semana propia. Quien puede guardar su plantilla (`PUT base`, dual) puede
   * leerla; el `barberoId` sale del JWT, así que el ADMIN_BARBERIA no abre la
   * plantilla de un compañero ni el ADMINISTRADOR global gana una vía nueva.
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  @UseGuards(VinculoBarberiaGuard)
  @Get('base')
  obtenerPlantilla(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.obtenerPlantillaBase(user.id, barberiaId);
  }

  /**
   * PUT · F4-03: PROPONE la plantilla base, ya no la escribe.
   *
   * La decisión 9 del dueño separó proponer de aplicar: el cuerpo sigue siendo
   * el mismo (solo los días que cambian, un día puede apagarse con `activo:
   * false` sin perder sus horas), pero ahora deja una propuesta `PENDIENTE` de
   * ESA sede que el ADMIN_BARBERIA resuelve. La plantilla vigente no cambia.
   */
  @Roles('BARBERO', 'ADMIN_BARBERIA')
  @UseGuards(VinculoBarberiaGuard)
  @Put('base')
  guardarPlantilla(
    @Param('shopId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: GuardarPlantillaBaseDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.horarioService.guardarPlantillaBase(user.id, barberiaId, dto);
  }
}
