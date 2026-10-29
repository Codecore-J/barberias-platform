# Reporte — V3 Frontend: UI del catálogo híbrido y reasignación en agenda

Rama: `feat/v3-frontend-catalogo`
Base: `origin/main` (`ee8ece4`) + merge de `origin/feat/v3-backend-catalogo-hibrido` (`f44c9c3`)

> **Dependencia explícita:** al momento de esta fase el backend del catálogo híbrido
> seguía en el PR #112, **sin fusionar** en `main`. Para que la UI tenga contra qué
> hablar, la rama incorpora ese commit de backend. El PR de frontend arrastra esos
> cambios; si el backend se fusiona antes, el merge es trivial (mismos commits).

## Componentes creados

| Archivo | Rol | Qué hace |
| --- | --- | --- |
| `core/services/catalogo-hibrido.service.ts` | Servicio compartido | Señales de estado (`cargando`, `error`, `guardando`) para categorías, servicios propios y vitrina. Traduce el contrato de error D40 (`{ statusCode, codigo, mensaje }`) a texto mostrable y da mensaje propio a 403, 404, 409 y 422. Normaliza `Decimal` (string) a `number`. |
| `features/admin/categorias/admin-categorias.component.ts` | Panel ADMIN_BARBERIA | Tabla con `overflow-x-auto`, estado vacío con CTA, spinner de carga, banner de error con «Reintentar» y toast de éxito. Modal reactivo (`FormBuilder`, `Validators`) para `POST` y `PATCH`; desactivar/reactivar con `confirm()` y spinner por fila. Modo lectura si el rol no es `ADMIN_BARBERIA`. |
| `features/barbero/servicios/barbero-servicios.component.ts` | Panel BARBERO | Tarjetas con categoría, precio y duración; *toggle* `activo` con estado en vuelo; modal con dropdown de categorías activas (más la categoría actual si fue desactivada), precio y duración; aviso cuando la sede aún no tiene categorías; estados vacío/carga/error. |

### Rutas nuevas (`app.routes.ts`)

- `admin/categorias` · `tenantGuard` + `roleGuard(['ADMIN_BARBERIA'])`. Se restringió
  a `ADMIN_BARBERIA` porque el backend declara `@Roles('ADMIN_BARBERIA')` en escritura
  y `('ADMIN_BARBERIA', 'BARBERO')` en lectura: dejar entrar al `ADMINISTRADOR` solo
  producía un 403 en pantalla.
- `barbero/servicios` · `tenantGuard` + `roleGuard(['BARBERO'])`.

## Componentes modificados

| Archivo | Cambio |
| --- | --- |
| `core/services/reservas.service.ts` | `asignarBarbero(reservaId, barberoId)` → `PATCH /reservas/:id/asignar-barbero`. Sin `shopId`: el backend toma la sede de la propia reserva. Propaga el mensaje del backend para 403 (`RESERVA_AJENA`) y 409 (`ESTADO_INVALIDO`). |
| `features/agenda/admin-agenda.component.ts` | Botón «Asignar Barbero / Reasignar» en las tarjetas de turno (columna de barbero y «Sin Asignar») para `PENDIENTE`, `PROPUESTA_PENDIENTE` y `CONFIRMADA` —los mismos estados que acepta `ESTADOS_ASIGNABLES`—; modal con el staff asignable (`BARBERO`/`ADMIN_BARBERIA` con cuenta `ACTIVO`), error del backend dentro del modal y recarga de la agenda al confirmar para que la tarjeta se mueva de columna. |
| `features/catalogo/catalogo.component.ts` | Vitrina del cliente reescrita: navega por **categorías** desplegables (la primera abierta) y dentro agrupa los servicios **por barbero** con precio y duración. Banner de error con reintento, spinner, contadores de categorías/servicios y CTA de reserva. Si la sede no tiene catálogo híbrido, cae al catálogo heredado (`/services`) para no dejar la pantalla en blanco. |
| `shared/layout/app-layout.component.ts` | Menú Configuración de la sede y menú móvil: entrada «Categorías». Nav del `BARBERO`: «Mis Servicios» ahora apunta a `/barbero/servicios` y el catálogo heredado se rotula «Catálogo de Sede» para no confundirlos. Se quitó «Categorías» del menú del `ADMINISTRADOR` global (el backend le responde 403 al leerlas). |

## Alcance consciente: reserva contra el catálogo híbrido

`CreateReservaDto` sigue validando `serviciosIds` contra la tabla heredada `Servicio`;
no existe todavía forma de reservar un `ServicioBarbero`. Por eso el asistente
(`reserva-wizard`) **no** se cambió para enviar ids del catálogo híbrido: la vitrina
muestra la estructura anidada y el botón de reserva lleva al asistente, que trabaja
con la carta de la sede. Cambiar el asistente sin ese soporte del backend habría
producido 400 en la creación de la cita.

## Validación

- `npm run lint` → 0 warnings, 0 errors.
- `npx ng build` → build de producción correcto (chunks nuevos: `admin-categorias`, `barbero-servicios`, `catalogo`).
- `npm test -- --watch=false` → 14 archivos, 120 tests, todos en verde.
