# P-SD-5 · La guarda de vocabulario pasa a vigilar datos y frontend

> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Rama `chore/psd5-guarda-vocabulario` desde `main` (`569f354`, el merge del PR #61). **Push sin merge**, a la espera de aprobación.
>
> **Qué cierra este informe.** El punto que en la jornada anterior quedó marcado como **Pendiente** en
> [`PLAN_MIGRACION_SOFT_DELETE.md`](PLAN_MIGRACION_SOFT_DELETE.md) y que el propio documento explicaba así: «la guarda no
> se ha tocado desde `432c372`, su `BORRADOS_AUTORIZADOS` sigue vacío y sigue leyendo **solo** `backend-barberias/src/**`
> en busca de decoradores `@Delete`: no mira `prisma.*.delete*` ni el frontend». Ese diagnóstico era correcto y aquí se
> repara; la allowlist de la tabla de §4 deja de ser papel y pasa a ser guardia.

## 1. ¿Qué hice?

**Fase 1 · Preparación**
- `git fetch origin` + rama nueva desde `main` (que ya tiene el PR #61 fusionado): `chore/psd5-guarda-vocabulario`. Árbol limpio antes de empezar.
- **Inventario previo, solo lectura** (el rojo que hay que reproducir antes de tocar nada): `grep -rnE "\w+\.\w+\.(delete|deleteMany)\(" backend-barberias/src/` → **4 coincidencias**, exactamente los cuatro borrados que el plan había autorizado con su veredicto; `grep -rniE "executeRaw|queryRaw|DELETE FROM" backend-barberias/src/` → 0 `DELETE FROM`; `grep -rni "eliminar|delete|borrar|remove" frontend-barberias/src/app/core/services/` → `eliminarServicio`, `eliminarBloqueo` y cinco `localStorage.removeItem`.

**Fase 2 · Endurecer la guarda** ([`test/vocabulario-sin-delete.spec.ts`](backend-barberias/test/vocabulario-sin-delete.spec.ts), de 2 a 6 casos)

1. **Allowlist explícita y documentada.** `BORRADOS_AUTORIZADOS` recibe los cuatro borrados legítimos —`horario.deleteMany` y `horarioBarbero.deleteMany` (rejilla, sustitución completa dentro de una transacción), `auditoria.deleteMany` (purga por retención) y `usuarioRol.deleteMany` (movimiento de rol)— con un porqué escrito de una a tres frases cada uno, y `VOCABULARIO_FRONTEND_AUTORIZADO` recibe los tres alias del frontend (`eliminarServicio`, `eliminarBloqueo` y el `removeItem` de `localStorage`).
2. **Prisma delete.** Detector de `cliente.modelo.delete()` / `deleteMany()` que exige **dos niveles**, y una segunda búsqueda de `DELETE FROM` por SQL crudo. Encontró los cuatro de arriba y ninguno más.
3. **Cobertura de frontend.** Dos comprobaciones sobre `frontend-barberias/src/app`: ninguna petición HTTP `DELETE` (**sin allowlist**: no existe ninguna legítima) y el vocabulario de `core/services/` limitado a los alias documentados.
4. **La allowlist se compara contra el código en los dos sentidos** (ver §6, decisión 1): entrada nueva sin autorizar → rojo; entrada autorizada que ya no existe → rojo; motivo de menos de 40 caracteres → rojo.

**Fase 3 · Verificación y cierre**
- `npx vitest run test/vocabulario-sin-delete.spec.ts` → **6/6** (§3).
- **Verificación por mutación** de los cinco caminos de fallo (§4) y retirada de las cinco mutaciones, con el árbol limpio.
- Suite completa del backend y lint (§3) y **P-SD-5 a `[EJECUTADO]`** en el plan, con §4.1 reescrito y las tres citas obsoletas del documento anotadas.

## 2. Archivos tocados (resumen)

| Archivo | Qué |
| :--- | :--- |
| `backend-barberias/test/vocabulario-sin-delete.spec.ts` | La guarda pasa de decoradores a tres niveles (rutas · datos · frontend), con allowlist documentada y bidireccional |
| `PLAN_MIGRACION_SOFT_DELETE.md` | P-SD-5 a `[EJECUTADO]`; §4.1 reescrito con el cierre; notas de actualización en §1.4, §3 y §6 |
| `AUDITORIA_HALLAZGOS.md` | Nota de ampliación en los criterios de aceptación de E2-07 (la guarda ya cubre datos y frontend) |
| `reporte-p-sd-5-guarda-vocabulario.md` | **nuevo** — este informe |

Ninguna línea de código productivo: la guarda vigila, no cambia comportamiento. El frontend no se tocó.

## 3. Salida literal — guarda, suite completa y lint

```text
$ npx vitest run test/vocabulario-sin-delete.spec.ts
 ✓ test/vocabulario-sin-delete.spec.ts (6 tests) 103ms
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npm run test          # suite unitaria completa del backend
 Test Files  48 passed (48)
      Tests  547 passed (547)          # eran 543: +4 casos, los 2 de siempre intactos

$ npm run lint          # oxlint
Found 58 warnings and 0 errors.        # los 58 avisos son preexistentes
```

## 4. Verificación por mutación — ¿la guarda falla cuando debe?

Una guarda que solo se ve verde no demuestra nada: **ese fue exactamente el problema de P-SD-5** (un test en verde que no
miraba donde debía). Así que se provocaron a mano los cinco fallos, se comprobó el mensaje y se retiró cada mutación:

```text
# 1 · un borrado de datos de verdad, en el catálogo
catalogo/application/servicios.service.ts:229 · servicio.delete          → FAIL

# 2 · el frontend con una petición DELETE y un verbo del diseño
core/services/clientes.service.ts:67 · return this.http.delete(`${API_URL}/clientes/${id}`);   → FAIL
clientes.service.ts:66 · eliminarDeMentira                                                    → FAIL

# 3 · una entrada de la allowlist que ya no corresponde a nada
entradas de la allowlist que ya no corresponden a ningún borrado del código (retíralas):
  horario/application/horario.service.ts:horarioBarberosBogus.deleteMany                      → FAIL

# 4 · un porqué por debajo del mínimo
entradas sin porqué suficiente (mínimo 40 caracteres):
  tenant.service.ts:removeItem · 39 caracteres                                                → FAIL
```

Las cinco mutaciones se revirtieron (`cp` desde copia previa y `diff` de control) y el árbol quedó en el estado
entregado. La guarda anterior, con las mutaciones 1, 2 y 4 en disco, habría seguido en **verde**.

## 5. Criterios de aceptación

- [x] `BORRADOS_AUTORIZADOS` con los cuatro borrados legítimos y el motivo documentado en el propio código.
- [x] El detector de datos atrapa `prisma.*.delete` / `deleteMany` (y `DELETE FROM`) sin depender del nombre del cliente ni del alias de la transacción.
- [x] Comprobación equivalente sobre el frontend: cero peticiones HTTP `DELETE` y vocabulario limitado a los alias documentados.
- [x] El test específico en verde (6/6) y con los dos casos originales de E2-07 intactos.
- [x] Los cinco modos de fallo verificados por mutación (§4).
- [x] Suite completa en verde (547/547) y `npm run lint` sin errores nuevos.
- [x] P-SD-5 marcado `[EJECUTADO]` en el plan, sin dejar citas en contradicción.

## 6. Decisiones

1. **Allowlist bidireccional, no lista abierta.** Una allowlist que solo se comprueba en un sentido es papel: basta con añadir una línea para autorizar un borrado y nunca se detecta el sobrante. Esta compara en los dos: lo que aparece sin autorizar **y** lo autorizado que ya no aparece. El motivo mínimo de 40 caracteres existe para que «borrado necesario» no ocupe el hueco del porqué.
2. **Se retiró una assertion, y conviene decirlo.** El test original terminaba en `expect(Object.keys(BORRADOS_AUTORIZADOS)).toHaveLength(0)`, que garantizaba que la allowlist no podía crecer en silencio. Su premisa —la lista está vacía— dejó de ser cierta al darle contenido, así que esa comprobación se sustituye por la comparación exacta contra el código, que es **más estricta** (cubre el crecimiento y el sobrante). No se debilita nada: se cambia un invariante por otro que lo contiene.
3. **Dos niveles a propósito en el detector de datos.** El único `.delete(` de un solo nivel en `src/` es el de un `Set` en memoria (`combo-cycle.detector.ts · recursionStack.delete`), que no toca ninguna tabla; cualquier borrado de Prisma tiene los dos. Exigirlos evita el falso positivo sin dejar fuera ninguna tabla, y el detector **no** depende de que el cliente se llame `prisma` ni de que la transacción use el alias `tx`: renombrarlos no lo esquiva.
4. **`DELETE FROM` entra en la misma guarda.** Saltarse el cliente de Prisma es la otra forma de borrar filas; si la guarda vigila solo `prisma.*`, la vía cruda queda descubierta. Hoy son cero.
5. **El frontend se vigila desde el test del backend, y falla en duro si no encuentra el árbol.** La alternativa —`skipIf` cuando falta `frontend-barberias/`— reproduciría el defecto que esta tarea corrige: una guarda que pasa sin mirar. En CI (`actions/checkout` del monorepo) y en local el directorio está, así que el fallo en duro es un aviso legítimo de que la suite se está ejecutando fuera del monorepo.
6. **Sin allowlist para el HTTP `DELETE` del frontend.** El vocabulario del diseño no admite ninguna: desactivar es `PATCH`, liberar es `POST` y suspender la sede es `PATCH :id/estado`. Una allowlist ahí sería dar por bueno lo que Spec 01 §9 prohíbe.
7. **Los specs quedan fuera de los tres niveles.** El E2E limpia sus datos con `prisma.*.deleteMany` y el spec del frontend nombra los métodos que prueba: lo que la guarda vigila es lo que se despliega, no las herramientas que lo comprueban.

## 7. Limitaciones

- **La guarda vigila texto, no comportamiento.** Un borrado construido de forma exótica (SQL dinámico armado por concatenación, un `delete` delegado en una utilidad de terceros) podría escaparse. Cubre los tres caminos reales del proyecto —decoradores, cliente de Prisma y SQL crudo— y los cinco modos de fallo probados, pero no es un análisis semántico.
- **El umbral de 40 caracteres es una convención, no una prueba de calidad del motivo.** Impide el hueco vacío; no puede juzgar si la razón es buena. Eso sigue siendo revisión humana.
- **No se corrió la suite E2E** (fuera de alcance: este cambio no toca código productivo ni la base). Los 547 unitarios, los 6 de esta guarda y el lint son la verificación de este informe; el E2E del árbol fusionado sigue pendiente del CI, como ya recogía el informe anterior.
- **P-SD-8 sigue abierto**: `docs/MATRIZ_CUMPLIMIENTO.md` no existe. Con P-SD-5 cerrado, es el único punto del plan que queda.
