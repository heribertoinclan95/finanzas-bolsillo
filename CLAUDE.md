# Finanzas de Bolsillo — guía para Claude

App personal de finanzas de Heri para iPhone. PWA estática servida desde Cloudflare Workers (conectado a `main`; `wrangler.jsonc` publica la raíz como assets estáticos y `worker/index.mjs` atiende solo `/api/*`; `.assetsignore` deja fuera tests/docs/worker, `_headers` pone la CSP y evita caché de la app). La app está detrás de Cloudflare Access (correo + código) y las credenciales del Apps Script son secretos del Worker: ver `docs/SEGURIDAD.md`. GitHub Pages no abre con datos de Telcel. Sin build, sin frameworks, sin dependencias: HTML + CSS + JS plano.

## Reglas del proyecto

- Todo el texto de la interfaz en **español de México**, directo y corto.
- Sin dependencias ni pasos de build. Si algo pide una librería, primero intenta resolverlo en JS plano.
- Los datos del usuario viven en `localStorage` bajo la clave `finanzas-bolsillo-v1`. **Nunca cambies esa clave ni la forma de los datos sin migración**: el usuario perdería su historial. Si cambias el esquema, agrega una migración en `load()`.
- Nunca subas datos reales, URLs de Apps Script ni claves al repo. Los secretos del Worker (`SCRIPT_URL`, `SCRIPT_CLAVE`, `ACCESS_TEAM`, `ACCESS_AUD`, `ACCESS_EMAILS`) se cargan en Cloudflare, nunca en `vars` de `wrangler.jsonc`.
- Al cambiar `index.html`, `styles.css`, `app.js`, `conciliacion.js`, `conciliacion-ui.js`, `manifest.webmanifest` o íconos, **sube `VERSION` en `sw.js`** y agrega cualquier archivo nuevo a `ARCHIVOS`.
- Seguridad: sin `<script>` en línea en `index.html` (la CSP de `_headers` los bloquea); `sw.js` nunca intercepta `/api/` ni `/cdn-cgi/` y solo guarda respuestas 200 sin redirección; toda ruta `/api/*` del Worker exige el JWT de Access verificado completo (firma, emisor, audiencia, vigencia, correo).
- Diseño: colores solo con los tokens de `:root` en `styles.css`, siempre con su versión oscura. Respeta `env(safe-area-inset-*)`. Probar a 390 px de ancho.
- Corre `node tests/run.js` antes de cada commit.
- Antes de cambios grandes, explica el plan en 3–5 líneas y espera aprobación.

## Modelo de datos

Capturado en el cel (`S.movs[]`, clave `finanzas-bolsillo-v1`):
```
{ id, fecha: "yyyy-mm-dd", desc, cat, monto: number>0, tipo: "Egreso"|"Ingreso", cuenta, exportado: bool, enviado?: ISO, creado: ISO }
```
Configuración (`S.cfg`, misma clave): `v` (versión, hoy 3), `cuentas[]`, `categorias[]`, `reglas{categoria: [palabras]}`, `inversion{pct, reparto, instrumentos, metas}`, `sync{modo, url, clave}`. `modo` es `"worker"` (la hoja se alcanza por `/api/hoja`, sin credenciales en el cel) o `"directo"` (transición: URL y clave en el cel). La migración a v3 no borra nada: quien tenía URL y clave queda en `directo` hasta que cambie en Más; las credenciales solo se borran cuando el usuario lo pide.

- `inversion.pct` es el % vigente (lo usa Inicio). `reparto: [[nombre, fracción]]` es la distribución objetivo. `instrumentos: {nombre: [palabras]}` clasifica cada inversión por palabra completa en la descripción (sin coincidencia → "Sin clasificar"; dos o más → "Por revisar", nunca se asigna a ciegas). `metas: [{desde: "aaaa-mm", pct}]` registra desde qué mes aplica cada %; los meses anteriores al primer registro usan ese primer % y se marcan como **estimados** en pantalla.
- `ensureInversion()` completa lo que falte en `cfg.inversion` sin depender de `cfg.v` y es idempotente: así convive con otras migraciones (seguridad también sube `cfg.v`). Al cambiar el % en Ajustes, `registrarMeta()` agrega o corrige la entrada del mes en curso y nunca reescribe meses anteriores.

Copia de la hoja (`S.datos`, clave `finanzas-bolsillo-datos`, se puede borrar y volver a leer): `{ leido: ISO, filas: [[fecha, desc, cat, cantidad, tipo, cuenta]] }`.

Los dashboards usan `filas()`: filas de la hoja + capturas no enviadas + capturas enviadas después de la última lectura (`enviado > leido`). Así nada se cuenta doble.

## Formato de la hoja Finanzas 2026 (no cambiar)

Columnas A–G: **Mes** (número del mes) · **Fecha** dd/mm/aa · **Descripción** en MAYÚSCULAS · **Categoría** · **Cantidad** · **Tipo** (`Egreso` o `Ingreso`, sin s) · **Salió de** (ej. `Cuenta SIMPLICITY`).
Los ingresos llevan Tipo `Ingreso` y categoría `Ingreso`. Al leer, `normTipo`/`normCat` corrigen variantes del historial (`Ingresos`, `comida`, `SALIDA`, `Libro`…) y una fila con categoría `Ingreso` cuenta como ingreso aunque diga Egreso.

Pestañas de la hoja: `Movimientos` (año en curso, donde escribe la app) y `Historico` (2022–2025, ya limpio).

## Pantallas

Barra inferior: **Inicio** (predeterminada) · **Movimientos** · **Análisis** · **Más**.

- **Inicio** (`viewInicio` y `resumenMes` en `app.js`): solo el mes en curso, sin comparativos ni gráficas. Disponible = ingresos reales − gasto sin inversión − máx(meta de inversión, inversión realizada): la meta se aparta mientras no se invierte y, al invertir, no se descuenta dos veces. Es un margen según los registros, no el saldo bancario. El estimado (promedio de ingresos de los 3 meses anteriores con ingresos) solo aparece como referencia secundaria marcada "Estimado" cuando lo recibido es menor; el número principal nunca incluye dinero no cobrado. Bajo el número va una cuenta compacta (`explicaMargen`): ingresos − gasto sin inversión − apartado de inversión = disponible, con la causa en el texto de apoyo y una línea con el origen de los datos (hoja o cel).
- **Análisis › Inversión** (`anInversion`, con `inversionMes`, `distribucion`, `historialInversion`): arriba el mes en curso (meta = ingresos reales × %, invertido, pendiente o extra, % de cumplimiento que puede pasar de 100, sugerencias aritméticas sobre tus propias reglas) y la distribución por instrumento (objetivo, real, diferencia); abajo el historial con su filtro de año (racha, proyección a 12 meses de aportaciones sin rendimientos, meta vs invertido, diferencia, meses por debajo, por instrumento). La racha cuenta solo meses con ingresos: un mes sin ingresos no suma ni la rompe, y el mes en curso no la rompe hasta cerrar. Las metas estimadas van como serie aparte ("Meta estimada" vs "Meta registrada") en leyenda, tooltip y Ver datos; la gráfica de diferencia marca el periodo con "· meta estimada"; el indicador del periodo dice "meta estimada" o "parte estimada"; y una nota bajo los indicadores explica el supuesto. Inicio solo gana el botón "Ver detalle"; sus cálculos no cambian.
- **Más** (`viewMas`): secciones Google Sheet (enviar o copiar, conexión), Conciliar (estado de cuenta contra lo registrado, ver abajo), Ajustes (meta de inversión, reparto, instrumentos, cuentas, categorías) y Respaldo, con el estado de sincronización siempre arriba. En modo Worker, `estadoSync` muestra la sesión de Access (`S.sesion`: desconocido · activa · vencida · sin-worker) y el botón **Entrar** (`/api/entrar`) cuando venció; `cardConexion` lleva los controles de transición (Probar el Worker, Usar el Worker protegido, Volver al modo directo, Borrar credenciales).
- Gráficas (`lineChart`, `colChart`, `barsH`) interactivas sin librerías: el SVG lleva `data-chart` y `chartTip` dibuja el tooltip adentro con pointer events; `verDatos` agrega la tabla "Ver datos". En `barsH`, `{ drill: true }` lleva a Análisis › Categorías.

## Captura rápida

`parseQuick()` en `app.js`: el primer número es la cantidad; un `+` antes lo vuelve ingreso; el resto es la descripción; la categoría sale de `cfg.reglas` (palabra al inicio de una palabra del texto).

## Sincronización

`apps-script/Code.gs` se copia a mano en la hoja (no se despliega desde aquí); lee la clave de las Propiedades del script (`CLAVE`). Acciones: `{clave, accion: "ping"|"agregar"|"leer", filas}`; `leer` devuelve Historico + Movimientos. El script deduplica por `id` en la pestaña oculta `_app_ids`.

En modo Worker, `callScript` hace `POST api/hoja` (misma página) con JSON y la cabecera `X-Requested-With: XMLHttpRequest` (así Access contesta 401 y no una redirección cuando la sesión venció); el Worker verifica el JWT, agrega `clave` desde sus secretos y reenvía al Apps Script con `text/plain`. Un 401 marca la sesión como vencida; 503/404/405 marcan "sin-worker" y la app ofrece copiar y pegar. En modo directo la app sigue llamando al Apps Script como antes. Los pendientes nunca se marcan `exportado` si el envío falla. Pasos manuales de Cloudflare y Apps Script en `docs/SEGURIDAD.md`.

## Dashboards (pestaña Análisis)

Replican las páginas del Power BI "Finanzas Final": Resumen General, Gastos Global (Categorías), Comparativa Global (Años), Inversión (seguimiento de la meta, ver Pantallas), más Hábitos (tasa de ahorro, gasto diario, suscripciones, lo que más se repite, día de la semana). Inversión = egresos con categoría `Inversion`; nunca se mezcla con el gasto de consumo ni se confunde aportado con valor de cartera. Las gráficas son SVG hechas a mano (`lineChart`, `colChart`, `barsH`). Con un mes elegido, Resumen agrega proyección al cierre, gasto por día y el comparativo contra el mismo mes del año anterior (antes vivían en la pestaña Mes).

**Pendiente de la Fase 3 (inversión), al 24 de octubre de 2026:** el código y sus pruebas quedaron validados con datos sintéticos; solo falta validar los importes reales contra Google Sheets desde la app publicada. Cómo: Análisis › Inversión con Año = Todos › Ver datos (invertido por año) contra la suma de Cantidad con Tipo Egreso y Categoría Inversion por año en Historico y Movimientos, y revisar en "Por instrumento" lo que caiga en Sin clasificar o Por revisar para completar las reglas en Más › Ajustes. No hay desarrollo pendiente.

`node tests/run.js datos.json [respaldo.json]` imprime un diagnóstico de inversiones (total y por año, por instrumento, descripciones y montos Sin clasificar y Por revisar, variantes de categoría que no se reconocen, filas con Tipo Ingreso) y compara los totales por año contra Power BI, cuando le pasas un JSON con filas `[fecha, desc, cat, cantidad, tipo, cuenta]` y, opcionalmente, el respaldo de la app para usar tus reglas de instrumentos. Solo lee; nunca subas esos archivos al repo (`.gitignore` los excluye).

## Pruebas

`tests/run.js` carga `app.js` con un DOM falso, importa `worker/index.mjs` (firma JWT de prueba con WebCrypto para probar firma, emisor, audiencia, vigencia, correo, rotación de llaves, CSRF y los 503 de configuración) y corre `sw.js` con `caches` y `fetch` falsos. Lo que no se puede probar aquí (Access real, login en la PWA de iOS, modo avión) está listado en `docs/SEGURIDAD.md`. `tests/conciliacion.js` (conciliación bancaria, con datos ficticios y un .xlsx construido en la prueba) corre desde el mismo `run.js`.

## Conciliación bancaria (Más › Conciliar)

Compara un estado de cuenta (CSV o .xlsx) con `filas()` y separa: **Registrados**, **Faltantes**, **Por revisar**, **Solo en la app**, más **Traspasos** (pagos de tarjeta, traspasos entre cuentas, retiros de efectivo: no son gasto ni ingreso) e **Ignorados**. Detalle en `docs/conciliacion.md`; el diseño pendiente de PDF con IA en `docs/conciliacion-ia.md`.

- `conciliacion.js`: motor sin DOM (lectores CSV/XLSX, detección de columnas, huellas, puntaje, `conciliar()`). `conciliacion-ui.js`: vistas y eventos; app.js solo le delega los elementos con `data-cz` y le presta `filas()`, `openSheet()`, `addMov()`.
- El archivo del banco vive solo en memoria. En `localStorage` bajo `finanzas-bolsillo-conciliacion` se guardan nada más decisiones por huella (hash): `{ v: 1, tol, cuenta, decisiones: { huellaBanco: { t: "v"|"i"|"g", id?, h?, f } }, archivos: { hash: { cuenta, n, f, nombre } } }`. Sin importes ni descripciones. No toca `finanzas-bolsillo-v1`.
- La huella de un movimiento es un hash de cuenta + fecha + importe + tipo + descripción normalizada (+ referencia del banco) + ordinal entre repetidos idénticos. No depende del índice de fila de la hoja.
- Un movimiento del banco se da por **registrado** solo con importe exacto, fecha dentro de la tolerancia (1–10 días, por defecto 3) y sin otra fila que compita con puntaje parecido; lo demás va a **Por revisar**. Nunca se crea ni modifica un movimiento sin que Heri toque “Registrar” (uno) o confirme la hoja de “Registrar N”.
- Pruebas en `tests/conciliacion.js` (las corre `node tests/run.js`). Datos ficticios; nunca estados de cuenta reales en el repo.
