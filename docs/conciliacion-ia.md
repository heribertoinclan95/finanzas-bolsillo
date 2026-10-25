# Conciliación con estados de cuenta en PDF mediante IA (diseño, sin implementar)

Segunda etapa de la Fase 4. Depende de que la Fase 2 (seguridad) deje un Worker protegido por Cloudflare Access. Aquí no hay código ni credenciales; solo el contrato y las decisiones para que la implementación sea corta cuando llegue el momento.

## Por qué después de seguridad

Leer un PDF requiere mandar su contenido a un modelo. La app es estática y no puede guardar una clave de API: la llamada tiene que salir de un backend que (1) solo acepte peticiones del usuario autenticado por Access, (2) tenga la clave en un secreto del Worker y (3) no guarde el PDF. Mientras eso no exista, no se agrega ninguna llamada externa.

## Qué cambia y qué no

- **No cambia** el motor: `conciliar()` recibe la misma lista de movimientos normalizados que hoy produce `normalizar()`. La IA solo sustituye al lector de archivo.
- **No cambia** el almacenamiento: las decisiones siguen por huella en `finanzas-bolsillo-conciliacion`. El PDF no se guarda en ningún lado.
- **Cambia** la pantalla de carga: acepta `.pdf` y, en *Revisa cómo se leyó*, muestra el total de cargos y abonos que el modelo leyó para compararlo con el resumen impreso del estado de cuenta antes de conciliar.

## Contrato del backend

```
POST /api/conciliacion/pdf        (detrás de Cloudflare Access; cookie de sesión del usuario)
Content-Type: multipart/form-data  campos: archivo (PDF, máx. 10 MB), cuenta (texto)

200 → {
  ok: true,
  banco: "detectado por el modelo o vacío",
  periodo: { desde: "yyyy-mm-dd", hasta: "yyyy-mm-dd" },
  resumen: { cargos: 12345.67, abonos: 2345.00, nCargos: 48, nAbonos: 3 },   // lo que el PDF imprime como totales, si existe
  movimientos: [ { fecha: "yyyy-mm-dd", desc: "texto tal cual", monto: 123.45, tipo: "Egreso"|"Ingreso", ref: "opcional" } ],
  avisos: [ "páginas sin leer", "fecha ambigua en fila 12", … ]
}
4xx/5xx → { ok: false, error: "mensaje corto en español" }
```

En el cliente, `movimientos` pasa por la misma ruta que un CSV ya mapeado: `normalizar()` con un mapeo fijo (fecha, desc, monto con signo según `tipo`, id = `ref`), huellas, `conciliar()`.

## Cómo leería el Worker

1. Extraer texto del PDF en el Worker. Si el PDF trae texto (lo normal en estados de cuenta), se extrae sin IA y se manda al modelo solo el texto, no el archivo. Si no trae texto (escaneo), se mandan las páginas como imágenes.
2. Llamar al modelo con una instrucción fija que pida **únicamente** el JSON del contrato, con reglas: fechas en ISO, importes como número positivo y `tipo` aparte, una entrada por renglón del estado de cuenta, nada inventado, y `resumen` copiado de los totales impresos si aparecen.
3. Validar en el Worker antes de responder: JSON bien formado, fechas dentro del periodo ± 5 días, importes > 0, y que la suma de `movimientos` cuadre con `resumen` (tolerancia $1). Si no cuadra, responder igual pero con un aviso para que el usuario lo vea en la pantalla de validación.
4. No persistir nada: ni el PDF, ni el texto, ni la respuesta. Registrar en logs solo tamaño, duración y si cuadró.

Modelo: el de mejor relación costo/precisión para extracción estructurada disponible al implementar (hoy sería un modelo rápido de la familia Claude con salida JSON forzada). El nombre exacto se decide entonces y vive en una variable del Worker, no en la app.

## Validación y riesgos

- **Alucinación de renglones**: el cruce con `resumen` y la revisión visual del total en la app son la defensa; la IA nunca registra nada, el usuario sí.
- **Columnas de fecha dobles** (operación vs. liquidación): pedir al modelo la fecha de operación; la tolerancia de días cubre el resto.
- **PDF con contraseña**: el Worker responde error claro; el usuario la quita antes.
- **Costo**: un estado de cuenta mensual son unos miles de tokens; el gasto es marginal. Límite por usuario y día en el Worker.
- **Privacidad**: el texto del estado de cuenta viaja al proveedor del modelo. Antes de activarlo, decidir si eso es aceptable o si se enmascaran números de cuenta y tarjeta en el Worker antes de enviar (recomendado: sí, con una expresión regular para secuencias de 12 a 19 dígitos).

## Pendientes para implementar (cuando seguridad esté lista)

1. Ruta en el Worker protegida por Access, con el secreto de la API y el límite diario.
2. Extracción de texto del PDF en el Worker y la instrucción fija al modelo.
3. En la app: aceptar `.pdf` en el input, llamar al endpoint con la cookie de sesión, mostrar `resumen` y `avisos` en *Revisa cómo se leyó*.
4. Pruebas: respuesta ficticia del endpoint → mismo resultado de `conciliar()` que con el CSV equivalente; respuesta que no cuadra → aviso visible; error del Worker → mensaje en pantalla, sin romper la conciliación por CSV.
