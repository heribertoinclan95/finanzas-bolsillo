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
- **Cruce de periodo**: solo se comparan filas de la app entre la primera y la última fecha del archivo ± tolerancia. Una fila de la app anterior o posterior a ese rango (compra del 29/09 que el banco aplicó el 01/10) nunca se da por registrada sola: va a Por revisar con la etiqueta "fuera del periodo del archivo" y la confirmas con *Es este*. Así un cargo nuevo al inicio del mes no se esconde detrás de un gasto que ya cubrió el estado de cuenta anterior.
- Puntaje ≥ 40 sin emparejar → **Por revisar** con hasta 5 candidatos y sus motivos.
- Sin candidatos → **Faltante**.
- Reglas de **Traspasos** (antes de buscar): descripción con "PAGO … TARJETA/AMEX/TDC/…", "PAGO RECIBIDO", "SU PAGO"; "TRASPASO", "ENTRE CUENTAS"; el nombre de otra de tus cuentas; "RETIRO … CAJERO/ATM". Si uno de estos sí tiene una coincidencia exacta en la app, se muestra como Registrado para que detectes el doble registro.

## Formatos admitidos

- **CSV / TXT**: delimitador detectado (`,` `;` tab `|`), comillas, BOM, UTF-8 o Windows-1252. Encabezado en cualquiera de las primeras 40 filas (los bancos ponen varias líneas de datos de la cuenta arriba). Reconoce Fecha, Concepto/Descripción, Cargo/Retiro/Débito, Abono/Depósito/Crédito, Importe/Monto, Tipo (también un encabezado "Cargo/Abono" con valores Cargo o Abono), Referencia/Folio y Saldo (se ignora). Sin encabezado, deduce por contenido: la columna con fechas, el texto más largo como descripción, y dos columnas numéricas que nunca traen valor en la misma fila como cargo y abono (si ambas traen valor, la mayor es el saldo).
- **Formatos de referencia en las pruebas** (ficticios, hasta tener los reales): débito tipo SIMPLICITY con preámbulo, `;`, `$0.00` en la columna vacía, HORA y REFERENCIA aparte y fila "SALDO FINAL"; crédito tipo AMEX con una sola columna "Importe" en positivo para los cargos, "Titular", "Cuenta #" y "Referencia". Si el archivo real difiere, el primer paso es *Ajustar columnas*; el segundo, sumar el encabezado a `COLS` con una prueba.
- **XLSX**: lector propio (ZIP + XML) con descompresión nativa del navegador (`DecompressionStream`, iOS 16.4+). Cadenas compartidas, texto enriquecido, celdas con formato de fecha (se convierten a yyyy-mm-dd), varias hojas (propone la de más filas). No admite `.xls` antiguo, archivos con contraseña ni fórmulas sin valor calculado: en esos casos pide guardar como `.xlsx` normal o CSV.
- **Fechas**: `dd/mm/aa`, `dd/mm/aaaa`, `aaaa-mm-dd`, `05-OCT-2026`, `5 de octubre de 2026`, serial de Excel. Si todas las fechas permiten mes/día se asume día/mes (México); se puede forzar en *Ajustar columnas*.
- **Importes**: `$`, comas, paréntesis o guion para negativos, coma decimal.

## Validar con un estado de cuenta real desde la computadora

Nada de esto toca el repositorio ni el iPhone: los datos quedan en el `localStorage` del Chrome de tu computadora.

1. En una terminal: `cd D:\GitHub\finanzas-bolsillo-conciliacion` y `node tests/servir.js`. Abre `http://localhost:8765/` en Chrome y activa la vista de teléfono con Ctrl+Shift+M (elige 390 de ancho).
2. Para tener tu historial: Más › Google Sheet, pega la URL y la clave del Apps Script y toca *Actualizar desde la hoja*. Si quieres también lo capturado en el cel sin enviar, descarga un respaldo en el iPhone (Más › Respaldo) y restáuralo aquí.
3. Descarga de tu banco un mes en CSV o `.xlsx`. Más › Conciliar, elige la cuenta, *Cargar estado de cuenta*.
4. En *Revisa cómo se leyó* compara contra el PDF del banco: número de movimientos, rango de fechas, total de cargos y total de abonos. Si los signos están al revés, *Invertir signo*; si hay aviso de fechas futuras, el banco usa mes/día: cámbialo en *Ajustar columnas*; si falta una columna, asígnala ahí mismo.
5. *Conciliar*. Revisa **Registrados** primero: deben ser gastos que ya tenías. Luego **Faltantes** y **Por revisar** (ahí salen los cruces de periodo). Si un cargo legítimo cayó en **Traspasos**, *Sí es un gasto*.
6. Registra uno con *Registrar* y revisa que aparezca en Movimientos e Inicio; vuelve a Más › Conciliar y confirma que ya está en Registrados. Marca dos y usa *Registrar 2* para probar la confirmación múltiple.
7. Carga el mismo archivo otra vez: debe avisar que ya lo conciliaste y no proponer nada repetido.
8. Si algo no se leyó bien, guarda una copia del archivo **con importes y descripciones inventados** en el mismo formato y pásala para ajustar la detección con prueba. Al terminar, *Limpiar decisiones* en Más › Conciliar si no quieres conservar las de la prueba.

## Pruebas

`node tests/run.js` corre las pruebas existentes y `tests/conciliacion.js`. Qué cubre cada punto de la revisión de calidad:

| Punto | Pruebas |
|---|---|
| Lectura de cargos, abonos, fechas y cuentas; formatos tipo SIMPLICITY y AMEX | CSV (BOM, comillas, `;`, tab); fechas; importes; columnas por encabezado; columnas sin encabezado; tarjeta con "Cargo" en positivo; filas sin fecha o importe; SIMPLICITY (débito); AMEX (crédito); encabezado "Cargo/Abono"; exclusión cargo/abono e importe/saldo; xlsx |
| Traspasos, pagos de tarjeta y retiros visibles y corregibles | pagos de tarjeta y traspasos; integración (*Sí es un gasto* → *Es traspaso*) |
| Registrar uno o varios sin duplicar, también al reimportar | integración Más › Conciliar; reimportar aplica decisiones |
| Movimientos que cruzan el inicio o fin del periodo | cruce de periodo; fechas distintas dentro del periodo |
| Columnas incorrectas, signos invertidos o datos incompletos piden revisión | ajustar columnas a mano y archivo ilegible (aviso de fechas futuras); la hoja de captura y la confirmación múltiple son el único camino para registrar |
| Decisiones guardadas no aplican a otras transacciones ni a versiones corregidas | huellas estables (ordinal, independencia de la fila, cuenta); reimportar (vínculo roto vuelve al flujo normal); estado sin importes ni descripciones |
| Interfaz a 390 px | revisión visual en Chrome con el recorrido completo (no automatizada) |
