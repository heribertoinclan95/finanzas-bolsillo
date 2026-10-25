# Finanzas de Bolsillo — guía para Claude

App personal de finanzas de Heri para iPhone. PWA estática servida desde Cloudflare Workers (conectado a `main`; `wrangler.jsonc` publica la raíz como assets estáticos, `.assetsignore` deja fuera tests/docs, `_headers` evita caché de la app). GitHub Pages no abre con datos de Telcel. Sin build, sin frameworks, sin dependencias: HTML + CSS + JS plano.

## Reglas del proyecto

- Todo el texto de la interfaz en **español de México**, directo y corto.
- Sin dependencias ni pasos de build. Si algo pide una librería, primero intenta resolverlo en JS plano.
- Los datos del usuario viven en `localStorage` bajo la clave `finanzas-bolsillo-v1`. **Nunca cambies esa clave ni la forma de los datos sin migración**: el usuario perdería su historial. Si cambias el esquema, agrega una migración en `load()`.
- Nunca subas datos reales, URLs de Apps Script ni claves al repo.
- Al cambiar `index.html`, `styles.css`, `app.js`, `manifest.webmanifest` o íconos, **sube `VERSION` en `sw.js`** y agrega cualquier archivo nuevo a `ARCHIVOS`.
- Diseño: colores solo con los tokens de `:root` en `styles.css`, siempre con su versión oscura. Respeta `env(safe-area-inset-*)`. Probar a 390 px de ancho.
- Corre `node tests/run.js` antes de cada commit.
- Antes de cambios grandes, explica el plan en 3–5 líneas y espera aprobación.

## Modelo de datos

Capturado en el cel (`S.movs[]`, clave `finanzas-bolsillo-v1`):
```
{ id, fecha: "yyyy-mm-dd", desc, cat, monto: number>0, tipo: "Egreso"|"Ingreso", cuenta, exportado: bool, enviado?: ISO, creado: ISO }
```
Configuración (`S.cfg`, misma clave): `v` (versión, hoy 2), `cuentas[]`, `categorias[]`, `reglas{categoria: [palabras]}`, `inversion{pct, reparto, instrumentos, metas}`, `sync{url, clave}`.

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

- **Inicio** (`viewInicio` y `resumenMes` en `app.js`): solo el mes en curso, sin comparativos ni gráficas. Disponible = ingresos reales − gasto sin inversión − máx(meta de inversión, inversión realizada): la meta se aparta mientras no se invierte y, al invertir, no se descuenta dos veces. Es un margen según los registros, no el saldo bancario. El estimado (promedio de ingresos de los 3 meses anteriores con ingresos) solo aparece como referencia secundaria marcada "Estimado" cuando lo recibido es menor; el número principal nunca incluye dinero no cobrado.
- **Análisis › Inversión** (`anInversion`, con `inversionMes`, `distribucion`, `historialInversion`): arriba el mes en curso (meta = ingresos reales × %, invertido, pendiente o extra, % de cumplimiento que puede pasar de 100, sugerencias aritméticas sobre tus propias reglas) y la distribución por instrumento (objetivo, real, diferencia); abajo el historial con su filtro de año (racha, proyección a 12 meses de aportaciones sin rendimientos, meta vs invertido, diferencia, meses por debajo, por instrumento). La racha cuenta solo meses con ingresos: un mes sin ingresos no suma ni la rompe, y el mes en curso no la rompe hasta cerrar. Las metas estimadas van como serie aparte ("Meta estimada" vs "Meta registrada") en leyenda, tooltip y Ver datos; la gráfica de diferencia marca el periodo con "· meta estimada"; el indicador del periodo dice "meta estimada" o "parte estimada"; y una nota bajo los indicadores explica el supuesto. Inicio solo gana el botón "Ver detalle"; sus cálculos no cambian.
- **Más** (`viewMas`): secciones Google Sheet (enviar o copiar, conexión), Ajustes (meta de inversión, reparto, instrumentos, cuentas, categorías) y Respaldo, con el estado de sincronización siempre arriba.
- Gráficas (`lineChart`, `colChart`, `barsH`) interactivas sin librerías: el SVG lleva `data-chart` y `chartTip` dibuja el tooltip adentro con pointer events; `verDatos` agrega la tabla "Ver datos". En `barsH`, `{ drill: true }` lleva a Análisis › Categorías.

## Captura rápida

`parseQuick()` en `app.js`: el primer número es la cantidad; un `+` antes lo vuelve ingreso; el resto es la descripción; la categoría sale de `cfg.reglas` (palabra al inicio de una palabra del texto).

## Sincronización

`apps-script/Code.gs` se copia a mano en la hoja (no se despliega desde aquí). La app hace `POST` con `Content-Type: text/plain` (evita CORS previo) y `{clave, accion: "ping"|"agregar"|"leer", filas}`; `leer` devuelve Historico + Movimientos. El script deduplica por `id` en la pestaña oculta `_app_ids`.

## Dashboards (pestaña Análisis)

Replican las páginas del Power BI "Finanzas Final": Resumen General, Gastos Global (Categorías), Comparativa Global (Años), Inversión (seguimiento de la meta, ver Pantallas), más Hábitos (tasa de ahorro, gasto diario, suscripciones, lo que más se repite, día de la semana). Inversión = egresos con categoría `Inversion`; nunca se mezcla con el gasto de consumo ni se confunde aportado con valor de cartera. Las gráficas son SVG hechas a mano (`lineChart`, `colChart`, `barsH`). Con un mes elegido, Resumen agrega proyección al cierre, gasto por día y el comparativo contra el mismo mes del año anterior (antes vivían en la pestaña Mes).

`node tests/run.js datos.json [respaldo.json]` imprime un diagnóstico de inversiones (total y por año, por instrumento, descripciones y montos Sin clasificar y Por revisar, variantes de categoría que no se reconocen, filas con Tipo Ingreso) y compara los totales por año contra Power BI, cuando le pasas un JSON con filas `[fecha, desc, cat, cantidad, tipo, cuenta]` y, opcionalmente, el respaldo de la app para usar tus reglas de instrumentos. Solo lee; nunca subas esos archivos al repo (`.gitignore` los excluye).
