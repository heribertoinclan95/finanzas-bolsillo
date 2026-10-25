# Seguridad de Finanzas de Bolsillo

Guía para proteger la app con Cloudflare Access y sacar las credenciales del Apps Script del teléfono.
Nada de lo que describe esta guía se activa solo: los pasos manuales en Cloudflare y en Google los haces tú,
en el orden indicado, y la app sigue funcionando igual mientras tanto.

## Qué protege y qué no

| Amenaza | Antes | Después |
|---|---|---|
| Cualquiera abre la app desde internet | Sí, con la URL | No: Cloudflare Access pide tu correo y un código |
| Alguien con la URL del Apps Script lee o escribe en la hoja | Con la clave, sí | La URL y la clave viven solo en el Worker; la API exige sesión de Access y, además, el Worker verifica el JWT completo |
| La clave viaja en cada envío desde el iPhone | Sí, en claro dentro del JSON | No: el iPhone manda `{accion, filas}` sin credenciales |
| Un sitio ajeno usa tu cookie de Access para llamar a la API (CSRF) | No aplicaba | Bloqueado: la API exige `Content-Type: application/json`, `X-Requested-With` y origen propio |
| Un script inyectado en la página | Sin CSP | CSP estricta: solo scripts propios, sin scripts en línea |
| El login de Access se guarda en caché como si fuera la app | Posible | El service worker solo guarda respuestas 200 sin redirección y nunca toca `/api/` ni `/cdn-cgi/` |
| **Datos ya guardados en el iPhone** (movimientos y copia de la hoja) | Protegidos solo por el bloqueo del teléfono | **Igual.** Access no protege lo que ya está en el teléfono: la app abre sin internet desde la caché y muestra los datos locales aunque la sesión haya vencido. Esto es por diseño del funcionamiento offline. |
| La URL `/exec` del Apps Script sigue siendo pública | Sí | Sí, por diseño de Google (el Worker necesita llamarla). La barrera es la clave larga que solo conoce el Worker. Rótala al terminar la transición. |

Candado local (Face ID, passkey o PIN): fuera de esta fase por decisión. Un candado con Face ID sin cifrado es
bloqueo visual, no protección de datos.

## Cómo queda la arquitectura

```
iPhone (PWA)  ──POST /api/hoja {accion, filas}──▶  Worker (worker/index.mjs)  ──POST {clave, accion, filas}──▶  Apps Script  ──▶  Hoja
     │  cookie CF_Authorization                        │ verifica JWT de Access: firma RS256, iss, aud, exp, correo
     │  (la pone Cloudflare Access al entrar)          │ secretos: SCRIPT_URL, SCRIPT_CLAVE, ACCESS_TEAM, ACCESS_AUD, ACCESS_EMAILS
     └── sin internet: abre desde la caché del service worker y guarda todo en localStorage
```

- `wrangler.jsonc`: `main` apunta al Worker, los assets se sirven con el binding `ASSETS` y `run_worker_first: ["/api/*"]`
  manda al Worker solo las rutas de la API. Todo lo demás se sirve como archivo estático, igual que antes.
- Rutas del Worker: `POST /api/hoja` (puente), `GET /api/yo` (correo y vencimiento de la sesión), `GET /api/entrar`
  (fuerza el login de Access y regresa a la app).
- Sin secretos configurados, `/api/*` responde 503 con un mensaje claro y la app muestra "El Worker protegido aún no está
  configurado: puedes copiar y pegar las filas". Sin JWT válido responde 401 y jamás llama al Apps Script.
- `_headers`: CSP y cabeceras de seguridad para toda la app. El registro del service worker se movió de `index.html` a
  `app.js` porque la CSP no permite scripts en línea.

### Modos de conexión y migración (reversible)

La configuración del teléfono pasa a `v: 3` con `sync: { modo, url, clave }`:

- Quien ya tenía URL y clave guardadas queda en **modo directo**: todo funciona exactamente como antes y **nada se borra**.
- Una instalación nueva arranca en **modo Worker** (sin credenciales en el teléfono).
- En **Más › Google Sheet**, el modo directo muestra el bloque "Modo protegido (nuevo)" con **Probar el Worker** y
  **Usar el Worker protegido**. El cambio solo se hace si la prueba (`ping` por el Worker) responde bien.
- Ya en modo Worker, mientras el teléfono conserve URL y clave aparecen **Volver al modo directo** (reversible) y
  **Borrar credenciales del teléfono** (dos toques; este sí es definitivo).
- El respaldo `.json` nunca incluye URL ni clave.

Cuando la transición termine, una versión posterior quitará el modo directo del código y los hosts de Google de la CSP.

## Pasos manuales en Cloudflare (en este orden)

Los pasos 1 a 4 no cambian nada para el iPhone: la app sigue en modo directo. El cambio real ocurre en el paso 6.

1. **Zero Trust.** En el panel de Cloudflare entra a Zero Trust y, si es la primera vez, elige un nombre de equipo.
   Tu dominio de equipo queda como `https://<equipo>.cloudflareaccess.com` (anótalo: es `ACCESS_TEAM`).
   En Settings → Authentication → Login methods confirma que **One-time PIN** está activo; no agregues otro método.
   En Settings → Authentication → Global session duration pon **1 month**.
2. **Proteger el Worker.** Workers & Pages → `finanzas-bolsillo` → pestaña **Access** → **Protect this Worker behind
   Access** → **All traffic**. Esto cubre `workers.dev`, previews y cualquier dominio o ruta del Worker: no queda URL de
   Cloudflare sin protección.
3. **Ajustar la aplicación de Access.** Zero Trust → Access → Applications → la aplicación que se creó en el paso 2:
   - Policies: una sola política **Allow** con Include → **Emails** → tu correo. Borra cualquier otra regla.
   - Session duration de la aplicación y de la política: **1 month**.
   - Login methods: solo One-time PIN.
   - Additional settings → copia el **Application Audience (AUD) Tag** (es `ACCESS_AUD`).
4. **Secretos del Worker.** Workers & Pages → `finanzas-bolsillo` → Settings → Variables and Secrets → Add, tipo
   **Secret**, uno por uno:
   - `ACCESS_TEAM` = `https://<equipo>.cloudflareaccess.com`
   - `ACCESS_AUD` = el AUD tag del paso 3
   - `ACCESS_EMAILS` = tu correo (si algún día hay más, separados por coma)
   - `SCRIPT_URL` = la URL `/exec` del Apps Script
   - `SCRIPT_CLAVE` = la clave que lee `Code.gs` (ver abajo). Durante la transición, la misma que ya usa el teléfono.
   Alternativa desde la PC con la cuenta iniciada: `npx wrangler secret put NOMBRE` en la carpeta del repo.
5. **Desplegar.** Mezclar la rama `seguridad-access-worker` en `main` y hacer push. Cloudflare publica el Worker nuevo con
   los assets. Verifica desde la PC (sin sesión) que todo rebota al login:
   ```
   curl -sI https://finanzas-bolsillo.<subdominio>.workers.dev/ | head -5
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://finanzas-bolsillo.<subdominio>.workers.dev/api/hoja -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" -d "{\"accion\":\"ping\"}"
   ```
   Esperado: la primera responde `302` con `Location:` hacia `<equipo>.cloudflareaccess.com`; la segunda `302` o `401`,
   nunca JSON de la hoja. Prueba también la URL de preview de la versión (Deployments → Preview) y debe rebotar igual.
6. **Cambiar el iPhone al Worker.** Abre la app desde el ícono. Access pedirá tu correo y el código. Ya adentro:
   Más › Google Sheet → **Probar el Worker** (debe decir "Conectada a la hoja … por el Worker") → **Usar el Worker
   protegido** → manda un movimiento de prueba con **Enviar** y revisa que llegó a la hoja.
7. **Rotar la clave.** Con el teléfono ya en modo Worker: genera una clave nueva de 32 caracteres o más, ponla en
   Apps Script (ver abajo) y luego actualiza el secreto `SCRIPT_CLAVE` del Worker. A partir de aquí la clave vieja, que
   estuvo en el teléfono, ya no sirve.
8. **Borrar credenciales del teléfono.** Más › Google Sheet → **Borrar credenciales del teléfono** (dos toques).
9. **Apagar GitHub Pages**, solo después de confirmar que Cloudflare funciona: repositorio → Settings → Pages →
   Source: None. Es una copia pública de la app que no pasa por Access. Sin credenciales en el código solo expone
   la app vacía, pero no tiene por qué seguir publicada.

### Apps Script: clave en Propiedades del script y versión nueva

`Code.gs` ya no lleva la clave en el código: la lee de las Propiedades del script y, si no existe, usa la constante de
respaldo `CLAVE_RESPALDO`.

1. Hoja Finanzas 2026 → Extensiones → Apps Script → Configuración del proyecto (engrane) → **Propiedades del script** →
   Agregar: nombre `CLAVE`, valor la clave (primero la que ya usas; en el paso 7 la nueva).
2. Pega el `Code.gs` nuevo del repo y guarda.
3. **Implementar → Administrar implementaciones → Editar (lápiz) → Versión: Nueva versión → Implementar.** Así la URL
   `/exec` no cambia. "Ejecutar como: Yo" y "Acceso: Cualquier usuario" se quedan igual: el Worker necesita llamarlo.

## Sin internet y recuperación de conexión

- **Abrir y capturar sin internet:** igual que siempre. El service worker sirve la app desde la caché y los
  movimientos se guardan en el iPhone. Cloudflare Access no interviene porque no hay red.
- **Lo que se ve sin internet con la sesión vencida:** todo lo local (movimientos y la copia de la hoja). Access no
  protege el contenido del teléfono; solo el bloqueo del iPhone lo hace.
- **Vuelve el internet, sesión vigente:** Enviar y Actualizar funcionan igual que antes.
- **Vuelve el internet, sesión vencida:** la app manda `X-Requested-With`, así que Access responde 401 en vez de
  redirigir. La app muestra "Tu sesión de Cloudflare venció" con el botón **Entrar**, que lleva a `/api/entrar`, Access
  pide el código y regresa a la app. Los pendientes quedan marcados como pendientes: nada se pierde ni se duplica (la
  deduplicación por `id` sigue en el Apps Script).
- **Abrir con internet y sesión vencida:** la navegación va a la página de login de Access y regresa. El service worker
  no guarda esa redirección, así que la caché no se ensucia.
- La cookie de Access la pone el servidor (HttpOnly), así que no la toca el límite de 7 días de Safari, y las web apps de
  la pantalla de inicio están exentas de esa limpieza de todos modos.

## Lo que falta validar (no se puede desde el repo)

**En Cloudflare, con tu cuenta:**
- Que `workers.dev`, la URL de preview y `/api/hoja` respondan 302 o 401 sin sesión (paso 5).
- Que `/api/yo` con sesión devuelva tu correo (abre `https://…workers.dev/api/yo` en el navegador con sesión iniciada).
- Que Workers Builds acepte `run_worker_first` como lista (requiere Wrangler 4.20 o más nuevo; el build de Cloudflare
  usa la versión actual).

**En el iPhone:**
- Que el login por código complete **dentro de la PWA instalada** y regrese a la app. Es el punto con más riesgo: iOS a
  veces abre la redirección a otro origen en un navegador interno que no comparte cookies. Si falla, plan B: proteger
  solo la ruta `/api/*` (Zero Trust → Access → Applications → aplicación self-hosted con path `/api`) en vez de todo el
  Worker, iniciar sesión en Safari y volver a instalar.
- Que la sesión dure el mes y no pida código a cada rato.
- Modo avión: abrir, capturar, cerrar, abrir de nuevo; volver a conectar y Enviar.
- Forzar sesión vencida (Zero Trust → Logs → Users → Revoke) y comprobar el flujo de "Entrar" con pendientes.
- Que la CSP no bloquee nada: abrir la app en Safari de la Mac con el inspector conectado al iPhone y revisar la consola.

## Candado visual al abrir (Más › Ajustes)

Opcional. Una contraseña validada en el teléfono (PBKDF2 con sal, 100 000 iteraciones, WebCrypto) que se pide al abrir la app y al
volver tras 5 minutos en segundo plano. El formulario lleva usuario y contraseña estándar para que Bitwarden la guarde y la autollene.

- Es un **candado visual**: evita que alguien con tu teléfono en la mano abra la app. **No cifra los datos**: lo guardado lo protege
  el bloqueo del iPhone y la entrada desde internet la protege Cloudflare Access. Access sigue igual con o sin candado.
- El hash nunca va en el respaldo; el candado es de cada teléfono.
- Si olvidas la contraseña y no está en Bitwarden: borra la app de la pantalla de inicio y vuelve a instalarla. Pierdes solo lo
  capturado y no enviado; la hoja es la fuente de verdad. Por eso conviene mandar los pendientes antes de activarlo.

## Cómo revertir

- Si Access da problemas: Workers & Pages → `finanzas-bolsillo` → Access → desactivar la protección. La app sigue
  funcionando y, si el teléfono aún está en modo directo, nada cambia para el envío.
- Si el Worker falla: la app en modo directo no lo usa; en modo Worker, toca **Volver al modo directo** mientras el
  teléfono conserve las credenciales.
- El código se revierte con `git revert` del commit de seguridad; el formato de `localStorage` v3 es compatible con la
  versión anterior (solo agrega `sync.modo`).
