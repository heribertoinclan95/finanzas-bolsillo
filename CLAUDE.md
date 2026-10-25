# Finanzas de Bolsillo — guía para Claude

App personal de finanzas de Heri para iPhone. PWA estática servida desde Cloudflare Workers (conectado a `main`; `wrangler.jsonc` publica la raíz como assets estáticos y `worker/index.mjs` atiende solo `/api/*`; `.assetsignore` deja fuera tests/docs/worker, `_headers` pone la CSP y evita caché de la app). La app está detrás de Cloudflare Access (correo + código) y las credenciales del Apps Script son secretos del Worker: ver `docs/SEGURIDAD.md`. GitHub Pages no abre con datos de Telcel. Sin build, sin frameworks, sin dependencias: HTML + CSS + JS plano.

## Reglas del proyecto

- Todo el texto de la interfaz en **español de México**, directo y corto.
- Sin dependencias ni pasos de build. Si algo pide una librería, primero intenta resolverlo en JS plano.
- Los datos del usuario viven en `localStorage` bajo la clave `finanzas-bolsillo-v1`. **Nunca cambies esa clave ni la forma de los datos sin migración**: el usuario perdería su historial. Si cambias el esquema, agrega una migración en `load()`.
- Nunca subas datos reales, URLs de Apps Script ni claves al repo. Los secretos del Worker (`SCRIPT_URL`, `SCRIPT_CLAVE`, `ACCESS_TEAM`, `ACCESS_AUD`, `ACCESS_EMAILS`) se cargan en Cloudflare, nunca en `vars` de `wrangler.jsonc`.
- Al cambiar `index.html`, `styles.css`, `app.js`, `manifest.webmanifest` o íconos, **sube `VERSION` en `sw.js`** y agrega cualquier archivo nuevo a `ARCHIVOS`.
- Seguridad: sin `<script>` en línea en `index.html` (la CSP de `_headers` los bloquea); `sw.js` nunca intercepta `/api/` ni `/cdn-cgi/` y solo guarda respuestas 200 sin redirección; toda ruta `/api/*` del Worker exige el JWT de Access verificado completo (firma, emisor, audiencia, vigencia, correo).
- Diseño: colores solo con los tokens de `:root` en `styles.css`, siempre con su versión oscura. Respeta `env(safe-area-inset-*)`. Probar a 390 px de ancho.
- Corre `node tests/run.js` antes de cada commit.
- Antes de cambios grandes, explica el plan en 3–5 líneas y espera aprobación.

## Modelo de datos

Capturado en el cel (`S.movs[]`, clave `finanzas-bolsillo-v1`):
```
{ id, fecha: "yyyy-mm-dd", desc, cat, monto: number>0, tipo: "Egreso"|"Ingreso", cuenta, exportado: bool, enviado?: ISO, creado: ISO }
```
Configuración (`S.cfg`, misma clave): `v` (versión, hoy 3), `cuentas[]`, `categorias[]`, `reglas{categoria: [palabras]}`, `inversion{pct, reparto}`, `sync{modo, url, clave}`. `modo` es `"worker"` (la hoja se alcanza por `/api/hoja`, sin credenciales en el cel) o `"directo"` (transición: URL y clave en el cel). La migración a v3 no borra nada: quien tenía URL y clave queda en `directo` hasta que cambie en Más; las credenciales solo se borran cuando el usuario lo pide.

Copia de la hoja (`S.datos`, clave `finanzas-bolsillo-datos`, se puede borrar y volver a leer): `{ leido: ISO, filas: [[fecha, desc, cat, cantidad, tipo, cuenta]] }`.

Los dashboards usan `filas()`: filas de la hoja + capturas no enviadas + capturas enviadas después de la última lectura (`enviado > leido`). Así nada se cuenta doble.

## Formato de la hoja Finanzas 2026 (no cambiar)

Columnas A–G: **Mes** (número del mes) · **Fecha** dd/mm/aa · **Descripción** en MAYÚSCULAS · **Categoría** · **Cantidad** · **Tipo** (`Egreso` o `Ingreso`, sin s) · **Salió de** (ej. `Cuenta SIMPLICITY`).
Los ingresos llevan Tipo `Ingreso` y categoría `Ingreso`. Al leer, `normTipo`/`normCat` corrigen variantes del historial (`Ingresos`, `comida`, `SALIDA`, `Libro`…) y una fila con categoría `Ingreso` cuenta como ingreso aunque diga Egreso.

Pestañas de la hoja: `Movimientos` (año en curso, donde escribe la app) y `Historico` (2022–2025, ya limpio).

## Pantallas

Barra inferior: **Inicio** (predeterminada) · **Movimientos** · **Análisis** · **Más**.

- **Inicio** (`viewInicio` y `resumenMes` en `app.js`): solo el mes en curso, sin comparativos ni gráficas. Disponible = ingresos reales − gasto sin inversión − máx(meta de inversión, inversión realizada): la meta se aparta mientras no se invierte y, al invertir, no se descuenta dos veces. Es un margen según los registros, no el saldo bancario. El estimado (promedio de ingresos de los 3 meses anteriores con ingresos) solo aparece como referencia secundaria marcada "Estimado" cuando lo recibido es menor; el número principal nunca incluye dinero no cobrado.
- **Más** (`viewMas`): secciones Google Sheet (enviar o copiar, conexión), Ajustes (meta de inversión, cuentas, categorías) y Respaldo, con el estado de sincronización siempre arriba. En modo Worker, `estadoSync` muestra la sesión de Access (`S.sesion`: desconocido · activa · vencida · sin-worker) y el botón **Entrar** (`/api/entrar`) cuando venció; `cardConexion` lleva los controles de transición (Probar el Worker, Usar el Worker protegido, Volver al modo directo, Borrar credenciales).
- Gráficas (`lineChart`, `colChart`, `barsH`) interactivas sin librerías: el SVG lleva `data-chart` y `chartTip` dibuja el tooltip adentro con pointer events; `verDatos` agrega la tabla "Ver datos". En `barsH`, `{ drill: true }` lleva a Análisis › Categorías.

## Captura rápida

`parseQuick()` en `app.js`: el primer número es la cantidad; un `+` antes lo vuelve ingreso; el resto es la descripción; la categoría sale de `cfg.reglas` (palabra al inicio de una palabra del texto).

## Sincronización

`apps-script/Code.gs` se copia a mano en la hoja (no se despliega desde aquí); lee la clave de las Propiedades del script (`CLAVE`). Acciones: `{clave, accion: "ping"|"agregar"|"leer", filas}`; `leer` devuelve Historico + Movimientos. El script deduplica por `id` en la pestaña oculta `_app_ids`.

En modo Worker, `callScript` hace `POST api/hoja` (misma página) con JSON y la cabecera `X-Requested-With: XMLHttpRequest` (así Access contesta 401 y no una redirección cuando la sesión venció); el Worker verifica el JWT, agrega `clave` desde sus secretos y reenvía al Apps Script con `text/plain`. Un 401 marca la sesión como vencida; 503/404/405 marcan "sin-worker" y la app ofrece copiar y pegar. En modo directo la app sigue llamando al Apps Script como antes. Los pendientes nunca se marcan `exportado` si el envío falla. Pasos manuales de Cloudflare y Apps Script en `docs/SEGURIDAD.md`.

## Dashboards (pestaña Análisis)

Replican las páginas del Power BI "Finanzas Final": Resumen General, Gastos Global (Categorías), Comparativa Global (Años), Inversión Global, más Hábitos (tasa de ahorro, gasto diario, suscripciones, lo que más se repite, día de la semana). Inversión = egresos con categoría `Inversion`. Las gráficas son SVG hechas a mano (`lineChart`, `colChart`, `barsH`). Con un mes elegido, Resumen agrega proyección al cierre, gasto por día y el comparativo contra el mismo mes del año anterior (antes vivían en la pestaña Mes).

`node tests/run.js datos.json` compara los totales por año contra Power BI cuando le pasas un JSON con filas `[fecha, desc, cat, cantidad, tipo, cuenta]` (no lo subas al repo).

## Pruebas

`tests/run.js` carga `app.js` con un DOM falso, importa `worker/index.mjs` (firma JWT de prueba con WebCrypto para probar firma, emisor, audiencia, vigencia, correo, rotación de llaves, CSRF y los 503 de configuración) y corre `sw.js` con `caches` y `fetch` falsos. Lo que no se puede probar aquí (Access real, login en la PWA de iOS, modo avión) está listado en `docs/SEGURIDAD.md`.
