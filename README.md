# Finanzas de Bolsillo

App para iPhone para registrar gastos e ingresos personales y mandarlos a la hoja **Finanzas 2026**. Es una web app instalable (PWA): vive en Cloudflare Workers detrás de Cloudflare Access, se agrega a la pantalla de inicio y funciona sin internet.

## Qué hace

- **Captura rápida tipo WhatsApp:** escribes `comida 145`, `uber 87` o `+11652 nómina` y se llenan cantidad, tipo y categoría.
- **Inicio:** tu margen del mes en curso en una sola pantalla: disponible para gastar, ingresos recibidos, gastos con la inversión separada, avance de la meta de inversión, gasto diario sugerido y tus últimos movimientos. Sin comparativos ni gráficas.
- **Análisis:** tus páginas de Power BI (Resumen, Categorías, Años, Inversión) más Hábitos (tasa de ahorro, gasto diario, suscripciones, gastos que más se repiten), con todo tu historial desde 2022. Las gráficas muestran el valor al tocarlas y traen un “Ver datos” con la tabla exacta.
- **Movimientos:** lista por día con filtros y buscador en todo el historial; lo capturado en el cel se edita o borra tocándolo.
- **Más:** manda los pendientes directo a Google Sheets o copia las filas para pegarlas; ahí viven también la meta de inversión, cuentas, categorías y el respaldo.
- **Respaldo:** descarga y restaura un archivo `.json` con todo.

Tus movimientos se guardan **en el iPhone** (y en tu hoja si conectas el Apps Script). Nada de tus datos se sube a este repo.

## Instalar en el iPhone

1. Abre en **Safari**: la dirección de Cloudflare del proyecto (`finanzas-bolsillo.*.workers.dev`). Cloudflare Access te pide tu correo y un código de un solo uso; la sesión dura un mes. La copia de GitHub Pages se apaga al terminar la transición (no abre con datos de Telcel y no pasa por Access).
2. Botón **Compartir** → **Agregar a inicio** → **Agregar**.
3. Ábrela siempre desde el ícono (así queda a pantalla completa y sin barra de Safari).

> Usa siempre el ícono, no la pestaña de Safari: son almacenes distintos y los datos de una no se ven en la otra.

## Conectar con Google Sheets

La app no habla directo con el Apps Script: lo hace un Worker de Cloudflare (`worker/index.mjs`) que guarda la URL y la clave como secretos del servidor y solo atiende a quien tiene sesión de Cloudflare Access. Los pasos completos, en orden, están en [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md). En resumen:

1. Abre tu hoja **Finanzas 2026** → **Extensiones → Apps Script**.
2. Borra lo que haya y pega el contenido de [`apps-script/Code.gs`](apps-script/Code.gs). Revisa `HOJA` (`Movimientos`) e `HISTORICO` (`Historico`).
3. Configuración del proyecto → **Propiedades del script** → agrega `CLAVE` con una clave larga que inventes (32 caracteres o más).
4. **Implementar → Nueva implementación** → tipo **Aplicación web** → Ejecutar como: **Yo** · Quién tiene acceso: **Cualquier usuario**. Copia la **URL de la aplicación web** (termina en `/exec`).
5. En Cloudflare carga los secretos del Worker (`SCRIPT_URL`, `SCRIPT_CLAVE`, `ACCESS_TEAM`, `ACCESS_AUD`, `ACCESS_EMAILS`) y activa Access para el Worker.
6. En la app: **Más → Google Sheet → Probar conexión**. Si el teléfono venía del modo anterior (URL y clave guardadas), ahí mismo aparece **Usar el Worker protegido** y, cuando confirmes que funciona, **Borrar credenciales del teléfono**.

Para los dashboards, importa tu historial como pestaña `Historico` (mismas columnas A–G) y en la app toca **Más → Actualizar desde la hoja**. La app vuelve a leer sola cada 3 horas al abrirla.

Desde ahí, el botón **Enviar a la hoja** agrega las filas en la primera fila vacía (columnas A–G). Si algo ya se había mandado, no se duplica.

Si cambias `Code.gs` después, publica con **Implementar → Administrar implementaciones → Editar → Versión nueva** para conservar la misma URL.

## Publicar cambios

Cada push a `main` se publica solo en Cloudflare Workers en 1–2 minutos (assets estáticos más el Worker de `/api/*`). Para que el iPhone tome la versión nueva de inmediato, sube `VERSION` en `sw.js` y abre la app dos veces. Los secretos del Worker se configuran una vez en el panel de Cloudflare y sobreviven a los despliegues; nunca van en el repo.

## Trabajar con Claude Code

El archivo [`CLAUDE.md`](CLAUDE.md) explica la estructura y las reglas del proyecto. Pídele a Claude cambios como "agrega una categoría Mascotas con la palabra croquetas" o "agrega un presupuesto mensual por categoría", y que haga commit y push.

## Estructura

```
index.html            esqueleto de la app y metas de iOS
styles.css            diseño (tema claro y oscuro)
app.js                toda la lógica
sw.js                 funcionamiento sin internet (no toca /api ni el login de Access)
manifest.webmanifest  nombre, ícono y modo pantalla completa
icons/                íconos
_headers              CSP, cabeceras de seguridad y sin caché para la app
wrangler.jsonc        configuración de Cloudflare Workers (assets + Worker, sin secretos)
worker/index.mjs      Worker: verifica la sesión de Cloudflare Access y reenvía al Apps Script con los secretos
apps-script/Code.gs   puente con Google Sheets (clave en Propiedades del script)
docs/SEGURIDAD.md     qué protege, pasos manuales en Cloudflare y Apps Script, offline y validaciones pendientes
tests/                pruebas: captura rápida, formato de filas, margen de Inicio, sincronización, Worker, service worker y gráficas
```

## Pruebas

```
node tests/run.js
```
