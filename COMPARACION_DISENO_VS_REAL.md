# Comparación diseño vs. real — **SUSTITUIDO**

> **Documento retirado el 2026-10-15 al cerrar E2-08.** Su contenido —la comparación del diseño original contra el
> sistema de septiembre de 2026, con veredictos `IGUAL` / `DESVIACIÓN`— dejó de ser cierto y no se mantiene aquí:
> el más visible de sus hallazgos, que `RolesGuard` **no** estaba registrado de forma global, lo corrigió
> `72531e9 · fix(sec): make RolesGuard global to enforce role validation`. Además cubría 4 de las 9 secciones que
> E2-08 pedía.
>
> **El contenido histórico no se ha borrado.** Sigue completo en la historia de git:
> `git show 72531e9:COMPARACION_DISENO_VS_REAL.md` (última versión que lo modificó).

**La fuente de verdad ahora es [`docs/MATRIZ_CUMPLIMIENTO.md`](MATRIZ_CUMPLIMIENTO.md).** Allí cada regla del diseño
tiene su fila: el estado real (`OK-PROBADO`, `OK-SIN-TEST`, `PARCIAL`, `NO-EXISTE`, `NO-VERIFICADO`), la evidencia
`archivo:línea`, el test que la certifica y la tarea del backlog que la cierra.
