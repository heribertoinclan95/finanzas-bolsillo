# Finanzas de Bolsillo — guía para Claude

App personal de finanzas de Heri para iPhone. PWA estática servida desde Cloudflare Workers (conectado a `main`; `wrangler.jsonc` publica la raíz como assets estáticos, `.assetsignore` deja fuera tests/docs, `_headers` evita caché de la app). GitHub Pages no abre con datos de Telcel. Sin build, sin frameworks, sin dependencias: HTML + CSS + JS plano.

## Reglas del proyecto

- Todo el texto de la interfaz en **español de México**, directo y corto.
- Sin dependencias ni pasos de build. Si algo pide una librería, primero intenta resolverlo en JS plano.
- Los datos del usuario viven en `localStorage` bajo la clave `finanzas-bolsillo-v1`. **Nunca cambies esa clave ni la forma de los datos sin migración**: el usuario perdería su historial. Si cambias el esquema, agrega una migración en `load()`.
- Nunca subas datos reales, URLs de Apps Script ni claves al repo.
- Al cambiar `index.html`, `styles.css`, `app.js`, `conciliacion.js`, `conciliacion-ui.js`, `manifest.webmanifest` o íconos, **sube `VERSION` en `sw.js`** y agrega cualquier archivo nuevo a `ARCHIVOS`.
- Diseño: colores solo con los tokens de `:root` en `styles.css`, siempre con su versión oscura. Respeta `env(safe-area-inset-*)`. Probar a 390 px de ancho.
- Corre `node tests/run.js` antes de cada commit.
- Antes de cambios grandes, explica el plan en 3–5 líneas y espera aprobación.

## Modelo de datos

Capturado en el cel (`S.movs[]`, clave `finanzas-bolsillo-v1`):
```
{ id, fecha: "yyyy-mm-dd", desc, cat, monto: number>0, tipo: "Egreso"|"Ingreso", cuenta, exportado: bool, enviado?: ISO, creado: ISO }
```
Configuración (`S.cfg`, misma clave): `v` (versión, hoy 2), `cuentas[]`, `categorias[]`, `reglas{categoria: [palabras]}`, `inversion{pct, reparto}`, `sync{url, clave}`.

Copia de la hoja (`S.datos`, clave `finanzas-bolsillo-datos`, se puede borrar y volver a leer): `{ leido: ISO, filas: [[fecha, desc, cat, cantidad, tipo, cuenta]] }`.

Los dashboards usan `filas()`: filas de la hoja + capturas no enviadas + capturas enviadas después de la última lectura (`enviado > leido`). Así nada se cuenta doble.

## Formato de la hoja Finanzas 2026 (no cambiar)

Columnas A–G: **Mes** (número del mes) · **Fecha** dd/mm/aa · **Descripción** en MAYÚSCULAS · **Categoría** · **Cantidad** · **Tipo** (`Egreso` o `Ingreso`, sin s) · **Salió de** (ej. `Cuenta SIMPLICITY`).
Los ingresos llevan Tipo `Ingreso` y categoría `Ingreso`. Al leer, `normTipo`/`normCat` corrigen variantes del historial (`Ingresos`, `comida`, `SALIDA`, `Libro`…) y una fila con categoría `Ingreso` cuenta como ingreso aunque diga Egreso.

Pestañas de la hoja: `Movimientos` (año en curso, donde escribe la app) y `Historico` (2022–2025, ya limpio).

## Pantallas

Barra inferior: **Inicio** (predeterminada) · **Movimientos** · **Análisis** · **Más**.

- **Inicio** (`viewInicio` y `resumenMes` en `app.js`): solo el mes en curso, sin comparativos ni gráficas. Disponible = ingresos reales − gasto sin inversión − máx(meta de inversión, inversión realizada): la meta se aparta mientras no se invierte y, al invertir, no se descuenta dos veces. Es un margen según los registros, no el saldo bancario. El estimado (promedio de ingresos de los 3 meses anteriores con ingresos) solo aparece como referencia secundaria marcada "Estimado" cuando lo recibido es menor; el número principal nunca incluye dinero no cobrado.
- **Más** (`viewMas`): secciones Google Sheet (enviar o copiar, conexión), Conciliar (estado de cuenta contra lo registrado, ver abajo), Ajustes (meta de inversión, cuentas, categorías) y Respaldo, con el estado de sincronización siempre arriba.
- Gráficas (`lineChart`, `colChart`, `barsH`) interactivas sin librerías: el SVG lleva `data-chart` y `chartTip` dibuja el tooltip adentro con pointer events; `verDatos` agrega la tabla "Ver datos". En `barsH`, `{ drill: true }` lleva a Análisis › Categorías.

## Captura rápida

`parseQuick()` en `app.js`: el primer número es la cantidad; un `+` antes lo vuelve ingreso; el resto es la descripción; la categoría sale de `cfg.reglas` (palabra al inicio de una palabra del texto).

## Sincronización

`apps-script/Code.gs` se copia a mano en la hoja (no se despliega desde aquí). La app hace `POST` con `Content-Type: text/plain` (evita CORS previo) y `{clave, accion: "ping"|"agregar"|"leer", filas}`; `leer` devuelve Historico + Movimientos. El script deduplica por `id` en la pestaña oculta `_app_ids`.

## Dashboards (pestaña Análisis)

Replican las páginas del Power BI "Finanzas Final": Resumen General, Gastos Global (Categorías), Comparativa Global (Años), Inversión Global, más Hábitos (tasa de ahorro, gasto diario, suscripciones, lo que más se repite, día de la semana). Inversión = egresos con categoría `Inversion`. Las gráficas son SVG hechas a mano (`lineChart`, `colChart`, `barsH`). Con un mes elegido, Resumen agrega proyección al cierre, gasto por día y el comparativo contra el mismo mes del año anterior (antes vivían en la pestaña Mes).

`node tests/run.js datos.json` compara los totales por año contra Power BI cuando le pasas un JSON con filas `[fecha, desc, cat, cantidad, tipo, cuenta]` (no lo subas al repo).

## Conciliación bancaria (Más › Conciliar)

Compara un estado de cuenta (CSV o .xlsx) con `filas()` y separa: **Registrados**, **Faltantes**, **Por revisar**, **Solo en la app**, más **Traspasos** (pagos de tarjeta, traspasos entre cuentas, retiros de efectivo: no son gasto ni ingreso) e **Ignorados**. Detalle en `docs/conciliacion.md`; el diseño pendiente de PDF con IA en `docs/conciliacion-ia.md`.

- `conciliacion.js`: motor sin DOM (lectores CSV/XLSX, detección de columnas, huellas, puntaje, `conciliar()`). `conciliacion-ui.js`: vistas y eventos; app.js solo le delega los elementos con `data-cz` y le presta `filas()`, `openSheet()`, `addMov()`.
- El archivo del banco vive solo en memoria. En `localStorage` bajo `finanzas-bolsillo-conciliacion` se guardan nada más decisiones por huella (hash): `{ v: 1, tol, cuenta, decisiones: { huellaBanco: { t: "v"|"i"|"g", id?, h?, f } }, archivos: { hash: { cuenta, n, f, nombre } } }`. Sin importes ni descripciones. No toca `finanzas-bolsillo-v1`.
- La huella de un movimiento es un hash de cuenta + fecha + importe + tipo + descripción normalizada (+ referencia del banco) + ordinal entre repetidos idénticos. No depende del índice de fila de la hoja.
- Un movimiento del banco se da por **registrado** solo con importe exacto, fecha dentro de la tolerancia (1–10 días, por defecto 3) y sin otra fila que compita con puntaje parecido; lo demás va a **Por revisar**. Nunca se crea ni modifica un movimiento sin que Heri toque “Registrar” (uno) o confirme la hoja de “Registrar N”.
- Pruebas en `tests/conciliacion.js` (las corre `node tests/run.js`). Datos ficticios; nunca estados de cuenta reales en el repo.
