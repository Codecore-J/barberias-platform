import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { MiEstadoService } from '../application/mi-estado.service.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * E4-03/2 · H54 · `GET /barberias/:barberiaId/mi-estado`.
 *
 * La ruta usa `:barberiaId` (no `:id`) a propósito: así el `RolesGuard` SÍ
 * resuelve la sede del parámetro y un cliente de otra sede no puede preguntar
 * por la de al lado. Aun así el servicio vuelve a acotar por `barberiaId` y por
 * el usuario del token, porque el estado es de UNA persona en UNA sede (D48).
 *
 * Solo el CLIENTE: quien gestiona la lista de restringidos es el staff y ya
 * tiene su propia bandeja (`GET /barberias/:id/clientes-restringidos`, E4-03).
 * El ADMINISTRADOR global pasa por jerarquía (E1-04), igual que en el resto de
 * la API.
 *
 * E3-12/3: la desvinculación voluntaria vive aquí, y no en un
 * `POST /barberias/:id/desvincular` suelto, por la misma razón: `:barberiaId`
 * deja que el `RolesGuard` acote la sede del parámetro y el `@Roles('CLIENTE')`
 * que solo el cliente cierre SU vínculo. El servicio vuelve a acotar por el
 * usuario del token, que es lo que impide cerrar el vínculo de otro.
 */
@Controller('barberias/:barberiaId/mi-estado')
export class MiEstadoController {
  constructor(private readonly miEstadoService: MiEstadoService) {}

  @Roles('CLIENTE')
  @Get()
  obtener(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.miEstadoService.obtener(barberiaId, user);
  }

  /**
   * POST /barberias/:barberiaId/mi-estado/desvincular
   * El cliente cierra su propio vínculo: la fila pasa a `DESVINCULADO`
   * conservando historial y penalización (D20/D21) y el evento queda auditado.
   * Responde 200: no crea un recurso, cambia el estado del vínculo (mismo
   * criterio que aprobar/rechazar de E3-12 y el perdón de E4-03).
   */
  @Roles('CLIENTE')
  @Post('desvincular')
  @HttpCode(HttpStatus.OK)
  desvincular(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.miEstadoService.desvincular(barberiaId, user);
  }
}
