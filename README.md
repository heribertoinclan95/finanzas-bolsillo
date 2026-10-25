# Finanzas de Bolsillo

App para iPhone para registrar gastos e ingresos personales y mandarlos a la hoja **Finanzas 2026**. Es una web app instalable (PWA): vive en GitHub Pages, se agrega a la pantalla de inicio y funciona sin internet.

## Qué hace

- **Captura rápida tipo WhatsApp:** escribes `comida 145`, `uber 87` o `+11652 nómina` y se llenan cantidad, tipo y categoría.
- **Inicio:** tu margen del mes en curso en una sola pantalla: disponible para gastar, ingresos recibidos, gastos con la inversión separada, avance de la meta de inversión, gasto diario sugerido y tus últimos movimientos. Sin comparativos ni gráficas.
- **Análisis:** tus páginas de Power BI (Resumen, Categorías, Años, Inversión) más Hábitos (tasa de ahorro, gasto diario, suscripciones, gastos que más se repiten), con todo tu historial desde 2022. Las gráficas muestran el valor al tocarlas y traen un “Ver datos” con la tabla exacta.
- **Movimientos:** lista por día con filtros y buscador en todo el historial; lo capturado en el cel se edita o borra tocándolo.
- **Más:** manda los pendientes directo a Google Sheets o copia las filas para pegarlas; ahí viven también la meta de inversión, cuentas, categorías y el respaldo.
- **Conciliar (en Más):** carga el CSV o Excel de tu banco y la app separa lo que ya registraste, lo que te faltó, lo dudoso y lo que solo está en la app. Registras los faltantes con un toque, sin duplicar.
- **Respaldo:** descarga y restaura un archivo `.json` con todo.

Tus movimientos se guardan **en el iPhone** (y en tu hoja si conectas el Apps Script). Nada de tus datos se sube a este repo.

## Instalar en el iPhone

1. Abre en **Safari**: la dirección de Cloudflare Pages del proyecto (`*.pages.dev`). La copia de GitHub Pages (`heribertoinclan95.github.io/finanzas-bolsillo/`) no abre con datos de Telcel.
2. Botón **Compartir** → **Agregar a inicio** → **Agregar**.
3. Ábrela siempre desde el ícono (así queda a pantalla completa y sin barra de Safari).

> Usa siempre el ícono, no la pestaña de Safari: son almacenes distintos y los datos de una no se ven en la otra.

## Conectar con Google Sheets (opcional, recomendado)

1. Abre tu hoja **Finanzas 2026** → **Extensiones → Apps Script**.
2. Borra lo que haya y pega el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
3. Arriba del archivo revisa:
   - `HOJA`: la pestaña donde se agregan movimientos (`Movimientos`).
   - `HISTORICO`: la pestaña con años anteriores (`Historico`).
   - `CLAVE` por una clave que inventes.
4. **Implementar → Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Autoriza los permisos y copia la **URL de la aplicación web** (termina en `/exec`).
6. En la app: **Más → Google Sheet** → pega URL y clave → **Probar conexión** → **Guardar**.

Para los dashboards, importa tu historial como pestaña `Historico` (mismas columnas A–G) y en la app toca **Más → Actualizar desde la hoja**. La app vuelve a leer sola cada 3 horas al abrirla.

Desde ahí, el botón **Enviar a la hoja** agrega las filas en la primera fila vacía (columnas A–G). Si algo ya se había mandado, no se duplica.

Si cambias `Code.gs` después, publica con **Implementar → Administrar implementaciones → Editar → Versión nueva** para conservar la misma URL.

## Conciliar con tu estado de cuenta

1. Descarga de tu banco el estado de cuenta o los movimientos en **CSV** o **Excel (.xlsx)**.
2. En la app: **Más → Conciliar**, elige la cuenta, toca **Cargar estado de cuenta** y revisa que cargos y abonos se hayan leído bien (si salen al revés, toca “Cargos y abonos al revés”; si no reconoce las columnas, “Ajustar columnas”).
3. Toca **Conciliar**. Verás cuatro grupos: Registrados, Faltantes, Por revisar y Solo en la app. Los pagos de tarjeta y traspasos entre tus cuentas van aparte y no cuentan como gasto.
4. En **Faltantes**, toca **Registrar** para abrir la captura ya llena, o marca varios y confirma en “Registrar N”. También puedes **Vincular** con algo ya registrado o **Ignorar**.

El archivo no se guarda en el teléfono; solo tus decisiones, para que al volver a cargar el mismo estado de cuenta no se repita nada. Puedes borrarlas en la misma pantalla.

Para probarlo desde la computadora: `node tests/servir.js` y abre `http://localhost:8765/` en Chrome (Ctrl+Shift+M para verla a 390 px). El paso a paso está en [`docs/conciliacion.md`](docs/conciliacion.md).

## Publicar cambios

Cada push a `main` se publica solo en Cloudflare Pages (y en GitHub Pages) en 1–2 minutos. Para que el iPhone tome la versión nueva de inmediato, sube `VERSION` en `sw.js` y abre la app dos veces.

## Trabajar con Claude Code

El archivo [`CLAUDE.md`](CLAUDE.md) explica la estructura y las reglas del proyecto. Pídele a Claude cambios como "agrega una categoría Mascotas con la palabra croquetas" o "agrega un presupuesto mensual por categoría", y que haga commit y push.

## Estructura

```
index.html            esqueleto de la app y metas de iOS
styles.css            diseño (tema claro y oscuro)
app.js                toda la lógica
conciliacion.js       motor de conciliación bancaria (CSV/XLSX, huellas, emparejamiento)
conciliacion-ui.js    pantalla Más › Conciliar
sw.js                 funcionamiento sin internet
manifest.webmanifest  nombre, ícono y modo pantalla completa
icons/                íconos
apps-script/Code.gs   puente con Google Sheets
tests/                pruebas: captura rápida, formato de filas, margen de Inicio, sincronización, gráficas y conciliación
docs/                 diseño de la conciliación y de la futura lectura de PDF con IA
```

## Pruebas

```
node tests/run.js
```
