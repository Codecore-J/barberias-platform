import { Directive, Input, OnDestroy, OnInit } from '@angular/core';

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
 * Mientras hay al menos un overlay activo marcamos el documento con
 * `modal-abierto`; `styles.css` anula ahí esas dos propiedades. Al cerrar el
 * último modal se restaura el efecto 3D de la página intacto.
 *
 * H-01 · el estado se puede declarar de dos formas:
 *
 *   - `<div appModalOverlay>`  → activo mientras el elemento esté montado
 *     (comportamiento histórico; lo usan el drawer y el diálogo de confirmación,
 *     que viven dentro de un `@if`).
 *   - `<div [appModalOverlay]="visible()">` → activo solo cuando el binding es
 *     verdadero. Lo necesita `modal-shell`, cuyo overlay permanece montado (ver
 *     el comentario de portabilidad en ese componente) y por tanto ya no puede
 *     deducir su estado del ciclo de vida.
 */
@Directive({
  selector: '[appModalOverlay]',
  standalone: true,
})
export class ModalOverlayDirective implements OnInit, OnDestroy {
  private static abiertos = 0;

  private activo = false;
  private recibioBinding = false;

  /** `true` por defecto para que el atributo suelto siga significando «activo». */
  @Input()
  set appModalOverlay(valor: boolean | '') {
    this.recibioBinding = true;
    this.sincronizar(valor !== false);
  }

  ngOnInit(): void {
    // Sin binding Angular nunca llama al setter, así que el modo «atributo
    // suelto» se resuelve aquí, igual que antes. Con binding NO se toca nada:
    // el setter ya fijó el estado, y forzar `true` aquí dejaba el contador
    // desbalanceado (cada instancia sumaba uno de más y la clase `modal-abierto`
    // ya no se retiraba al cerrar el último modal: la página quedaba sin scroll).
    if (!this.recibioBinding) this.sincronizar(true);
  }

  ngOnDestroy(): void {
    this.sincronizar(false);
  }

  private sincronizar(nuevo: boolean): void {
    if (nuevo === this.activo) return;
    this.activo = nuevo;

    ModalOverlayDirective.abiertos = Math.max(
      0,
      ModalOverlayDirective.abiertos + (nuevo ? 1 : -1),
    );

    const raiz = document.documentElement;
    if (ModalOverlayDirective.abiertos > 0) {
      raiz.classList.add('modal-abierto');
    } else {
      raiz.classList.remove('modal-abierto');
    }
  }
}
