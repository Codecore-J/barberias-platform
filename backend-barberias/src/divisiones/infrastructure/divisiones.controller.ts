import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../iam/infrastructure/public.decorator.js';
import { DivisionesService } from '../application/divisiones.service.js';

/**
 * F6 / T-66 · `GET /divisiones/:paisCodigo`.
 *
 * Público y de solo lectura: el formulario de alta necesita el catálogo
 * (provincia → municipio) antes de que exista una sede, y estos nombres son
 * información pública —los publica el propio país—, no datos de un usuario.
 *
 * Responde 422 `PAIS_NO_SOPORTADO` para cualquier país fuera de la lista del
 * alta, con la misma excepción que T-61.
 */
@Controller('divisiones')
export class DivisionesController {
  constructor(private readonly divisiones: DivisionesService) {}

  @Public()
  @Get(':paisCodigo')
  listar(@Param('paisCodigo') paisCodigo: string) {
    return this.divisiones.listar(paisCodigo);
  }
}
