# Conciliación bancaria (Más › Conciliar)

Sustituye la revisión a mano del estado de cuenta contra lo registrado en Finanzas de Bolsillo. Cargas el archivo del banco, la app lo compara con todo tu historial y te dice qué falta registrar. Nada se guarda como movimiento sin que lo confirmes.

## Flujo

1. **Cargar.** Eliges la cuenta (las de Ajustes) y la tolerancia de fecha (1–10 días, por defecto 3). Cargas el CSV o `.xlsx`.
2. **Validar.** La app muestra cómo leyó el archivo: cuántos cargos y abonos, de qué fechas, qué columna usó para cada dato y las primeras filas. Si algo está mal: *Ajustar columnas* (asignación manual, formato de fecha, primera fila) o *Cargos y abonos al revés* (tarjetas que exportan los cargos en positivo). Si ya conciliaste ese mismo archivo antes, te avisa.
3. **Conciliar.** Resultados en grupos:
   - **Registrados**: ya están en la app (automático o porque los vinculaste).
   - **Faltantes**: están en el banco y no en la app. Botones *Registrar*, *Vincular*, *Ignorar*, y casillas para registrar varios de una vez con confirmación.
   - **Por revisar**: hay candidatos parecidos pero con diferencias (fecha, importe, otra cuenta) o ambigüedad (dos filas compiten). Eliges *Es este*, *No está, registrar* o *Ignorar*.
   - **Solo en la app**: registrados en esa cuenta dentro del periodo del archivo, pero sin cargo en el banco (gasto en efectivo, cuenta equivocada, cargo que el banco aún no refleja).
   - **Traspasos**: pagos de tarjeta, traspasos entre tus cuentas y retiros de cajero. No son gasto ni ingreso. *Sí es un gasto* los devuelve a Faltantes.
   - **Ignorados**: lo que decidiste no registrar. *Deshacer* los regresa.

## Qué se guarda y qué no

El archivo del banco y sus transacciones viven solo en memoria mientras la pantalla está abierta. En `localStorage`, clave `finanzas-bolsillo-conciliacion`:

```
{ v: 1, tol: 3, cuenta: "AMEX",
  decisiones: { "<huella del movimiento del banco>": { t: "v"|"i"|"g", id?: "<id del mov local>", h?: "<huella de la fila de la app>", f: "<ISO>" } },
  archivos:   { "<hash del archivo>": { cuenta, n, f: "<ISO>", nombre } } }
```

- `t: "v"` vinculado a una fila de la app (por `id` si fue capturado en el cel, y por huella `h` como respaldo cuando ya pasó a la hoja), `"i"` ignorado, `"g"` "sí es un gasto/ingreso" (anula la regla de traspaso).
- No hay importes ni descripciones: solo hashes, fechas de decisión y el nombre del archivo.
- *Limpiar decisiones* borra todo esto. Nunca toca `finanzas-bolsillo-v1` ni los movimientos.

## Huella de un movimiento

`hash(cuenta | fecha | importe | tipo | descripción normalizada | referencia del banco | ordinal)`. La descripción normalizada va en mayúsculas sin acentos ni signos. El ordinal distingue dos movimientos idénticos el mismo día (0, 1, …), así que reimportar el mismo archivo da las mismas huellas y una fila nueva al inicio no las cambia. Las filas de la hoja no dependen de su número de fila.

## Cómo decide el motor (`conciliar()` en `conciliacion.js`)

Por cada movimiento del banco se puntúan las filas de la app del mismo tipo (egreso/ingreso) dentro de la tolerancia:

| Señal | Puntos |
|---|---|
| Importe exacto | 60 |
| Importe a ≤ $1 o ≤ 1 % | 35 |
| Importe a ≤ 15 % (solo si la descripción se parece) | 15 |
| Fecha: mismo día 30, −3 por día hasta 3 días; después 18 − días | 30…8 |
| Descripción parecida (≥ 60 % de palabras) / algo parecida (≥ 30 %) | 15 / 8 |
| Otra cuenta (solo con importe exacto) | −20 y nunca automático |

- **Registrado automático** solo con importe exacto, puntaje ≥ 80 y sin ambigüedad: ninguna otra fila de la app compite por ese cargo (ni ese cargo por otra fila) con puntaje a menos de 10 puntos. Excepción: repetidos idénticos en ambos lados y en el mismo número (dos OXXO de $50 el mismo día en el banco y dos en la app) sí se emparejan.
- Puntaje ≥ 40 sin emparejar → **Por revisar** con hasta 5 candidatos y sus motivos.
- Sin candidatos → **Faltante**.
- Reglas de **Traspasos** (antes de buscar): descripción con "PAGO … TARJETA/AMEX/TDC/…", "PAGO RECIBIDO", "SU PAGO"; "TRASPASO", "ENTRE CUENTAS"; el nombre de otra de tus cuentas; "RETIRO … CAJERO/ATM". Si uno de estos sí tiene una coincidencia exacta en la app, se muestra como Registrado para que detectes el doble registro.

## Formatos admitidos

- **CSV / TXT**: delimitador detectado (`,` `;` tab `|`), comillas, BOM, UTF-8 o Windows-1252. Encabezado en cualquiera de las primeras 40 filas (los bancos ponen varias líneas de datos de la cuenta arriba). Reconoce Fecha, Concepto/Descripción, Cargo/Retiro/Débito, Abono/Depósito/Crédito, Importe/Monto, Tipo, Referencia/Folio y Saldo (se ignora). Sin encabezado, deduce por contenido.
- **XLSX**: lector propio (ZIP + XML) con descompresión nativa del navegador (`DecompressionStream`, iOS 16.4+). Cadenas compartidas, texto enriquecido, celdas con formato de fecha (se convierten a yyyy-mm-dd), varias hojas (propone la de más filas). No admite `.xls` antiguo, archivos con contraseña ni fórmulas sin valor calculado: en esos casos pide guardar como `.xlsx` normal o CSV.
- **Fechas**: `dd/mm/aa`, `dd/mm/aaaa`, `aaaa-mm-dd`, `05-OCT-2026`, `5 de octubre de 2026`, serial de Excel. Si todas las fechas permiten mes/día se asume día/mes (México); se puede forzar en *Ajustar columnas*.
- **Importes**: `$`, comas, paréntesis o guion para negativos, coma decimal.

## Validar con un estado de cuenta real

1. Exporta de tu banco un mes en CSV o `.xlsx` y cárgalo en Más › Conciliar con la cuenta correcta.
2. En *Revisa cómo se leyó* comprueba: número de movimientos, rango de fechas, total de cargos y abonos contra el estado de cuenta en PDF. Si los signos están al revés, toca el botón; si falta una columna, ajústala.
3. Concilia y revisa primero **Registrados**: deben ser los gastos que ya tenías. Luego **Faltantes** y **Por revisar**. Si un cargo legítimo cae en Traspasos, usa *Sí es un gasto*.
4. Registra uno, revisa que aparezca en Movimientos y en Inicio, y vuelve a Más › Conciliar: debe estar en Registrados. Envíalo a la hoja como siempre.
5. Carga el mismo archivo otra vez: debe avisar que ya se concilió y no proponer nada repetido.
6. Si tu banco usa nombres de columna que no se reconocen, anota el encabezado exacto y súmalo a `COLS` en `conciliacion.js` con una prueba en `tests/conciliacion.js` (con datos ficticios).

## Pruebas

`node tests/run.js` corre también `tests/conciliacion.js`: lectura CSV y XLSX, fechas e importes, detección de columnas, huellas, coincidencias exactas, fechas e importes distintos, duplicados, pendientes de sincronizar, pagos de tarjeta y traspasos, reimportación, registro individual y múltiple sin duplicar, y la forma de lo guardado.
