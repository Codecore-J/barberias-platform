import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ClienteBarberiasService } from '../application/cliente-barberias.service.js';
import { BarberiaService } from '../application/barberia.service.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { UnirseBarberiaDto } from '../application/dto/unirse-barberia.dto.js';

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
 *
 * E3-12/2 (regla 1.10): se añade `POST /mi-estado/unirse`, la otra mitad de la
 * puerta de entrada. Su forma es la de su hermana `desvincular` —vive bajo
 * `mi-estado` y es `@Roles('CLIENTE')`— porque las dos son operaciones del
 * vínculo propio y las dos las decide el usuario del token.
 */
@Controller('mi-estado')
export class MiEstadoBarberiasController {
  constructor(
    private readonly clienteBarberiasService: ClienteBarberiasService,
    private readonly barberiaService: BarberiaService,
  ) {}

  @Roles('CLIENTE')
  @Get('barberias')
  listar(@CurrentUser() user: UsuarioAutenticado) {
    return this.clienteBarberiasService.listarSedesDelCliente(user.id);
  }

  /**
   * POST /mi-estado/unirse · E3-12/2 (regla 1.10)
   *
   * El cliente ENTRA: trae la invitación de una sede —el código que el staff le
   * dictó o el enlace único de su QR— y recibe su vínculo. No hay lógica de
   * vinculación nueva: se apoya en `BarberiaService.vincularCliente`, el mismo
   * camino blindado que usa `POST /barberias/vincular`, que es donde viven el
   * límite de D10 (la 6.ª nace `PENDIENTE_APROBACION`), la reapertura de H71
   * (D21) y su auditoría. Lo único que añade es poder nombrar la sede por su
   * enlace además de por su código.
   *
   * Responde 200 y no 201: `unirse` es un verbo de negocio sobre un vínculo —como
   * `aprobar`, `reactivar` o `desvincular`— y es idempotente, porque reintentar el
   * mismo código devuelve la MISMA fila en lugar de crear otra. Un 201 prometería
   * un recurso nuevo en cada llamada, y no es lo que pasa.
   */
  @Roles('CLIENTE')
  @Post('unirse')
  @HttpCode(HttpStatus.OK)
  unirse(@Body() dto: UnirseBarberiaDto, @CurrentUser() user: UsuarioAutenticado) {
    return this.barberiaService.vincularCliente(user.id, dto);
  }
}
