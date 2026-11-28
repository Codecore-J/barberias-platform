import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsuariosPlataformaService } from '../application/usuarios-plataforma.service.js';
import { CambiarEstadoCuentaDto } from '../application/dto/cambiar-estado-cuenta.dto.js';
import { AdministradorCuentaDto } from '../application/dto/administrador-cuenta.dto.js';
import { CrearUsuarioPlataformaDto } from '../application/dto/crear-usuario-plataforma.dto.js';
import { EliminarUsuarioDto } from '../application/dto/eliminar-usuario.dto.js';
import { ListarUsuariosDto } from '../application/dto/listar-usuarios.dto.js';
import { CurrentUser } from './current-user.decorator.js';
import { Roles } from './roles.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import type { UsuarioAutenticado } from '../domain/jwt.interface.js';
import type { UsuarioListResponseDto } from '../application/dto/usuario-list-response.dto.js';
import type { UsuariosPaginadosDto } from '../application/dto/usuarios-paginados-response.dto.js';
import type { UsuarioAuditoriaResponseDto } from '../application/dto/usuario-auditoria-response.dto.js';

/**
 * E4-03/5 · D09/D24 · bandeja de plataforma para el estado de una cuenta.
 *
 * Solo el ADMINISTRADOR global (D05): ni la sede ni el barbero ni el cliente
 * pueden suspender una cuenta, y la penalización LOCAL de una sede jamás puede
 * llegar aquí (D48). El `RolesGuard` deniega al resto por fail-closed.
 *
 * Responde 200, no 201: no crea un recurso, cambia el estado de uno existente
 * (mismo criterio que `POST /barberias/:id/clientes/:clienteId/reactivar`).
 */
@Controller('plataforma/usuarios')
export class PlataformaUsuariosController {
  constructor(
    private readonly usuariosPlataformaService: UsuariosPlataformaService,
  ) {}

  /**
   * PATCH /plataforma/usuarios/:id/estado
   * `{ estadoCuenta: 'ACTIVO' | 'SUSPENDIDO', motivo }`. El motivo es obligatorio
   * (422 `MOTIVO_REQUERIDO`) y queda auditado junto al valor anterior y al nuevo.
   */
  @Roles('ADMINISTRADOR')
  @Patch(':id/estado')
  @HttpCode(HttpStatus.OK)
  cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarEstadoCuentaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.usuariosPlataformaService.cambiarEstado(id, user, dto);
  }

  /**
   * GET /plataforma/usuarios?page=1&pageSize=25&busqueda=&estado=&rol=
   *
   * Bandeja paginada de la plataforma. Solo `ADMINISTRADOR` puede llamarla
   * (D05), por lo que `RolesGuard` la niega al resto por fail-closed.
   *
   * Respuesta:
   * - 200 → `{ datos, total, pagina, porPagina, resumen }`. `datos` son como
   *   mucho `pageSize` cuentas (tope 100) ordenadas por `fecha_registro DESC`;
   *   `total` cuenta el conjunto filtrado y `resumen` los KPI de la plataforma.
   * - 400 con `pageSize` fuera de rango o un filtro que no existe en el catálogo.
   * - 401 sin sesión.
   * - 403 sin `ADMINISTRADOR`.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  obtenerTodosLosUsuarios(@Query() query: ListarUsuariosDto): Promise<UsuariosPaginadosDto> {
    return this.usuariosPlataformaService.obtenerTodosLosUsuarios(query);
  }

  /**
   * POST /plataforma/usuarios
   *
   * Alta administrativa de una cuenta con rol elegido por el ADMINISTRADOR.
   * Responde 201 con el usuario creado en el formato de la bandeja, sin datos
   * sensibles (`passwordHash` no se selecciona nunca).
   *
   * Errores: 409 `CORREO_YA_REGISTRADO` / `CEDULA_YA_REGISTRADA` /
   * `TELEFONO_YA_REGISTRADO`, 409 `SEDE_YA_TIENE_ADMIN` (el rol
   * `ADMIN_BARBERIA` solo admite un vínculo ACTIVO por sede; el cuerpo incluye
   * `adminActual: { id, correo, nombreCompleto }`), 422 `BARBERIA_REQUERIDA` /
   * `BARBERIA_NO_APLICA`, 404 si la barbería no existe.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRADOR')
  crearUsuario(
    @Body() dto: CrearUsuarioPlataformaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ): Promise<UsuarioListResponseDto> {
    return this.usuariosPlataformaService.crearUsuario(dto, user);
  }

  /**
   * GET /plataforma/usuarios/:id/roles · I-05
   *
   * Vínculos de rol de la cuenta, cada uno con su sede y su estado. Es lo que
   * alimenta el modal de roles: la bandeja solo trae los nombres agregados.
   */
  @Get(':id/roles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  obtenerRoles(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuariosPlataformaService.obtenerRolesDeUsuario(id);
  }

  /**
   * PATCH /plataforma/usuarios/:id/administrador · I-05
   *
   * `{ habilitado: boolean, motivo? }`. Concede o retira el rol global
   * `ADMINISTRADOR`; rechaza el autobloqueo (422 `ADMIN_PROPIO_ROL`) y dejar la
   * plataforma sin administradores (422 `ULTIMO_ADMINISTRADOR`).
   */
  @Roles('ADMINISTRADOR')
  @Patch(':id/administrador')
  @HttpCode(HttpStatus.OK)
  cambiarAdministrador(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdministradorCuentaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.usuariosPlataformaService.cambiarAdministrador(id, user, dto);
  }

  /**
   * GET /plataforma/usuarios/:id/eliminacion · F7 / T-74
   *
   * Resumen de solo lectura para el modal de borrado: reservas futuras que se
   * cancelarían, pagos y arqueos que se desvincularían, sedes afectadas y los
   * bloqueos vigentes. Mismos cálculos que el `DELETE`.
   */
  @Get(':id/eliminacion')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  previsualizarEliminacion(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuariosPlataformaService.previsualizarEliminacion(id);
  }

  /**
   * DELETE /plataforma/usuarios/:id · F7 / T-72
   *
   * Eliminación REAL de la cuenta. El cuerpo debe repetir el correo exacto
   * (`{ confirmacion }`); si no coincide, 422 `CONFIRMACION_INCORRECTA`.
   *
   * Conflictos antes de borrar: 409 `AUTOBORRADO_NO_PERMITIDO`,
   * `ULTIMO_ADMINISTRADOR`, `USUARIO_ES_ADMIN_SEDE` (con `sedes`),
   * `USUARIO_ES_RESPONSABLE_SEDE` (con `sedes`), `USUARIO_CON_PROPUESTAS_HORARIO`
   * y `USUARIO_CON_SOLICITUDES_ANTECEDENTES`.
   *
   * Responde 200 con el resumen del borrado (respaldo, reservas canceladas,
   * pagos y arqueos desvinculados) y `correoLiberado`.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  eliminarUsuario(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EliminarUsuarioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.usuariosPlataformaService.eliminarUsuario(id, user, dto);
  }

  /**
   * GET /plataforma/usuarios/:id/auditoria
   *
   * Historial de la cuenta: altas, suspensiones, reactivaciones, motivos,
   * fechas y el detalle de cada evento (`contexto`), del más reciente al más
   * antiguo. Solo `ADMINISTRADOR` (D05).
   */
  @Get(':id/auditoria')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  obtenerAuditoriaUsuario(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UsuarioAuditoriaResponseDto[]> {
    return this.usuariosPlataformaService.obtenerAuditoriaUsuario(id);
  }
}
