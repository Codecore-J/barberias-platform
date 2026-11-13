import { Pipe, PipeTransform } from '@angular/core';
import { ETIQUETA_ROL, type RolSesion } from '../../core/utils/rol';

/**
 * T-12 · etiqueta legible de un rol.
 *
 * La tabla de usuarios pintaba los códigos crudos del backend
 * (`ADMIN_BARBERIA`, `CLIENTE`, `BARBERO`), que no son lenguaje de negocio para
 * quien administra la plataforma. El mapa de etiquetas ya existía para la
 * cabecera (`ETIQUETA_ROL`); este pipe lo reutiliza en vez de crear un segundo
 * diccionario que pudiera desincronizarse.
 *
 * Un rol desconocido (uno nuevo del backend, o un dato heredado) se muestra
 * como llegó: nunca se oculta ni se inventa una etiqueta.
 */
@Pipe({ name: 'rolLabel', standalone: true })
export class RolLabelPipe implements PipeTransform {
  transform(rol: string | null | undefined): string {
    if (!rol) return '—';
    return ETIQUETA_ROL[rol as RolSesion] ?? rol;
  }
}
