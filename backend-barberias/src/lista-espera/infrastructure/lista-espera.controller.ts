import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ListaEsperaService } from '../application/lista-espera.service.js';
import { CreateListaEsperaDto } from '../application/dto/create-lista-espera.dto.js';
import { Roles } from '../../iam/infrastructure/roles.decorator.js';
import { RequireVerification } from '../../iam/infrastructure/require-verification.decorator.js';
import { VerificacionGuard } from '../../iam/infrastructure/verificacion.guard.js';
import { CurrentUser } from '../../iam/infrastructure/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * E4-02 · D22 · Carril B: lista de espera.
 *
 * El alta es del CLIENTE: es él quien dice que aceptaría un hueco en esa sede y
 * fecha. El `usuarioId` sale del token (`@CurrentUser`), nunca del cuerpo, así
 * que un cliente no puede anotar a otro. El ADMINISTRADOR global entra por la   * jerarquía de `RolesGuard` (E1-04).
   *
   * V2.1 · la suscripción también exige el teléfono verificado: una lista de
   * espera sin teléfono no sirve, porque el aviso de hueco libre sale por
   * WhatsApp a ese mismo número.
 */
@Controller('lista-espera')
export class ListaEsperaController {
  constructor(private readonly listaEsperaService: ListaEsperaService) {}

  @Post()
  @Roles('CLIENTE')
  @RequireVerification()
  @UseGuards(VerificacionGuard)
  @HttpCode(HttpStatus.CREATED)
  suscribirse(@CurrentUser() usuario: UsuarioAutenticado, @Body() dto: CreateListaEsperaDto) {
    return this.listaEsperaService.suscribirse(usuario.id, dto);
  }
}
