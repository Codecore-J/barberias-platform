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
} from '@nestjs/common';
import { BarberiaService } from '../application/barberia.service.js';
import { CreateBarberiaDto } from '../application/dto/create-barberia.dto.js';
import { UpdateBarberiaDto } from '../application/dto/update-barberia.dto.js';
import { VincularBarberiaDto } from '../application/dto/vincular-barberia.dto.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { Autenticado } from '../../iam/infrastructure/autenticado.decorator.js';
import { esAdministradorGlobal } from '../../iam/domain/roles.js';

@Controller('barberias')
export class BarberiaController {
  constructor(private readonly barberiaService: BarberiaService) {}

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
   * PATCH /barberias/:id/seleccionar
   * Selecciona una barbería como la activa para el usuario (apaga las demás).
   * Decisión 2 enmendada: los cuatro roles. La vincula `cliente_barberias`, que
   * un barbero normalmente no tiene —entra por su rol, no por un código—, así
   * que hoy el servicio le responde 404 aunque el guard le deje pasar.
   */
  // TODO(E1-06): validar el vínculo del solicitante con la barbería seleccionada.
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @Patch(':id/seleccionar')
  seleccionarActiva(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.seleccionarBarberiaActiva(user.id, id);
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
   * DELETE /barberias/:id
   * Soft-delete — cambia estado a INACTIVO.
   * Suspender una sede es una decisión de plataforma (decisión 4): solo el
   * ADMINISTRADOR global lo hace.
   */
  @Roles('ADMINISTRADOR')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.barberiaService.remove(id, user.id, esAdministradorGlobal(user));
  }
}
