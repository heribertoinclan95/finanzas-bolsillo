# Finanzas de Bolsillo — guía para Claude

App personal de finanzas de Heri para iPhone. PWA estática servida desde GitHub Pages (`main`, raíz). Sin build, sin frameworks, sin dependencias: HTML + CSS + JS plano.

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

Movimiento (`S.movs[]`):
```
{ id, fecha: "yyyy-mm-dd", desc, cat, monto: number>0, tipo: "Egreso"|"Ingresos", cuenta, exportado: bool, creado: ISO }
```
Configuración (`S.cfg`): `cuentas[]`, `categorias[]`, `reglas{categoria: [palabras]}`, `inversion{pct, reparto}`, `sync{url, clave}`.

## Formato de la hoja Finanzas 2026 (no cambiar)

Columnas A–G: **Mes** (número del mes) · **Fecha** dd/mm/aa · **Descripción** en MAYÚSCULAS · **Categoría** · **Cantidad** · **Tipo** (`Egreso` o `Ingresos`, con s) · **Salió de** (ej. `Cuenta SIMPLICITY`).
Los ingresos llevan categoría `Ingreso` (sin s) y tipo `Ingresos` (con s). Esto lo lee un modelo de Power BI; cualquier variación rompe sus filtros.

## Captura rápida

`parseQuick()` en `app.js`: el primer número es la cantidad; un `+` antes lo vuelve ingreso; el resto es la descripción; la categoría sale de `cfg.reglas` (palabra al inicio de una palabra del texto).

## Sincronización

`apps-script/Code.gs` se copia a mano en la hoja (no se despliega desde aquí). La app hace `POST` con `Content-Type: text/plain` (evita CORS previo) y `{clave, accion: "ping"|"agregar", filas}`. El script deduplica por `id` en la pestaña oculta `_app_ids`.
