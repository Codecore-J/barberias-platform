import { Controller, Get } from '@nestjs/common';
import { ClienteBarberiasService } from '../application/cliente-barberias.service.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * H72 · `GET /mi-estado/barberias` — las sedes PROPIAS del CLIENTE.
 *
 * La ruta es hermana de `GET /barberias/:barberiaId/mi-estado` (H54) y
 * deliberadamente NO cuelga de `/barberias`: esa ruta base ya significa «las
 * sedes donde YO SOY responsable» (`findAllByResponsable`, E1-07), y colgar ahí
 * un listado con otro criterio haría que la misma URL dijera dos cosas según el
 * rol. `mi-estado` es el espacio de lo que el usuario ve de SÍ MISMO, y aquí
 * «mis barberías» es lo que su vínculo de cliente le da.
 *
 * Sin `:barberiaId`: no hay sede en el parámetro que acotar, así que el
 * `RolesGuard` solo filtra el rol y el acotado real por usuario del token lo
 * hace el servicio (nunca los vínculos de otro). `@Roles('CLIENTE')` y no
 * `@Autenticado` porque es la bandeja del vínculo de cliente: el staff tiene sus
 * propios listados (responsable para el ADMIN_BARBERIA, roles para el BARBERO) y
 * el ADMINISTRADOR pasa por jerarquía (E1-04).
 */
@Controller('mi-estado')
export class MiEstadoBarberiasController {
  constructor(private readonly clienteBarberiasService: ClienteBarberiasService) {}

  @Roles('CLIENTE')
  @Get('barberias')
  listar(@CurrentUser() user: UsuarioAutenticado) {
    return this.clienteBarberiasService.listarSedesDelCliente(user.id);
  }
}
