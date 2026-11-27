import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../iam/infrastructure/public.decorator.js';
import { DivisionesService } from '../application/divisiones.service.js';

/** `?latitud=` vacío no es cero: un 0 inventado apuntaría al golfo de Guinea. */
function numeroDeQuery(valor?: string): number | undefined {
  if (valor === undefined || valor.trim() === '') return undefined;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : undefined;
}

/**
 * F6 / T-66 · `GET /divisiones/:paisCodigo` y `GET /divisiones/ubicacion`.
 *
 * Público y de solo lectura: el formulario de alta necesita el catálogo
 * (provincia → municipio) y la confirmación de lo que se deduce de las
 * coordenadas antes de que exista una sede. Estos nombres son información
 * pública —los publica el propio país—, no datos de un usuario.
 *
 * `ubicacion` se declara ANTES del comodín: si fuera después, `:paisCodigo`
 * capturaría la palabra «ubicacion» como si fuera un país.
 *
 * Responde 422 `PAIS_NO_SOPORTADO` para cualquier país fuera de la lista del
 * alta, con la misma excepción que T-61.
 */
@Controller('divisiones')
export class DivisionesController {
  constructor(private readonly divisiones: DivisionesService) {}

  @Public()
  @Get('ubicacion')
  porUbicacion(@Query('latitud') latitud?: string, @Query('longitud') longitud?: string) {
    return this.divisiones.porUbicacion(numeroDeQuery(latitud), numeroDeQuery(longitud));
  }

  @Public()
  @Get(':paisCodigo')
  listar(@Param('paisCodigo') paisCodigo: string) {
    return this.divisiones.listar(paisCodigo);
  }
}
