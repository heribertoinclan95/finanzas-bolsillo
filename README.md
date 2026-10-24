# Finanzas de Bolsillo

App para iPhone para registrar gastos e ingresos personales y mandarlos a la hoja **Finanzas 2026**. Es una web app instalable (PWA): vive en GitHub Pages, se agrega a la pantalla de inicio y funciona sin internet.

## Qué hace

- **Captura rápida tipo WhatsApp:** escribes `comida 145`, `uber 87` o `+11652 nómina` y se llenan cantidad, tipo y categoría.
- **Resumen del mes:** neto, ingresos, egresos, gasto por categoría, por día y por cuenta, y el 20% para invertir (CETES / GBM / Cripto).
- **Movimientos:** lista por día con filtros; toca uno para editarlo o borrarlo.
- **A la hoja:** manda los pendientes directo a Google Sheets, o copia las filas para pegarlas.
- **Respaldo:** descarga y restaura un archivo `.json` con todo.

Tus movimientos se guardan **en el iPhone** (y en tu hoja si conectas el Apps Script). Nada de tus datos se sube a este repo.

## Instalar en el iPhone

1. Abre en **Safari**: `https://heribertoinclan95.github.io/finanzas-bolsillo/`
2. Botón **Compartir** → **Agregar a inicio** → **Agregar**.
3. Ábrela siempre desde el ícono (así queda a pantalla completa y sin barra de Safari).

> Usa siempre el ícono, no la pestaña de Safari: son almacenes distintos y los datos de una no se ven en la otra.

## Conectar con Google Sheets (opcional, recomendado)

1. Abre tu hoja **Finanzas 2026** → **Extensiones → Apps Script**.
2. Borra lo que haya y pega el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
3. Arriba del archivo cambia:
   - `HOJA` por el nombre exacto de tu pestaña de gastos (por defecto `2026`).
   - `CLAVE` por una clave que inventes.
4. **Implementar → Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Autoriza los permisos y copia la **URL de la aplicación web** (termina en `/exec`).
6. En la app: pestaña **A la hoja** → pega URL y clave → **Probar conexión** → **Guardar**.

Desde ahí, el botón **Enviar a la hoja** agrega las filas en la primera fila vacía (columnas A–G). Si algo ya se había mandado, no se duplica.

Si cambias `Code.gs` después, publica con **Implementar → Administrar implementaciones → Editar → Versión nueva** para conservar la misma URL.

## Publicar cambios

Cada push a `main` actualiza GitHub Pages en 1–2 minutos. Para que el iPhone tome la versión nueva de inmediato, sube `VERSION` en `sw.js` y abre la app dos veces.

## Trabajar con Claude Code

El archivo [`CLAUDE.md`](CLAUDE.md) explica la estructura y las reglas del proyecto. Pídele a Claude cambios como "agrega una categoría Mascotas con la palabra croquetas" o "agrega un presupuesto mensual por categoría", y que haga commit y push.

## Estructura

```
index.html            esqueleto de la app y metas de iOS
styles.css            diseño (tema claro y oscuro)
app.js                toda la lógica
sw.js                 funcionamiento sin internet
manifest.webmanifest  nombre, ícono y modo pantalla completa
icons/                íconos
apps-script/Code.gs   puente con Google Sheets
tests/                pruebas de la captura rápida y del formato de filas
```

## Pruebas

```
node tests/run.js
```
