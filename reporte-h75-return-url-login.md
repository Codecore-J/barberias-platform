> Plantilla 8.4 de `docs/BACKLOG_BARBERIAS_V1.md`. Rama `fix/h75-return-url-login` desde
> `feat/e3-12-enlace-qr` (`4419df7`). **Push sin merge**, a la espera de aprobación.

# H75 · El enlace que abrió una persona sin sesión ya sobrevive al login

**TAREA:** H75 — quien escanea el QR de una sede (o abre cualquier ruta interna) sin sesión era
interceptado por `authGuard` y, tras entrar, aterrizaba en el dashboard por rol: la invitación se perdía
y solo quedaba teclear el código de 8 caracteres o escanear otra vez.
**RAMA:** `fix/h75-return-url-login`
**HALLAZGO:** `AUDITORIA_HALLAZGOS.md` → `H75 · … — **RESUELTO**`

---

## 1. QUÉ HICE

1. **El guard guarda el destino:** `authGuard` arma el `UrlTree` del login con
   `queryParams: { returnUrl: state.url }`, conservando la URL completa pedida (ruta + query + fragmento),
   no solo la ruta.
2. **Una lista blanca, porque el parámetro es entrada no confiable:** `returnUrlSeguro`
   (`core/utils/return-url.util.ts`) acepta SOLO rutas internas: rechaza destinos absolutos (`https://…`),
   relativos al protocolo (`//otro-sitio`, `/\otro-sitio`, cualquier barra invertida), caracteres de
   control y las propias pantallas de sesión (`/auth/…`, que serían un bucle).
3. **El destino se aplica al final del login:** `AuthService.login(data, returnUrl?)` navega con
   `navigateByUrl` al destino válido y solo si no lo hay cae al destino por rol de siempre.
   `AuthService.register(data, returnUrl?)` hace lo mismo.
4. **El viaje completo en la interfaz:** el login lee `?returnUrl=` del `ActivatedRoute` y lo pasa al
   servicio; el enlace «Regístrate aquí» lo arrastra al registro y el de «Inicia Sesión» lo devuelve al
   login (quien escanea el QR por primera vez todavía no tiene cuenta).
5. **27 casos nuevos** que fijan la regla, repartidos entre la utilidad (12), el guard (5, sobre un
   `Router` real) y el servicio (10).

## 2. ARCHIVOS TOCADOS (`git diff --stat`, literal)

```
 AUDITORIA_HALLAZGOS.md                             |  23 ++-
 docs/MATRIZ_CUMPLIMIENTO.md                        |   4 +-
 .../src/app/auth/auth.service.spec.ts              | 195 +++++++++++++++++++++
 frontend-barberias/src/app/auth/auth.service.ts    |  32 +++-
 .../src/app/auth/login/login.component.ts          |  24 ++-
 .../src/app/auth/register/register.component.ts    |  21 ++-
 .../src/app/core/guards/auth.guard.spec.ts         |  87 +++++++++
 .../src/app/core/guards/auth.guard.ts              |  16 +-
 .../src/app/core/utils/return-url.util.spec.ts     |  63 +++++++
 .../src/app/core/utils/return-url.util.ts          |  68 +++++++
 reporte-h75-return-url-login.md                    | 162 +++++++++++++++++
 11 files changed, 675 insertions(+), 20 deletions(-)
```

## 3. TEST ROJO (antes del fix, salida literal)

Con la regla vieja restaurada (el guard creando el `UrlTree` sin `queryParams` y el servicio ignorando el
destino pedido), conservando las firmas para que los specs compilen y fallen por aserción y no por tipo:

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯
 FAIL   frontend-barberias  src/app/auth/auth.service.spec.ts > AuthService · H75 (el destino pedido sobrevive al login) > vuelve a la ruta pedida cuando el login trae un returnUrl válido
AssertionError: expected "navigateByUrl" to be called with arguments: [ '/unirse/imperial-ab12' ]
 FAIL   frontend-barberias  src/app/auth/auth.service.spec.ts > AuthService · H75 (el destino pedido sobrevive al login) > el destino pedido manda sobre el destino por rol
AssertionError: expected "navigateByUrl" to be called with arguments: [ '/unirse/imperial-ab12' ]
 FAIL   frontend-barberias  src/app/auth/auth.service.spec.ts > AuthService · H75 (el destino pedido sobrevive al login) > conserva la query de la ruta pedida
AssertionError: expected "navigateByUrl" to be called with arguments: [ '/unirse/imperial-ab12?desde=qr' ]
 FAIL   frontend-barberias  src/app/core/guards/auth.guard.spec.ts > authGuard · H75 (la ruta pedida sobrevive al login) > manda al login y guarda la ruta pedida en returnUrl
AssertionError: expected undefined to be '/unirse/imperial-ab12' // Object.is equality
 FAIL   frontend-barberias  src/app/core/guards/auth.guard.spec.ts > authGuard · H75 (la ruta pedida sobrevive al login) > conserva la query y el fragmento de la ruta pedida
AssertionError: expected undefined to be '/reservar?sede=imperial&paso=2#horari…' // Object.is equality
 FAIL   frontend-barberias  src/app/core/guards/auth.guard.spec.ts > authGuard · H75 (la ruta pedida sobrevive al login) > la ruta no se pierde al codificar la URL de login y sigue siendo válida al volver
AssertionError: expected undefined to be '/unirse/imperial-ab12' // Object.is equality
 Test Files  2 failed | 8 passed (10)
      Tests  6 failed | 83 passed (89)
```

Los seis rojos son el hallazgo entero: el guard no guardaba nada (`undefined`) y el servicio navegaba por
rol, incluido el caso del admin con destino pedido.

## 4. TEST VERDE (después, salida literal)

```
 Test Files  10 passed (10)
      Tests  89 passed (89)
TEST_EXIT=0
```

## 5. SUITE COMPLETA

- **Frontend, pruebas:** `Test Files 10 passed (10)` · `Tests 89 passed (89)` · `EXIT=0`
  (eran 62 en 7 archivos; los 3 archivos nuevos aportan 27).
- **Frontend, lint:** `Found 0 warnings and 0 errors.` (`LINT_EXIT=0`).
- **Frontend, build:** `Application bundle generation complete. [8.620 seconds]` (`BUILD_EXIT=0`).
- **Backend:** sin cambios. No se ejecuta su suite porque esta tarea no toca ni una línea del backend
  (`git diff --stat` lo confirma: todo el diff está en `frontend-barberias/` y en la documentación).

## 6. CRITERIOS DE ACEPTACIÓN

- [x] **Fase 1 · rama.** `fix/h75-return-url-login` creada con el árbol limpio. **Base:
      `feat/e3-12-enlace-qr`, no `main`** — ver la decisión 1: el registro de H75 y la propia ruta
      `/unirse/:enlaceUnico` no existen en `main` todavía.
- [x] **Fase 2 · el guard captura la URL intentada.** `state.url` viaja como `returnUrl` en el
      `createUrlTree`. Evidencia: los 5 casos de `auth.guard.spec.ts`, con el viaje de ida y vuelta
      (`serializeUrl` → `parseUrl`) comprobado sobre el `Router` real.
- [x] **Fase 2 · el destino se pasa al punto de entrada de la sesión.** `LoginComponent` lo lee de la query
      y lo entrega a `AuthService.login`; el registro hace lo mismo.
- [x] **Fase 2 · el retorno navega al destino o al dashboard por defecto.** `navigateByUrl(destino)` con
      `destino` validado; sin destino válido se conserva el comportamiento de siempre (cliente `/`,
      admin con sede `/admin/agenda`, admin sin sede `/barberias`). Evidencia: los 4 casos de «fallback» de
      `auth.service.spec.ts`.
- [x] **Fase 2 · el parámetro no puede sacar a nadie de la aplicación.** `returnUrlSeguro` es lista blanca
      de rutas internas; los casos de `https://otro-sitio`, `//otro-sitio` y `/auth/login` caen al destino
      por rol.
- [x] **Fase 3 · tests unitarios del guard y del servicio.** 15 casos nuevos entre los dos, más 12 de la
      utilidad; el rojo de §3 está medido ANTES del arreglo y revertido después.
- [x] **Fase 3 · suite, lint y build en verde.** §5.
- [x] **Fase 3 · `AUDITORIA_HALLAZGOS.md` marca H75 como RESUELTO**, con qué se hizo, evidencia
      roja/verde, decisiones y límites. El registro estaba **truncado a media frase** (el archivo terminaba
      en «Tipo: Límite de recorrido en el clien»): se completó entero, que era el estado en el que quedó al
      abrirse.
- [x] **Fase 3 · `docs/MATRIZ_CUMPLIMIENTO.md`** actualizada donde declaraba el límite (la fila 1.10 no
      cambia de estado: sigue `OK-PROBADO`; lo que se reescribe es su «límite honesto», ahora cerrado).
- [x] **Entrega:** este informe 8.4 y `push` de la rama. **Sin merge.**

## 7. DECISIONES O DESVIACIONES

1. **La rama sale de `feat/e3-12-enlace-qr`, no de `main`.** Se comprobó contra el remoto:
   `git ls-remote origin main` → `a8339ba…`, y `git branch -a --contains 4419df7` solo lista la rama del
   QR. Es decir: **en este clon la fusión del PR del QR no existe todavía** (`origin/main` no contiene ni
   `41cdb87` ni `4419df7`). Y no da igual para esta tarea: el registro de H75 y la ruta
   `/unirse/:enlaceUnico` viven SOLO en esa rama, así que desde `main` no habría nada que marcar RESUELTO
   ni destino que conservar. Como el arreglo toca archivos que el QR no toca (`auth.guard.ts`,
   `auth.service.ts`, las dos pantallas de sesión y una utilidad nueva), esta rama se fusiona limpia en
   cualquier orden; si el PR del QR ya está aprobado, esta se apila detrás sin reescribir nada.
2. **Query y no `NavigationExtras.state`** (que era la otra forma de llevar el destino). El estado de
   navegación vive solo en memoria de esa navegación: una recarga del formulario de login —o abrirlo en
   otra pestaña— lo borraría. La query sobrevive, y por eso es justo lo que hay que validar al volver.
3. **La lista blanca es la pieza central, no un detalle.** El parámetro lo puede escribir cualquiera desde
   la barra de direcciones. Sin filtrar, `…/auth/login?returnUrl=https://otro-sitio` convierte el login en
   un trampolín hacia fuera inmediatamente después de teclear la contraseña, que es el peor momento para
   que el usuario dude de dónde está escribiendo. Se rechaza también «volver» a `/auth/…`, porque sería un
   bucle, y `//otro-sitio` con barra invertida incluida, porque el navegador lo lee como otro host aunque
   el texto no lo parezca.
4. **El destino pedido MANDA sobre el destino por rol, incluso para un admin.** La persona ya había dicho
   a dónde iba al abrir el enlace; qué puede hacer allí lo decide la pantalla de destino (que ya tiene sus
   propias reglas), no la navegación posterior al login. Queda fijado con un caso propio.
5. **Se incluyó el registro, y es una ampliación declarada del alcance pedido.** El encargo hablaba del
   login; sin tocar el registro, el escenario más probable del hallazgo —alguien que escanea un QR impreso
   y todavía no tiene cuenta— seguiría perdiendo el enlace al crear su cuenta. Son las mismas dos líneas y
   la misma utilidad que ya se estaban añadiendo.
6. **El parámetro guarda la URL completa** (con query y fragmento), no solo la ruta: la pantalla de destino
   puede necesitar sus parámetros, y perderlos sería perder el enlace por otra puerta.

## 8. HALLAZGOS NUEVOS

Ninguno nuevo. Se documentan como límites de H75 en `AUDITORIA_HALLAZGOS.md`: (a) el cableado de las dos
pantallas se verifica con lint y build, no con pruebas de componente (el mismo límite que declararon H72,
H74 y E3-12/2); (b) la redirección sin sesión de `roleGuard` no lleva `returnUrl` —hoy es inalcanzable para
un anónimo porque `authGuard` corre antes donde aparece, pero se deja escrito—; y (c) el destino viaja en la
query, así que queda en la barra de direcciones y en el historial: es una RUTA, nunca un token ni un dato
personal.

## 9. PENDIENTE O NO VERIFICADO

- **Recorrido real en navegador:** no ejecutado. La verificación es la suite (89/89), el lint y el build;
  el viaje del parámetro se comprueba en los specs sobre un `Router` real, que es lo más cerca que se puede
  estar sin pruebas de componente ni E2E de interfaz.
- **Suite E2E del backend:** no ejecutada (esta tarea no toca backend).
- **Fusión de la rama del QR en `main`:** no ocurrió en el remoto que ve este clon (decisión 1). Mientras
  siga así, esta rama lleva encima los tres commits del QR.

## 10. GIT

Rama `fix/h75-return-url-login` apilada sobre `4419df7`; `push` sin merge:

```
e958371 fix(h75): el enlace abierto sin sesión ya sobrevive al login
4419df7 chore(e3-12): silenciar el falso positivo de gitleaks en el E2E del enlace único
41cdb87 feat(e3-12): el staff comparte la invitación de su sede y el cliente entra por ella
```

`origin/feat/e3-12-enlace-qr` sigue en `4419df7` y `origin/main` en `a8339ba`: esta rama es la única que
tiene el arreglo.
```
