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
  UseGuards,
} from '@nestjs/common';
import { CategoriasService } from '../application/categorias.service.js';
import { CreateCategoriaServicioDto } from '../application/dto/create-categoria-servicio.dto.js';
import { UpdateCategoriaServicioDto } from '../application/dto/update-categoria-servicio.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';
import { OperadorBarberiaGuard } from './operador-barberia.guard.js';

/**
 * V3 · Categorías de servicio de la sede.
 *
 * La ESCRITURA es del ADMIN_BARBERIA: el modelo de negocio pone la taxonomía en
 * manos de la sede, no del barbero (que elige dentro de ella) ni del
 * ADMINISTRADOR global (que supervisa). `RolesGuard` ya acota la ruta a los roles
 * declarados y al `barberiaId` del parámetro; `OperadorBarberiaGuard` cierra el
 * paso transversal del ADMINISTRADOR por la misma razón que en el catálogo (D16).
 *
 * La LECTURA la comparten el ADMIN_BARBERIA, el BARBERO y —desde T-17— el
 * ADMINISTRADOR global, que necesita auditar la taxonomía de una sede sin poder
 * cambiarla. El rol se declara explícito aunque `RolesGuard` ya lo deje pasar por
 * jerarquía (E1-04): así la política de la ruta se lee sin tener que recordar la
 * regla transversal, y la matriz de permisos la refleja. El CLIENTE no la
 * necesita: recibe el catálogo ya anidado en `GET /shops/:shopId/servicios`.
 *
 * T-17 · el ADMINISTRADOR es de SOLO LECTURA aquí. `@Roles('ADMIN_BARBERIA')` en
 * escritura no basta por sí solo —la jerarquía del guard también lo dejaría
 * pasar—, pero `OperadorBarberiaGuard` sí lo corta: exige un rol de operación
 * (BARBERO/ADMIN_BARBERIA) sin jerarquías y responde 403. La combinación de los
 * dos es la que mantiene la taxonomía en manos de la sede.
 */
@Controller('shops/:shopId/categorias')
export class CategoriasController {
  constructor(private readonly categoriasService: CategoriasService) {}

  @Post()
  @Roles('ADMIN_BARBERIA')
  @UseGuards(OperadorBarberiaGuard, VinculoBarberiaGuard)
  @HttpCode(HttpStatus.CREATED)
  crear(
    @CurrentBarberiaId() barberiaId: string,
    @Body() dto: CreateCategoriaServicioDto,
  ) {
    return this.categoriasService.crear(barberiaId, dto);
  }

  @Get()
  @Roles('ADMIN_BARBERIA', 'BARBERO', 'ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  listar(@CurrentBarberiaId() barberiaId: string) {
    return this.categoriasService.listar(barberiaId);
  }

  @Patch(':id')
  @Roles('ADMIN_BARBERIA')
  @UseGuards(OperadorBarberiaGuard, VinculoBarberiaGuard)
  actualizar(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoriaServicioDto,
  ) {
    return this.categoriasService.actualizar(barberiaId, id, dto);
  }
}
