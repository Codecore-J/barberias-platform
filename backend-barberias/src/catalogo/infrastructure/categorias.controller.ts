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
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import { CurrentBarberiaId } from '../../iam/infrastructure/current-barberia.decorator.js';
import { VinculoBarberiaGuard } from '../../iam/infrastructure/vinculo-barberia.guard.js';
import { OperadorBarberiaGuard } from './operador-barberia.guard.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { esAdministradorGlobal } from '../../iam/domain/roles.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * V3 · Categorías de servicio de la sede.
 *
 * La ESCRITURA es del ADMIN_BARBERIA: el modelo de negocio pone la taxonomía en
 * manos de la sede, no del barbero (que elige dentro de ella) ni del
 * ADMINISTRADOR global (que supervisa). `RolesGuard` ya acota la ruta a los roles
 * declarados y al `barberiaId` del parámetro; `OperadorBarberiaGuard` cierra el
 * paso transversal del ADMINISTRADOR por la misma razón que en el catálogo (D16).
 *
 * La LECTURA la comparten el ADMIN_BARBERIA y el BARBERO: el barbero necesita ver
 * las categorías para publicar sus servicios. El CLIENTE no la necesita: recibe
 * el catálogo ya anidado en `GET /shops/:shopId/servicios`.
 *
 * T-17 · el ADMINISTRADOR global TAMBIÉN lee (lista y detalle) de cualquier sede,
 * en modo solo lectura: escribe por las mismas rutas que antes y recibe 403 de
 * `OperadorBarberiaGuard` (D16). La lectura no repite ADMINISTRADOR en `@Roles`:
 * la matriz aprobada (E1-04/E1-05) le concede lectura por jerarquía y el test
 * `test/permisos-matriz.spec.ts` exige que el decorador coincida con ella. Su
 * lectura queda auditada (supervisión trazable, sin datos sensibles).
 */
@Controller('shops/:shopId/categorias')
export class CategoriasController {
  constructor(
    private readonly categoriasService: CategoriasService,
    private readonly auditoria: AuditoriaService,
  ) {}

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
  @Roles('ADMIN_BARBERIA', 'BARBERO')
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
  @Roles('ADMIN_BARBERIA', 'BARBERO')
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
