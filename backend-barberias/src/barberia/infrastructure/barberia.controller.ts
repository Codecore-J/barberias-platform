import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { BarberiaService } from '../application/barberia.service.js';
import { SolicitudCambioService } from '../application/solicitud-cambio.service.js';
import { CreateBarberiaDto } from '../application/dto/create-barberia.dto.js';
import { CreateSolicitudCambioDto } from '../application/dto/create-solicitud-cambio.dto.js';
import { UpdateBarberiaDto } from '../application/dto/update-barberia.dto.js';
import { CambiarEstadoBarberiaDto } from '../application/dto/cambiar-estado-barberia.dto.js';
import { VincularBarberiaDto } from '../application/dto/vincular-barberia.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Autenticado } from '../../iam/infrastructure/autenticado.decorator.js';
import { esAdministradorGlobal } from '../../iam/domain/roles.js';

@Controller('barberias')
export class BarberiaController {
  constructor(
    private readonly barberiaService: BarberiaService,
    private readonly solicitudCambioService: SolicitudCambioService,
  ) {}

  /**
   * POST /barberias
   * Cualquier usuario autenticado puede crear una barbería (decisión 1).
   * El responsable se extrae automáticamente del JWT.
   * El límite de 2 barberías por usuario es E1-07.
   */
  // TODO(E1-07): aplicar el límite de 2 barberías por usuario en el servicio.
  @Autenticado()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.create(user.id, dto);
  }

  /**
   * POST /barberias/vincular
   * Vincula al usuario actual a una barbería mediante código de acceso
   * (decisión 5). Crea un vínculo `cliente_barberias`: lo usa el CLIENTE.
   * Un barbero entra por su rol y un administrador gestiona por panel, así que
   * ninguno necesita un vínculo de cliente.
   */
  @Roles('CLIENTE')
  @Post('vincular')
  vincular(
    @Body() dto: VincularBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.vincularCliente(user.id, dto);
  }

  /**
   * GET /barberias
   * Lista las barberías donde el usuario es responsable. Los cuatro roles
   * necesitan esta pantalla: es el selector de sede del frontend.
   * E1-07: el servicio aplica por sede la misma regla de `codigoAcceso` que la
   * lectura por id, así que aquí no basta con saber quién pregunta.
   */
  @Autenticado()
  @Get()
  findMine(@CurrentUser() user: UsuarioAutenticado) {
    return this.barberiaService.findAllByResponsable(user.id, user);
  }

  /**
   * GET /barberias/all
   * Solo el ADMINISTRADOR global puede listar todas las barberías (D05).
   */
  @Get('all')
  @Roles('ADMINISTRADOR')
  findAll() {
    return this.barberiaService.findAll();
  }

  /**
   * GET /barberias/:id/personal
   * Lista el personal (barberos y administradores) de una barbería.
   * ADMIN_BARBERIA o BARBERO de esa barbería, y el ADMINISTRADOR global;
   * la pertenencia y el ocultado del contacto se validan en el servicio
   * (E1-03 · H19).
   */
  @Roles('ADMIN_BARBERIA', 'BARBERO')
  @Get(':id/personal')
  findPersonal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.findPersonal(id, user);
  }

  /**
   * GET /barberias/:id
   * Cualquier usuario autenticado puede consultar una barbería por ID
   * (decisión 3). La respuesta excluye `codigoAcceso` y `enlaceUnico` salvo
   * para el ADMIN_BARBERIA de esa barbería y el ADMINISTRADOR global.
   */
  @Autenticado()
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.findOne(id, user);
  }

  /**
   * POST /barberias/:id/solicitudes-cambio · E3-13 (D26)
   *
   * El nombre y el responsable solo cambian con la aprobación de la plataforma:
   * la sede PROPONE y el ADMINISTRADOR resuelve. La ruta usa `:id`, así que el
   * `RolesGuard` no resuelve la sede del parámetro; la pertenencia real la exige
   * el servicio (`SOLO_ADMIN_BARBERIA`, 403), igual que en el resto del módulo.
   */
  @Roles('ADMIN_BARBERIA')
  @Post(':id/solicitudes-cambio')
  @HttpCode(HttpStatus.CREATED)
  crearSolicitudCambio(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSolicitudCambioDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.solicitudCambioService.crearSolicitud(id, user, dto);
  }

  /**
   * GET /barberias/:id/invitacion · E3-12/2 (regla 1.10)
   *
   * La puerta de entrada de la sede, para que quien la administra pueda
   * COMPARTIRLA: el código de acceso y el enlace único del que cuelga el QR. La
   * ruta usa `:id` (no `:barberiaId`), así que el `RolesGuard` no resuelve la
   * sede del parámetro y la pertenencia real la exige el servicio
   * (`obtenerInvitacion`, 403) — igual que E3-13 y la bandeja de restringidos.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Get(':id/invitacion')
  obtenerInvitacion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.obtenerInvitacion(id, user);
  }

  /**
   * PATCH /barberias/:id/seleccionar
   * Selecciona una barbería como la activa para el usuario (apaga las demás).
   * Decisión 2 enmendada: los cuatro roles.
   *
   * E1-06: el servicio ya acepta el vínculo por rol, no solo `cliente_barberias`,
   * así que el barbero y el dueño dejan de recibir 404 en la ruta que existe
   * para ellos. Se le pasa la sesión para no consultar `usuario_roles` dos veces.
   */
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Patch(':id/seleccionar')
  seleccionarActiva(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.seleccionarBarberiaActiva(user.id, id, user);
  }

  /**
   * PATCH /barberias/:id
   * Solo el ADMIN_BARBERIA de la barbería o el ADMINISTRADOR global puede
   * editarla; la pertenencia la comprueba el servicio.
   */
  @Roles('ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.update(id, user.id, dto, esAdministradorGlobal(user));
  }

  /**
   * PATCH /barberias/:id/estado · E2-07 (y E1-07)
   *
   * El borrado lógico pasa a ser un CAMBIO DE ESTADO explícito: suspender una
   * sede (`INACTIVO`) y volver a activarla (`ACTIVO`) son la misma operación, y
   * el verbo deja de decir «eliminar» cuando el efecto es «suspender». Antes,
   * volver a activar una sede exigía tocar la base a mano.
   *
   * Suspender una sede sigue siendo una decisión de plataforma (decisión 4):
   * solo el ADMINISTRADOR global.
   */
  /**
   * PATCH /barberias/:id/estado · E2-07 (y E1-07)
   */
  @Roles('ADMINISTRADOR')
  @Patch(':id/estado')
  @HttpCode(HttpStatus.OK)
  cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarEstadoBarberiaDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.cambiarEstado(id, user.id, dto.estado, esAdministradorGlobal(user));
  }
}
