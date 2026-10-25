import { Directive, OnDestroy, OnInit } from '@angular/core';

/**
 * H-03 · mantiene el modal pegado al viewport aunque su página viva dentro de
 * un contenedor con `perspective` o `transform-style: preserve-3d`.
 *
 * `position: fixed` deja de resolverse contra el viewport cuando un ancestro
 * declara `perspective` o `preserve-3d`: ese ancestro pasa a ser el containing
 * block y el overlay `inset-0` se estira al alto completo del documento. El
 * resultado es el que se reportó en producción: el fondo oscurecido cubre la
 * pantalla, pero el panel queda centrado a miles de píxeles de altura, fuera
 * de la vista, sin errores de consola ni peticiones fallidas.
 *
 * Mientras hay al menos un overlay montado marcamos el documento con
 * `modal-abierto`; `styles.css` anula ahí esas dos propiedades. Al cerrar el
 * último modal se restaura el efecto 3D de la página intacto.
 */
@Directive({
  selector: '[appModalOverlay]',
  standalone: true,
})
export class ModalOverlayDirective implements OnInit, OnDestroy {
  private static abiertos = 0;

  ngOnInit(): void {
    ModalOverlayDirective.abiertos += 1;
    if (ModalOverlayDirective.abiertos === 1) {
      document.documentElement.classList.add('modal-abierto');
    }
  }

  ngOnDestroy(): void {
    ModalOverlayDirective.abiertos = Math.max(0, ModalOverlayDirective.abiertos - 1);
    if (ModalOverlayDirective.abiertos === 0) {
      document.documentElement.classList.remove('modal-abierto');
    }
  }
}
