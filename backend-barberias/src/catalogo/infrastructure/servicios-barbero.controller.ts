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
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ServiciosBarberoService } from '../application/servicios-barbero.service.js';
import { SolicitudesServicioService } from '../application/solicitudes-servicio.service.js';
import { CreateServicioBarberoDto } from '../application/dto/create-servicio-barbero.dto.js';
import { UpdateServicioBarberoDto } from '../application/dto/update-servicio-barbero.dto.js';
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
 * V3 · Catálogo híbrido.
 *
 *  - `GET /shops/:shopId/servicios` · la vitrina del CLIENTE, anidada por
 *    categorías. Se conserva el vínculo con la sede (E1-06): el catálogo de una
 *    barbería no es un directorio abierto de precios, sigue exigiendo pertenencia
 *    —rol en la sede o `cliente_barberias` ACTIVO—, igual que `/services`.
 *  - `mis-servicios` · panel del BARBERO. El `barberoId` SIEMPRE sale del JWT;
 *    `SoloBarberoGuard` impide que el ADMINISTRADOR global «publique como» él y el
 *    servicio vuelve a comprobar el rol BARBERO en esa sede.
 *
 * `/mis-servicios` no se llama `/services` para no confundirse con el catálogo
 * heredado (`Servicio`, del ADMIN_BARBERIA), que sigue vivo para las reservas
 * existentes: son dos tablas y dos permisos distintos.
 */
@Controller('shops/:shopId')
export class ServiciosBarberoController {
  constructor(
    private readonly serviciosBarberoService: ServiciosBarberoService,
    private readonly solicitudesService: SolicitudesServicioService,
  ) {}

  @Get('servicios')
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  catalogo(@CurrentBarberiaId() barberiaId: string) {
    return this.serviciosBarberoService.catalogoAnidado(barberiaId);
  }

  /**
   * Decisión del 24 nov: el barbero ya no publica.
   *
   * El mismo cuerpo crea una SOLICITUD `ALTA` en estado `PENDIENTE`; el servicio
   * nace cuando el ADMIN_BARBERIA la aprueba (`PATCH .../solicitudes-servicio/:id`).
   * Se conserva la ruta y el DTO para no romper a quien ya la usa: cambia el
   * efecto, no el contrato de entrada. La respuesta pasa a ser la solicitud.
   */
  @Post('mis-servicios')
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  @HttpCode(HttpStatus.CREATED)
  crear(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Body() dto: CreateServicioBarberoDto,
  ) {
    return this.solicitudesService.crear(barberiaId, user.id, {
      tipo: 'ALTA',
      nombre: dto.nombre,
      categoriaId: dto.categoriaId,
      descripcion: dto.descripcion,
      precio: dto.precio,
      duracionMinutos: dto.duracionMinutos,
    });
  }

  @Get('mis-servicios')
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  listarMios(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.serviciosBarberoService.listarMios(barberiaId, user.id);
  }

  @Patch('mis-servicios/:id')
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  actualizar(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServicioBarberoDto,
  ) {
    return this.serviciosBarberoService.actualizar(barberiaId, user.id, id, dto);
  }

  /**
   * T-24 · foto del servicio. El archivo viaja en el campo `archivo`
   * (multipart/form-data). Multer lo mantiene en memoria y corta arriba de
   * 2 MB; el servicio vuelve a validar tipo y tamaño porque la ruta no es el
   * único camino posible a la lógica de negocio.
   */
  @Patch('mis-servicios/:id/imagen')
  @Roles('BARBERO')
  @UseGuards(SoloBarberoGuard, VinculoBarberiaGuard)
  // El corte de Multer (> 2 MB) y la validación del servicio responden el mismo
  // 400 `IMAGEN_DEMASIADO_GRANDE`.
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
    return this.serviciosBarberoService.actualizarImagen(barberiaId, user.id, id, archivo);
  }
}
