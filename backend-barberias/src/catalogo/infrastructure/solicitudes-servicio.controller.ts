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
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SolicitudesServicioService } from '../application/solicitudes-servicio.service.js';
import {
  CrearSolicitudServicioDto,
  ResolverSolicitudServicioDto,
} from '../application/dto/solicitud-servicio.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';
import { SoloBarberoGuard } from './solo-barbero.guard.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import {
  TAMANO_MAXIMO_IMAGEN,
  type ArchivoSubido,
} from '../../shared/cloudinary/cloudinary.service.js';
import { ImagenDemasiadoGrandeFilter } from '../../shared/cloudinary/imagen-demasiado-grande.filter.js';

/**
 * T-27 / T-28 · solicitudes de servicio de la sede.
 *
 *  - `POST` la manda el BARBERO (su `barberoId` sale del JWT, nunca del cuerpo).
 *  - `GET` y `PATCH` son del ADMIN_BARBERIA: la bandeja y su resolución. El
 *    ADMINISTRADOR global no entra por jerarquía (T-11).
 */
@Controller('shops/:shopId/solicitudes-servicio')
export class SolicitudesServicioController {
  constructor(private readonly solicitudesService: SolicitudesServicioService) {}

  @Post()
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  @HttpCode(HttpStatus.CREATED)
  crear(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Body() dto: CrearSolicitudServicioDto,
  ) {
    return this.solicitudesService.crear(barberiaId, user.id, dto);
  }

  @Get()
  @Roles('ADMIN_BARBERIA')
  @UseGuards(VinculoBarberiaGuard)
  listar(
    @CurrentBarberiaId() barberiaId: string,
    @Query('estado') estado?: string,
  ) {
    return this.solicitudesService.listar(barberiaId, estado);
  }
  /**
   * T-28 · foto de la solicitud pendiente. El barbero la adjunta ANTES de que la
   * sede resuelva, y la aprobación la copia al servicio publicado.
   */
  @Patch(':id/imagen')
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  @UseFilters(ImagenDemasiadoGrandeFilter)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO_IMAGEN } }),
  )
  actualizarImagen(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() archivo: ArchivoSubido,
  ) {
    return this.solicitudesService.actualizarImagen(barberiaId, user.id, id, archivo);
  }

  @Patch(':id')
  @Roles('ADMIN_BARBERIA')
  @UseGuards(VinculoBarberiaGuard)
  resolver(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolverSolicitudServicioDto,
  ) {
    return this.solicitudesService.resolver(barberiaId, user.id, id, dto);
  }
}
