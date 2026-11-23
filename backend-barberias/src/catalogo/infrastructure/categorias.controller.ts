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
  UseGuards,
} from '@nestjs/common';
import { CategoriasService } from '../application/categorias.service.js';
import { CreateCategoriaServicioDto } from '../application/dto/create-categoria-servicio.dto.js';
import { UpdateCategoriaServicioDto } from '../application/dto/update-categoria-servicio.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';

import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { esAdministradorGlobal } from '../../iam/domain/roles.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * V3 · Categorías de servicio de la sede.
 *
 * T-11 (matriz objetivo): la ESCRITURA de la taxonomía es del ADMINISTRADOR de
 * plataforma (`catalogo.categorias.gestionar`); el ADMIN_BARBERIA conserva solo
 * `catalogo.categorias.ver`, igual que el BARBERO. La LECTURA la comparten los
 * cuatro roles: el CLIENTE ve las categorías de sus sedes y el global las
 * supervisa. `VinculoBarberiaGuard` sigue exigiendo la sede —el global la salta
 * por D05— y la lectura del global queda auditada.
 */
@Controller('shops/:shopId/categorias')
export class CategoriasController {
  constructor(
    private readonly categoriasService: CategoriasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Post()
  @Roles('ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  @HttpCode(HttpStatus.CREATED)
  crear(
    @CurrentBarberiaId() barberiaId: string,
    @Body() dto: CreateCategoriaServicioDto,
  ) {
    return this.categoriasService.crear(barberiaId, dto);
  }

  @Get()
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  async listar(
    @CurrentBarberiaId() barberiaId: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const categorias = await this.categoriasService.listar(barberiaId);
    await this.auditarLecturaGlobal(user, barberiaId, 'listado', categorias.length);
    return categorias;
  }

  /** T-17 · detalle de UNA categoría, con la misma política de lectura. */
  @Get(':id')
  @Roles('CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  async obtener(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const categoria = await this.categoriasService.obtener(barberiaId, id);
    await this.auditarLecturaGlobal(user, barberiaId, 'detalle', 1);
    return categoria;
  }

  /**
   * T-21 · borrado de una categoría GLOBAL. Solo procede si ningún servicio de
   * barbero la usa: en ese caso responde 409 `CATEGORIA_CON_SERVICIOS` con la
   * cuenta y el panel ofrece desactivarla. La política es la misma que la
   * escritura (ADMINISTRADOR) y la sede del path sigue siendo obligatoria.
   */
  @Delete(':id')
  @Roles('ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  @HttpCode(HttpStatus.OK)
  eliminar(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.categoriasService.eliminar(barberiaId, id);
  }

  @Patch(':id')
  @Roles('ADMINISTRADOR')
  @UseGuards(VinculoBarberiaGuard)
  actualizar(
    @CurrentBarberiaId() barberiaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoriaServicioDto,
  ) {
    return this.categoriasService.actualizar(barberiaId, id, dto);
  }

  /**
   * Sólo se audita la lectura del ADMINISTRADOR global: la del personal de la
   * sede es su trabajo diario y llenaría el histórico. El evento no guarda
   * datos del catálogo, solo quién miró qué sede y cuántas filas devolvió.
   */
  private async auditarLecturaGlobal(
    user: UsuarioAutenticado,
    barberiaId: string,
    alcance: 'listado' | 'detalle',
    filas: number,
  ): Promise<void> {
    if (!esAdministradorGlobal(user)) return;

    await this.auditoria.registrarEvento({
      usuarioId: user.id,
      barberiaId,
      accion: 'CATEGORIAS_CONSULTADAS',
      entidad: 'categorias_servicio',
      contexto: { alcance, filas, origen: 'ADMINISTRADOR_GLOBAL' },
    });
  }
}
