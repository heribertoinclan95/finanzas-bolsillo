// Pruebas de la conciliación bancaria (Fase 4) con datos ficticios. Las corre tests/run.js; solas: node tests/conciliacion.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), zlib = require("zlib");
const CZ = require("../conciliacion.js");
const LKEY = "finanzas-bolsillo-v1", CKEY = CZ.KEY;
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg || `${a} ≠ ${b}`);

/* ---- app.js + conciliacion*.js en un mismo contexto, con DOM falso ---- */
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "dataset" ? {} : stub()), apply: () => stub(), set: () => true });
function cargarApp(store = {}) {
  const ctx = {
    module: { exports: {} }, console, URLSearchParams, Intl, Date, Set, Map, JSON, Math, Object, Array, String, Number, TextDecoder, Blob, Response, DecompressionStream, Uint8Array, DataView,
    document: { querySelector: () => stub(), querySelectorAll: () => [], addEventListener() {}, createElement: () => stub(), body: stub(), activeElement: null },
    window: { addEventListener() {}, scrollTo() {} }, navigator: { onLine: false },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    location: { search: "" }, setTimeout, clearTimeout, fetch: () => Promise.reject(new Error("sin red"))
  };
  vm.createContext(ctx);
  for (const f of ["conciliacion.js", "conciliacion-ui.js"]) { vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx); ctx.module = { exports: {} }; }
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), ctx);
  return { api: ctx.module.exports, ui: ctx.ConciliacionUI, store };
}

/* ---- Datos ficticios ---- */
const CUENTAS = ["Cuenta SIMPLICITY", "AMEX", "Efectivo"];
const fila = (ref, fecha, desc, monto, tipo = "Egreso", extra = {}) => ({ ref, fecha, desc, cat: tipo === "Ingreso" ? "Ingreso" : "Comida", monto, tipo, cuenta: "Cuenta SIMPLICITY", ...extra });
const mov = (id, fecha, desc, cat, monto, tipo = "Egreso", extra = {}) => ({ id, fecha, desc, cat, monto, tipo, cuenta: "Cuenta SIMPLICITY", exportado: false, creado: fecha + "T12:00:00Z", ...extra });
const CSV_BASE = "Fecha,Concepto,Cargo,Abono\n";
function csv(texto, cuenta = "Cuenta SIMPLICITY") {
  const rows = CZ.parseCSV(texto), det = CZ.detectarColumnas(rows);
  return { ...CZ.normalizar(rows, det.mapeo, { cuenta }), mapeo: det.mapeo, rows };
}
const banco = lineas => csv(CSV_BASE + lineas.join("\n")).movs;
const conc = (bancoMovs, filas, extra = {}) => CZ.conciliar({ banco: bancoMovs, app: CZ.prepararApp(filas), cuenta: "Cuenta SIMPLICITY", cuentas: CUENTAS, tol: 3, decisiones: {}, ...extra });
const descs = l => l.map(x => (x.b || x).desc).sort();

/* ---- .xlsx mínimo construido a mano (ZIP + XML), para probar el lector sin librerías ---- */
function crc32(u8) { let crc = 0xFFFFFFFF; for (let n = 0; n < u8.length; n++) { let c = (crc ^ u8[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const partes = [], cd = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), raw = Buffer.from(f.data), comp = f.stored ? raw : zlib.deflateRawSync(raw), method = f.stored ? 0 : 8, crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    partes.push(lh, name, comp); cd.push(ch, name); off += lh.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(cd), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  const out = Buffer.concat([...partes, cdBuf, eocd]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
const serial = (y, m, d) => Date.UTC(y, m - 1, d) / 864e5 + 25569;
function xlsxFicticio() {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zip([
    { name: "[Content_Types].xml", data: "<Types/>", stored: true },
    { name: "xl/workbook.xml", data: `<workbook ${NS}><sheets><sheet name="Portada" sheetId="1" r:id="rId1"/><sheet r:id="rId2" sheetId="2" name="Movimientos"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>` },
    { name: "xl/sharedStrings.xml", data: `<sst><si><t>Fecha</t></si><si><t>Descripción</t></si><si><t>Importe</t></si><si><r><t>OXXO </t></r><r><t>GAS &amp; CO</t></r></si></sst>` },
    { name: "xl/styles.xml", data: `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", data: `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Estado de cuenta</t></is></c></row></sheetData></worksheet>` },
    { name: "xl/worksheets/sheet2.xml", data: `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" s="1"><v>${serial(2026, 10, 5)}</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" s="3"><v>-1234.5</v></c></row>
      <row r="3"><c r="A3" s="2"><v>${serial(2026, 10, 6)}</v></c><c r="B3" t="inlineStr"><is><t>NOMINA</t></is></c><c r="C3"><v>11652</v></c></row>
      <row r="4"><c r="A4" t="str"><v>07/10/2026</v></c><c r="B4" t="s"><v>3</v></c><c r="C4"><v>-50</v></c></row>
    </sheetData></worksheet>` }
  ]);
}

module.exports = async function () {
  let n = 0;
  const t = async (name, fn) => { await fn(); n++; console.log("✓", name); };

  /* ---- Lectura y normalización ---- */
  await t("CSV: BOM, comillas, comas dentro del texto y delimitadores ; y tab", () => {
    const rows = CZ.parseCSV('﻿Fecha,Concepto,Cargo,Abono\r\n"05/10/2026","OXXO GAS, SUC 12","$1,234.50",\r\n06/10/2026,NOMINA,,"11,652.00"\r\n');
    assert.deepStrictEqual(rows[1], ["05/10/2026", "OXXO GAS, SUC 12", "$1,234.50", ""]);
    assert.deepStrictEqual(rows[2], ["06/10/2026", "NOMINA", "", "11,652.00"]);
    assert.deepStrictEqual(CZ.parseCSV("a;b;c\n1;2,5;3"), [["a", "b", "c"], ["1", "2,5", "3"]]);
    assert.deepStrictEqual(CZ.parseCSV("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
    assert.strictEqual(CZ.detectarDelim("x;y;z\n1;2;3"), ";");
  });
  await t("fechas: dd/mm/aa, mes/día cuando no hay otra lectura, nombres de mes, ISO y serial de Excel", () => {
    assert.strictEqual(CZ.parseFecha("05/10/2026"), "2026-10-05"); assert.strictEqual(CZ.parseFecha("5/10/26"), "2026-10-05");
    assert.strictEqual(CZ.parseFecha("2026-10-05"), "2026-10-05"); assert.strictEqual(CZ.parseFecha("2026-10-05T10:00:00"), "2026-10-05");
    assert.strictEqual(CZ.parseFecha("13/10/2026"), "2026-10-13"); assert.strictEqual(CZ.parseFecha("10/13/2026"), "2026-10-13");
    assert.strictEqual(CZ.parseFecha("10/05/2026", "mdy"), "2026-10-05"); assert.strictEqual(CZ.parseFecha("10/05/2026", "dmy"), "2026-05-10");
    assert.strictEqual(CZ.parseFecha("05-OCT-2026"), "2026-10-05"); assert.strictEqual(CZ.parseFecha("5 oct 2026"), "2026-10-05");
    assert.strictEqual(CZ.parseFecha("5 de octubre de 2026"), "2026-10-05"); assert.strictEqual(CZ.parseFecha("Oct 5, 2026"), "2026-10-05");
    assert.strictEqual(CZ.parseFecha(serial(2026, 10, 5)), "2026-10-05"); assert.strictEqual(CZ.parseFecha("20261005"), "2026-10-05");
    assert.strictEqual(CZ.parseFecha("31/02/2026"), null); assert.strictEqual(CZ.parseFecha("hola"), null); assert.strictEqual(CZ.parseFecha(""), null);
    assert.strictEqual(CZ.detectarFormatoFecha(["01/10/2026", "10/13/2026"]), "mdy"); assert.strictEqual(CZ.detectarFormatoFecha(["01/10/2026", "25/10/2026"]), "dmy");
  });
  await t("importes: $ y comas, negativos con paréntesis o guion, coma decimal, texto vacío", () => {
    cerca(CZ.parseMonto("$1,234.50"), 1234.5); cerca(CZ.parseMonto("-1,234.50"), -1234.5); cerca(CZ.parseMonto("(1,234.50)"), -1234.5);
    cerca(CZ.parseMonto("1.234,56"), 1234.56); cerca(CZ.parseMonto("12,50"), 12.5); cerca(CZ.parseMonto("1,234"), 1234);
    cerca(CZ.parseMonto("1234.5 MXN"), 1234.5); cerca(CZ.parseMonto("−500.00"), -500); cerca(CZ.parseMonto(85), 85);
    assert.strictEqual(CZ.parseMonto(""), null); assert.strictEqual(CZ.parseMonto("-"), null); assert.strictEqual(CZ.parseMonto("n/a"), null);
  });
  await t("columnas por encabezado: preámbulo del banco, Retiro/Depósito, Saldo fuera", () => {
    const rows = [["Estado de cuenta"], ["Cuenta: 1234"], ["Fecha", "Concepto", "Retiro", "Depósito", "Saldo"], ["01/10/2026", "OXXO", "50.00", "", "1,000.00"], ["02/10/2026", "NOMINA", "", "11,652.00", "12,652.00"]];
    const { mapeo, encabezado } = CZ.detectarColumnas(rows);
    assert.deepStrictEqual([mapeo.fecha, mapeo.desc, mapeo.cargo, mapeo.abono, mapeo.saldo, mapeo.monto, mapeo.inicio], [0, 1, 2, 3, 4, null, 3]);
    assert.strictEqual(encabezado[0], "Fecha");
    const r = CZ.normalizar(rows, mapeo, { cuenta: "Cuenta SIMPLICITY" });
    assert.strictEqual(r.movs.length, 2); assert.strictEqual(r.movs[0].tipo, "Egreso"); cerca(r.movs[0].monto, 50);
    assert.strictEqual(r.movs[1].tipo, "Ingreso"); cerca(r.movs[1].monto, 11652); assert.strictEqual(r.movs[1].fecha, "2026-10-02");
  });
  await t("columnas sin encabezado: por contenido (fecha, texto más largo, importe con signo, saldo aparte)", () => {
    const rows = [["01/10/2026", "OXXO GAS 1234", "-50.00", "950.00"], ["02/10/2026", "NOMINA OCTUBRE", "11652.00", "12602.00"], ["03/10/2026", "UBER TRIP", "-87.00", "12515.00"]];
    const { mapeo, encabezado } = CZ.detectarColumnas(rows);
    assert.strictEqual(encabezado, null);
    assert.deepStrictEqual([mapeo.fecha, mapeo.desc, mapeo.monto, mapeo.saldo, mapeo.inicio], [0, 1, 2, 3, 0]);
    const m = CZ.normalizar(rows, mapeo, { cuenta: "AMEX" }).movs;
    assert.deepStrictEqual(m.map(x => x.tipo), ["Egreso", "Ingreso", "Egreso"]); assert.strictEqual(m[0].cuentaN, "AMEX");
  });
  await t("tarjeta con una sola columna “Cargo” en positivo: se invierte el signo; sugerencia para AMEX", () => {
    const rows = [["Fecha", "Descripción", "Cargo"], ["01/10/2026", "AMAZON MX", "899.00"], ["02/10/2026", "PAGO RECIBIDO GRACIAS", "-5,000.00"]];
    const { mapeo } = CZ.detectarColumnas(rows);
    assert.strictEqual(mapeo.monto, 2); assert.strictEqual(mapeo.invertir, true);
    const m = CZ.normalizar(rows, mapeo, { cuenta: "AMEX" }).movs;
    assert.deepStrictEqual(m.map(x => x.tipo), ["Egreso", "Ingreso"]);
    const rows2 = [["Fecha", "Descripción", "Importe"], ["01/10/2026", "AMAZON MX", "899.00"], ["02/10/2026", "UBER", "120.00"], ["03/10/2026", "OXXO", "50.00"]];
    const d2 = CZ.detectarColumnas(rows2), m2 = CZ.normalizar(rows2, d2.mapeo, { cuenta: "AMEX" }).movs;
    assert.strictEqual(CZ.sugerirInvertir(d2.mapeo, m2, "AMEX"), true); assert.strictEqual(CZ.sugerirInvertir(d2.mapeo, m2, "Cuenta SIMPLICITY"), false);
  });
  await t("filas sin fecha o importe (totales, saldo final) se omiten y se cuentan", () => {
    const r = csv(CSV_BASE + "01/10/2026,OXXO,50.00,\nSaldo final,,,\n,TOTAL,50.00,\n02/10/2026,SIN IMPORTE,,");
    assert.strictEqual(r.movs.length, 1); assert.strictEqual(r.errores.length, 2); assert.strictEqual(r.omitidas, 1);   // "Saldo final" sin importe ni fecha se omite en silencio
  });
  await t("huellas: estables entre lecturas, distintas para dos cargos idénticos y sin depender de la fila", () => {
    const a = banco(["01/10/2026,OXXO,50.00,", "01/10/2026,OXXO,50.00,", "02/10/2026,UBER,87.00,"]);
    const b = banco(["01/10/2026,OXXO,50.00,", "01/10/2026,OXXO,50.00,", "02/10/2026,UBER,87.00,"]);
    assert.deepStrictEqual(a.map(x => x.huella), b.map(x => x.huella));
    assert.notStrictEqual(a[0].huella, a[1].huella);
    const c = banco(["30/09/2026,RENTA,9000.00,", "01/10/2026,OXXO,50.00,", "01/10/2026,OXXO,50.00,", "02/10/2026,UBER,87.00,"]);
    assert.deepStrictEqual(c.slice(1).map(x => x.huella), a.map(x => x.huella));
    assert.ok(/^[0-9a-f]{16}$/.test(a[0].huella));
    assert.notStrictEqual(CZ.hashArchivo(a), CZ.hashArchivo(c)); assert.strictEqual(CZ.hashArchivo(a), CZ.hashArchivo(b));
    const app = CZ.prepararApp([fila("h0", "2026-10-01", "oxxo", 50), fila("h1", "2026-10-01", "OXXO", 50)]);
    assert.notStrictEqual(app[0].huella, app[1].huella);   // mismo contenido normalizado → ordinal distinto
    assert.strictEqual(CZ.prepararApp([fila("zz", "2026-10-01", "Oxxo ", 50)])[0].huella, app[0].huella);   // no depende de ref ni de mayúsculas
  });

  /* ---- Motor ---- */
  await t("coincidencias exactas → Registrados; nada en Faltantes", () => {
    const R = conc(banco(["01/10/2026,OXXO GAS 0432,50.00,", "02/10/2026,UBER TRIP,87.00,", "03/10/2026,NOMINA EMPRESA,,11652.00"]),
      [fila("a", "2026-10-01", "oxxo", 50), fila("b", "2026-10-02", "uber", 87), fila("c", "2026-10-03", "nómina", 11652, "Ingreso")]);
    assert.strictEqual(R.registrados.length, 3); assert.strictEqual(R.faltantes.length, 0); assert.strictEqual(R.revisar.length, 0); assert.strictEqual(R.soloApp.length, 0);
    assert.ok(R.registrados.every(r => !r.manual && r.score >= CZ.AUTO));
  });
  await t("fechas distintas dentro del periodo: hasta 3 días coincide; más lejos va a Por revisar salvo que la descripción se parezca; fuera de tolerancia es Faltante", () => {
    const b = banco(["20/09/2026,COMISION,1.00,", "05/10/2026,TAQUERIA EL GUERO,85.00,"]);
    assert.strictEqual(conc(b, [fila("a", "2026-10-03", "tacos", 85)]).registrados.length, 1);
    const R = conc(b, [fila("a", "2026-09-29", "tacos", 85)], { tol: 10 });
    assert.strictEqual(R.revisar.length, 1); assert.strictEqual(R.revisar[0].candidatos[0].dias, 6); assert.ok(!R.revisar[0].candidatos[0].fueraPeriodo);
    assert.strictEqual(conc(b, [fila("a", "2026-09-29", "taqueria guero", 85)], { tol: 10 }).registrados.length, 1);
    const F = conc(b, [fila("a", "2026-09-29", "tacos", 85)]);
    assert.strictEqual(F.faltantes.length, 2); assert.strictEqual(F.soloApp.length, 1);   // a 6 días con tolerancia 3: falta en el banco y sobra en la app
  });
  await t("cruce de periodo: una fila de la app anterior o posterior al archivo nunca se da por registrada sola; se confirma con “Es este”", () => {
    const b = banco(["01/10/2026,OXXO GAS,50.00,", "15/10/2026,UBER TRIP,87.00,", "31/10/2026,CINEPOLIS,200.00,"]);
    const app = [fila("sep", "2026-09-29", "oxxo", 50), fila("u", "2026-10-14", "uber", 87), fila("nov", "2026-11-02", "cine", 200)];
    const R = conc(b, app);
    assert.strictEqual(R.registrados.length, 1); assert.strictEqual(R.registrados[0].a.ref, "u");
    assert.strictEqual(R.revisar.length, 2); assert.ok(R.revisar.every(x => x.candidatos[0].fueraPeriodo && x.candidatos[0].exacto));
    assert.strictEqual(R.faltantes.length, 0); assert.strictEqual(R.soloApp.length, 0);
    const R2 = conc(b, app, { decisiones: { [b[0].huella]: { t: "v", h: CZ.prepararApp(app)[0].huella, f: "x" } } });
    assert.strictEqual(R2.registrados.length, 2); assert.strictEqual(R2.revisar.length, 1);
    assert.strictEqual(conc(banco(["01/10/2026,OXXO,50.00,", "20/10/2026,COMISION,1.00,"]), [fila("a", "2026-10-03", "oxxo", 50)]).registrados.length, 1);   // dentro del periodo sigue siendo automático
  });
  await t("importes ligeramente distintos → Por revisar con la diferencia; muy distintos → Faltante", () => {
    const R = conc(banco(["05/10/2026,RESTAURANTE LA CASA,575.00,"]), [fila("a", "2026-10-05", "restaurante", 500)]);
    assert.strictEqual(R.revisar.length, 1); cerca(R.revisar[0].candidatos[0].difMonto, -75); assert.strictEqual(R.registrados.length, 0);
    const R2 = conc(banco(["05/10/2026,SUPER WALMART,1234.50,"]), [fila("a", "2026-10-05", "super", 1230)]);
    assert.strictEqual(R2.revisar.length, 1); cerca(R2.revisar[0].candidatos[0].difMonto, -4.5);
    assert.strictEqual(conc(banco(["05/10/2026,ALGO,500.00,"]), [fila("a", "2026-10-05", "otra cosa", 900)]).faltantes.length, 1);
  });
  await t("cargos duplicados del mismo monto: 2 contra 2 coinciden; 2 contra 1 van a Por revisar; con descripciones distintas no se adivina", () => {
    const dos = banco(["01/10/2026,OXXO,50.00,", "01/10/2026,OXXO,50.00,"]);
    const R22 = conc(dos, [fila("a", "2026-10-01", "oxxo", 50), fila("b", "2026-10-01", "oxxo", 50)]);
    assert.strictEqual(R22.registrados.length, 2); assert.strictEqual(R22.revisar.length, 0);
    const R21 = conc(dos, [fila("a", "2026-10-01", "oxxo", 50)]);
    assert.strictEqual(R21.registrados.length, 0); assert.strictEqual(R21.revisar.length, 2); assert.strictEqual(R21.soloApp.length, 0);
    const R12 = conc(banco(["01/10/2026,PAGO EN COMERCIO,50.00,"]), [fila("a", "2026-10-01", "oxxo", 50), fila("b", "2026-10-01", "cafe", 50)]);
    assert.strictEqual(R12.registrados.length, 0); assert.strictEqual(R12.revisar.length, 1); assert.strictEqual(R12.revisar[0].candidatos.length, 2);
  });
  await t("lo capturado en el cel sin enviar cuenta como registrado y se marca pendiente", () => {
    const R = conc(banco(["01/10/2026,UBER TRIP,87.00,"]), [fila("loc1", "2026-10-01", "uber", 87, "Egreso", { local: true, pendiente: true })]);
    assert.strictEqual(R.registrados.length, 1); assert.strictEqual(R.registrados[0].a.pendiente, true); assert.strictEqual(R.registrados[0].a.local, true);
  });
  await t("pagos de tarjeta, traspasos a otra cuenta y retiros de cajero no son gastos; “Sí es un gasto” los regresa a Faltantes", () => {
    const b = banco(["03/10/2026,PAGO TARJETA AMEX 1234,5000.00,", "04/10/2026,SPEI ENVIADO A AMEX,2000.00,", "05/10/2026,RETIRO CAJERO ATM 0012,1500.00,", "06/10/2026,OXXO,50.00,", "07/10/2026,TRASPASO ENTRE CUENTAS,,3000.00"]);
    const R = conc(b, []);
    assert.strictEqual(R.traspasos.length, 4); assert.strictEqual(R.faltantes.length, 1); assert.strictEqual(R.faltantes[0].b.desc, "OXXO");
    assert.deepStrictEqual(R.traspasos.map(x => x.regla).sort(), ["efectivo", "pagoTarjeta", "traspaso", "traspaso"]);
    const h = b.find(x => x.desc.startsWith("RETIRO")).huella;
    const R2 = conc(b, [], { decisiones: { [h]: { t: "g", f: "2026-10-24T00:00:00Z" } } });
    assert.strictEqual(R2.traspasos.length, 3); assert.strictEqual(R2.faltantes.length, 2);
    // Si el pago de tarjeta sí está registrado en la app (igual importe y fecha), se muestra como registrado y no se esconde
    const R3 = conc(banco(["03/10/2026,PAGO TARJETA AMEX,5000.00,"]), [fila("a", "2026-10-03", "pago amex", 5000)]);
    assert.strictEqual(R3.registrados.length, 1); assert.strictEqual(R3.traspasos.length, 0);
    // Un abono en la tarjeta por su pago tampoco es ingreso
    assert.strictEqual(CZ.conciliar({ banco: csv("Fecha,Descripción,Importe\n03/10/2026,PAGO RECIBIDO GRACIAS,5000.00", "AMEX").movs, app: [], cuenta: "AMEX", cuentas: CUENTAS }).traspasos.length, 1);
  });
  await t("faltantes, ambiguos por otra cuenta y “solo en la app” dentro del periodo", () => {
    const b = banco(["01/10/2026,OXXO,50.00,", "05/10/2026,AMAZON MX,899.00,"]);
    const app = [fila("a", "2026-10-01", "oxxo", 50), fila("am", "2026-10-05", "amazon", 899, "Egreso", { cuenta: "AMEX" }),
      fila("s", "2026-10-03", "cine", 200), fila("fuera", "2026-09-20", "cena", 400), fila("otra", "2026-10-02", "gym", 700, "Egreso", { cuenta: "AMEX" }), fila("ing", "2026-10-04", "venta", 300, "Ingreso")];
    const R = conc(b, app);
    assert.strictEqual(R.registrados.length, 1);
    assert.strictEqual(R.revisar.length, 1); assert.strictEqual(R.revisar[0].candidatos[0].otraCuenta, true); assert.strictEqual(R.revisar[0].candidatos[0].a.cuenta, "AMEX");
    assert.deepStrictEqual(R.soloApp.map(a => a.ref).sort(), ["ing", "s"]);   // ni la de septiembre ni las de AMEX
    assert.deepStrictEqual(R.rango, { desde: "2026-10-01", hasta: "2026-10-05" });
    const F = conc(banco(["05/10/2026,ALGO NUEVO,120.00,"]), []);
    assert.strictEqual(F.faltantes.length, 1); cerca(F.faltanEgresos, 120); cerca(F.faltanIngresos, 0);
  });
  await t("reimportar el mismo archivo aplica las decisiones: vinculado por id o huella, ignorado; vínculo roto vuelve al flujo normal", () => {
    const b = banco(["01/10/2026,OXXO GAS 0432,50.00,", "02/10/2026,UBER TRIP,87.00,", "03/10/2026,COMISION,15.00,"]);
    const app = CZ.prepararApp([fila("m1", "2026-10-01", "gasolina", 50, "Egreso", { local: true }), fila("h5", "2026-10-02", "viaje", 87)]);
    const decisiones = { [b[0].huella]: { t: "v", id: "m1", f: "x" }, [b[1].huella]: { t: "v", h: app[1].huella, f: "x" }, [b[2].huella]: { t: "i", f: "x" } };
    const R = CZ.conciliar({ banco: banco(["01/10/2026,OXXO GAS 0432,50.00,", "02/10/2026,UBER TRIP,87.00,", "03/10/2026,COMISION,15.00,"]), app, cuenta: "Cuenta SIMPLICITY", cuentas: CUENTAS, tol: 3, decisiones });
    assert.strictEqual(R.registrados.length, 2); assert.ok(R.registrados.every(r => r.manual)); assert.strictEqual(R.ignorados.length, 1); assert.strictEqual(R.faltantes.length, 0);
    const R2 = CZ.conciliar({ banco: b, app: [], cuenta: "Cuenta SIMPLICITY", cuentas: CUENTAS, tol: 3, decisiones });
    assert.strictEqual(R2.faltantes.length, 2); assert.strictEqual(R2.ignorados.length, 1);   // los vínculos ya no encuentran su fila
  });
  await t("SIMPLICITY (débito): preámbulo, punto y coma, $0.00 en la columna vacía, referencia aparte, hora y fila de saldo final", () => {
    const texto = ["Cuenta SIMPLICITY;;;;;;", "Periodo: 01/10/2026 al 31/10/2026;;;;;;", "FECHA OPERACIÓN;HORA;CONCEPTO;REFERENCIA;CARGO;ABONO;SALDO",
      "01/10/2026;09:12;COMPRA OXXO GAS 0432 MEX;0000123;$50.00;$0.00;$9,950.00", "03/10/2026;00:00;SPEI RECIBIDO NOMINA EMPRESA SA DE CV;7781234;$0.00;$11,652.00;$21,602.00",
      "08/10/2026;13:40;PAGO TARJETA AMEX;5550001;$5,000.00;$0.00;$16,602.00", "11/10/2026;19:05;RETIRO CAJERO ATM 0012;0;$1,500.00;$0.00;$15,102.00", "SALDO FINAL;;;;;;$15,102.00"].join("\r\n");
    const r = csv(texto);
    assert.deepStrictEqual([r.mapeo.fecha, r.mapeo.desc, r.mapeo.cargo, r.mapeo.abono, r.mapeo.saldo, r.mapeo.id, r.mapeo.inicio], [0, 2, 4, 5, 6, 3, 3]);
    assert.deepStrictEqual(r.movs.map(m => [m.fecha, m.tipo, m.monto]), [["2026-10-01", "Egreso", 50], ["2026-10-03", "Ingreso", 11652], ["2026-10-08", "Egreso", 5000], ["2026-10-11", "Egreso", 1500]]);
    assert.strictEqual(r.movs[0].idBanco, "0000123"); assert.strictEqual(r.errores.length, 0); assert.strictEqual(r.omitidas, 1);
    const R = conc(r.movs, [fila("a", "2026-10-01", "gasolina", 50)]);
    assert.strictEqual(R.registrados.length, 1); assert.strictEqual(R.faltantes.length, 1); assert.strictEqual(R.faltantes[0].b.tipo, "Ingreso");
    assert.deepStrictEqual(R.traspasos.map(x => x.regla).sort(), ["efectivo", "pagoTarjeta"]);
  });
  await t("AMEX (crédito): cargos en positivo en una sola columna Importe, referencia como id, pago recibido como traspaso", () => {
    const texto = ["Fecha,Descripción,Titular de la Tarjeta,Cuenta #,Importe,Referencia,Categoría",
      "02/10/2026,AMAZON MX MEXICO,HERIBERTO I,-31002,\"1,299.00\",'320262750001,Compras", "05/10/2026,UBER TRIP CIUDAD DE MEX,HERIBERTO I,-31002,87.00,'320262780002,Transporte",
      "09/10/2026,PAGO RECIBIDO - GRACIAS,HERIBERTO I,-31002,\"-5,000.00\",'320262820003,", "12/10/2026,STARBUCKS COFFEE,HERIBERTO I,-31002,95.00,'320262850004,Restaurantes"].join("\n");
    const rows = CZ.parseCSV(texto), det = CZ.detectarColumnas(rows);
    assert.deepStrictEqual([det.mapeo.fecha, det.mapeo.desc, det.mapeo.monto, det.mapeo.id, det.mapeo.cargo, det.mapeo.abono, det.mapeo.tipoCol], [0, 1, 4, 5, null, null, null]);
    let r = CZ.normalizar(rows, det.mapeo, { cuenta: "AMEX" });
    assert.strictEqual(CZ.sugerirInvertir(det.mapeo, r.movs, "AMEX"), true);   // la app lo propone y lo muestra en “Revisa cómo se leyó”
    det.mapeo.invertir = true; r = CZ.normalizar(rows, det.mapeo, { cuenta: "AMEX" });
    assert.deepStrictEqual(r.movs.map(m => [m.tipo, m.monto]), [["Egreso", 1299], ["Egreso", 87], ["Ingreso", 5000], ["Egreso", 95]]);
    assert.ok(r.movs[0].idBanco.includes("320262750001"));
    const R = CZ.conciliar({ banco: r.movs, app: CZ.prepararApp([fila("a", "2026-10-02", "amazon", 1299, "Egreso", { cuenta: "AMEX" })]), cuenta: "AMEX", cuentas: CUENTAS, tol: 3 });
    assert.strictEqual(R.registrados.length, 1); assert.strictEqual(R.traspasos.length, 1); assert.strictEqual(R.traspasos[0].regla, "pagoTarjeta"); assert.strictEqual(R.faltantes.length, 2);
  });
  await t("encabezados: “Cargo/Abono” es el tipo, no el importe; la descripción se busca por contenido aunque coincida con el índice de la primera fila", () => {
    const rows = [["Banco X"], ["Cuenta 1234"], ["Fecha", "Importe", "Cargo/Abono", "Texto"], ["01/10/2026", "50.00", "Cargo", "OXXO GAS"], ["02/10/2026", "11652.00", "Abono", "NOMINA"], ["03/10/2026", "87.00", "Cargo", "UBER"]];
    const { mapeo } = CZ.detectarColumnas(rows);
    assert.deepStrictEqual([mapeo.fecha, mapeo.monto, mapeo.tipoCol, mapeo.desc, mapeo.cargo, mapeo.inicio], [0, 1, 2, 3, null, 3]);
    assert.deepStrictEqual(CZ.normalizar(rows, mapeo, { cuenta: "X" }).movs.map(x => x.tipo), ["Egreso", "Ingreso", "Egreso"]);
  });
  await t("sin encabezado: cargo y abono con filas parecidas se distinguen por exclusión; importe y saldo no se confunden; una referencia de 5 dígitos no es fecha", () => {
    const ca = [["01/10/2026", "OXXO", "50.00", ""], ["02/10/2026", "NOMINA", "", "11652.00"], ["03/10/2026", "UBER", "87.00", ""], ["04/10/2026", "VENTA", "", "300.00"], ["05/10/2026", "CINE", "200.00", ""], ["06/10/2026", "DEVOLUCION", "", "120.00"]];
    const m1 = CZ.detectarColumnas(ca).mapeo;
    assert.deepStrictEqual([m1.fecha, m1.desc, m1.cargo, m1.abono, m1.monto], [0, 1, 2, 3, null]);
    const ms = [["01/10/2026", "OXXO", "-50.00", "9950.00"], ["02/10/2026", "NOMINA", "11652.00", ""], ["03/10/2026", "UBER", "-87.00", "21515.00"], ["04/10/2026", "CINE", "-200.00", "21315.00"]];
    const m2 = CZ.detectarColumnas(ms).mapeo;
    assert.deepStrictEqual([m2.fecha, m2.desc, m2.monto, m2.saldo, m2.cargo], [0, 1, 2, 3, null]);
    const ref = [["12345", "01/10/2026", "OXXO", "-50.00"], ["23456", "02/10/2026", "UBER", "-87.00"], ["34567", "03/10/2026", "NOMINA", "11652.00"]];
    const m3 = CZ.detectarColumnas(ref).mapeo;
    assert.deepStrictEqual([m3.fecha, m3.desc, m3.monto], [1, 2, 3]);
  });
  await t("vincular a mano: cercanos ordenados por diferencia de importe y fecha", () => {
    const b = banco(["05/10/2026,ALGO,500.00,"])[0];
    const app = CZ.prepararApp([fila("a", "2026-10-01", "x", 480), fila("b", "2026-10-05", "y", 500), fila("c", "2026-10-06", "z", 500), fila("d", "2026-10-05", "ingreso", 500, "Ingreso"), fila("e", "2026-08-01", "lejos", 500)]);
    assert.deepStrictEqual(CZ.cercanos(b, app, new Set()).map(x => x.a.ref), ["b", "c", "a"]);
    assert.deepStrictEqual(CZ.cercanos(b, app, new Set([app[1].huella])).map(x => x.a.ref), ["c", "a"]);
  });

  /* ---- Lector .xlsx sin librerías ---- */
  await t("xlsx: ZIP + XML a mano, cadenas compartidas y rich text, fechas por estilo, elige la hoja con más filas", async () => {
    const buf = xlsxFicticio();
    const { hojas, hoja } = await CZ.leerArchivo("octubre.xlsx", buf);
    assert.strictEqual(hojas.length, 2); assert.strictEqual(hoja, 1); assert.strictEqual(hojas[1].nombre, "Movimientos");
    const f = hojas[1].filas;
    assert.deepStrictEqual(f[0], ["Fecha", "Descripción", "Importe"]);
    assert.deepStrictEqual(f[1], ["2026-10-05", "OXXO GAS & CO", -1234.5]);
    assert.deepStrictEqual(f[2], ["2026-10-06", "NOMINA", 11652]);
    assert.strictEqual(f[3][0], "07/10/2026");
    const det = CZ.detectarColumnas(f), m = CZ.normalizar(f, det.mapeo, { cuenta: "Cuenta SIMPLICITY" }).movs;
    assert.deepStrictEqual(m.map(x => [x.fecha, x.tipo, x.monto]), [["2026-10-05", "Egreso", 1234.5], ["2026-10-06", "Ingreso", 11652], ["2026-10-07", "Egreso", 50]]);
    const sinExt = await CZ.leerArchivo("sin-extension", buf);   // se reconoce por la firma PK
    assert.strictEqual(sinExt.hojas.length, 2);
    await assert.rejects(CZ.leerArchivo("viejo.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]).buffer), /xls/);
    await assert.rejects(CZ.leerArchivo("roto.xlsx", new Uint8Array(40).buffer), /xlsx/);
    const csvBuf = new TextEncoder().encode("Fecha,Concepto,Cargo,Abono\n01/10/2026,CAFÉ,45.00,").buffer;
    assert.deepStrictEqual((await CZ.leerArchivo("x.csv", csvBuf)).hojas[0].filas[1], ["01/10/2026", "CAFÉ", "45.00", ""]);
    const latin1 = new Uint8Array([0x43, 0x41, 0x46, 0xc9]).buffer;   // "CAFÉ" en Windows-1252
    assert.strictEqual(CZ.decodificar(latin1), "CAFÉ");
  });

  /* ---- Almacenamiento ---- */
  await t("estado: clave propia, forma documentada, sin importes ni descripciones; dañado → vacío", () => {
    const store = {}, st = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
    assert.deepStrictEqual(CZ.cargarEstado(st), { v: 1, tol: 3, cuenta: "", decisiones: {}, archivos: {} });
    store[CKEY] = "{basura"; assert.strictEqual(CZ.cargarEstado(st).tol, 3);
    const e = CZ.nuevoEstado(); e.decisiones["abc"] = { t: "v", id: "m1", f: "2026-10-24T00:00:00Z" }; e.archivos["def"] = { cuenta: "AMEX", n: 3, f: "2026-10-24T00:00:00Z", nombre: "octubre.csv" };
    assert.ok(CZ.guardarEstado(st, e)); assert.strictEqual(CKEY, "finanzas-bolsillo-conciliacion");
    assert.deepStrictEqual(Object.keys(JSON.parse(store[CKEY])).sort(), ["archivos", "cuenta", "decisiones", "tol", "v"]);
    assert.deepStrictEqual(CZ.cargarEstado(st), e);
  });

  /* ---- Integración con app.js: registrar uno y varios sin duplicar, y reconocerlos al reimportar ---- */
  await t("Más › Conciliar: cargar CSV, conciliar, registrar uno (hoja de captura) y varios (confirmación) sin duplicar; reimportar los reconoce", async () => {
    const store = { [LKEY]: JSON.stringify({ movs: [mov("m0", "2026-10-01", "oxxo", "Comida", 50)], cfg: { v: 2 } }) };
    const { api, ui } = cargarApp(store);
    const texto = CSV_BASE + "01/10/2026,OXXO GAS 0432,50.00,\n02/10/2026,UBER TRIP,87.00,\n03/10/2026,AMAZON MX,899.00,\n04/10/2026,PAGO TARJETA AMEX,5000.00,\n05/10/2026,NOMINA,,11652.00";
    const archivo = { name: "simplicity-octubre.csv", arrayBuffer: () => Promise.resolve(new TextEncoder().encode(texto).buffer) };
    ui.cargarArchivo(archivo);
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(ui._U.etapa, "validar"); assert.strictEqual(ui._U.archivo.movs.length, 5); assert.strictEqual(ui._U.archivo.repetido, null);
    assert.ok(ui.view().includes("Revisa cómo se leyó") && ui.view().includes("Conciliar 5 movimientos"));
    assert.ok(ui.click({ dataset: { cz: "conciliar" } }));
    assert.strictEqual(ui._U.etapa, "resultados");
    let R = ui.resultado();
    assert.strictEqual(R.registrados.length, 1); assert.strictEqual(R.faltantes.length, 3); assert.strictEqual(R.traspasos.length, 1);
    assert.ok(ui.view().includes("Faltantes 3") && ui.view().includes('data-cz="registrar"'));
    // Registrar uno: la app guarda el movimiento en save() y avisa con registrado(); aquí se simula ese paso
    const uber = R.faltantes.find(x => x.b.desc === "UBER TRIP").b;
    const id = api.addMov({ fecha: uber.fecha, desc: "uber", cat: "Transporte", monto: uber.monto, tipo: "Egreso", cuenta: "Cuenta SIMPLICITY", exportado: false, creado: "2026-10-24T00:00:00Z" });
    ui.registrado(uber.huella, id, {});
    R = ui.resultado();
    assert.strictEqual(R.registrados.length, 2); assert.strictEqual(R.faltantes.length, 2); assert.strictEqual(api.S.movs.length, 2);
    // Registrar varios con confirmación: crea uno por huella y salta lo ya decidido
    const [amazon, nomina] = ["AMAZON MX", "NOMINA"].map(d => R.faltantes.find(x => x.b.desc === d).b);
    const creados = ui.registrarVarios([{ h: amazon.huella, desc: "amazon", cat: "Otros" }, { h: nomina.huella, desc: "nómina", cat: "" }, { h: uber.huella, desc: "uber otra vez", cat: "Transporte" }]);
    assert.strictEqual(creados, 2); assert.strictEqual(api.S.movs.length, 4);
    const nom = api.S.movs.find(m => m.desc === "nómina");
    assert.strictEqual(nom.tipo, "Ingreso"); assert.strictEqual(nom.cat, "Ingreso"); cerca(nom.monto, 11652); assert.strictEqual(nom.exportado, false); assert.strictEqual(nom.cuenta, "Cuenta SIMPLICITY");
    assert.strictEqual(ui.registrarVarios([{ h: amazon.huella, desc: "amazon", cat: "Otros" }]), 0); assert.strictEqual(api.S.movs.length, 4);
    R = ui.resultado(); assert.strictEqual(R.faltantes.length, 0); assert.strictEqual(R.registrados.length, 4);
    // Lo guardado: la clave de la app conserva su forma; la de conciliación no trae importes ni descripciones
    const guardado = JSON.parse(store[LKEY]);
    assert.deepStrictEqual(Object.keys(guardado).sort(), ["cfg", "movs"]); assert.strictEqual(guardado.movs.length, 4);
    const cz = JSON.parse(store[CKEY]);
    assert.strictEqual(Object.keys(cz.decisiones).length, 3); assert.strictEqual(Object.keys(cz.archivos).length, 1);
    assert.ok(!store[CKEY].includes("AMAZON") && !store[CKEY].includes("11652") && !store[CKEY].includes("UBER"));
    // Reimportar el mismo archivo en una sesión nueva: todo reconocido, nada que registrar, se avisa que ya se concilió
    const { ui: ui2 } = cargarApp(store);
    ui2.cargarArchivo(archivo); await new Promise(r => setTimeout(r, 20));
    assert.ok(ui2._U.archivo.repetido && ui2._U.archivo.repetido.n === 5);
    ui2.click({ dataset: { cz: "conciliar" } });
    const R2 = ui2.resultado();
    assert.strictEqual(R2.faltantes.length, 0); assert.strictEqual(R2.registrados.length, 4); assert.strictEqual(R2.registrados.filter(r => r.manual).length, 3);
    assert.ok(ui2.view().includes("Nada falta"));
    // Ignorar y deshacer; limpiar decisiones pide confirmación doble
    const pago = R2.traspasos[0].b;
    ui2.click({ dataset: { cz: "ignorar", h: pago.huella } }); assert.strictEqual(ui2.resultado().ignorados.length, 1);
    ui2.click({ dataset: { cz: "deshacer", h: pago.huella } }); assert.strictEqual(ui2.resultado().ignorados.length, 0);
    // “Sí es un gasto” lo pasa a Faltantes con la opción de regresarlo; nunca lo registra solo
    ui2.click({ dataset: { cz: "normal", h: pago.huella } });
    assert.strictEqual(ui2.resultado().faltantes.length, 1); assert.strictEqual(ui2.resultado().traspasos.length, 0); assert.ok(ui2.view().includes("Es traspaso")); assert.strictEqual(api.S.movs.length, 4);
    ui2.click({ dataset: { cz: "deshacer", h: pago.huella } }); assert.strictEqual(ui2.resultado().traspasos.length, 1);
    ui2.click({ dataset: { cz: "cancelar" } }); assert.strictEqual(ui2._U.etapa, "cargar");
    const btn = { dataset: { cz: "limpiar" }, textContent: "" };
    ui2.click(btn); assert.strictEqual(Object.keys(ui2.estado().decisiones).length, 3);
    ui2.click(btn); assert.strictEqual(Object.keys(ui2.estado().decisiones).length, 0); assert.strictEqual(Object.keys(JSON.parse(store[CKEY]).decisiones).length, 0);
    assert.strictEqual(api.S.movs.length, 4);   // limpiar decisiones nunca toca movimientos
  });
  await t("Más › Conciliar: ajustar columnas a mano y archivo ilegible", async () => {
    const { ui } = cargarApp({});
    const texto = "Movimientos de la cuenta\n01/10/2026|OXXO|50.00|D\n02/10/2026|NOMINA|11652.00|C";
    ui.cargarArchivo({ name: "raro.txt", arrayBuffer: () => Promise.resolve(new TextEncoder().encode(texto).buffer) });
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(ui._U.etapa, "validar");
    const campos = { fecha: "0", desc: "1", monto: "2", tipoCol: "3", cargo: "", abono: "", id: "", formatoFecha: "dmy", inicio: "2", hoja: "" };
    const form = { dataset: { cz: "mapeo" }, querySelector: sel => { const k = sel.match(/name="(\w+)"/)[1]; return k in campos ? { value: campos[k] } : null; } };
    assert.ok(ui.submit(form));
    assert.deepStrictEqual(Array.from(ui._U.archivo.movs, m => [m.fecha, m.tipo, m.monto]), [["2026-10-01", "Egreso", 50], ["2026-10-02", "Ingreso", 11652]]);   // Array.from: copia al realm local
    ui.cargarArchivo({ name: "foto.xlsx", arrayBuffer: () => Promise.resolve(new Uint8Array(10).buffer) });
    await new Promise(r => setTimeout(r, 20));
    assert.ok(ui._U.msg.includes("No se pudo leer")); assert.ok(ui.view().includes("No se pudo leer"));
    // Fechas futuras (mes/día al revés) se avisan antes de conciliar; el botón de conciliar sigue pidiendo revisión
    ui.cargarArchivo({ name: "futuro.csv", arrayBuffer: () => Promise.resolve(new TextEncoder().encode("Fecha,Concepto,Cargo,Abono\n01/01/2099,X,1.00,").buffer) });
    await new Promise(r => setTimeout(r, 20));
    assert.ok(ui.view().includes("en el futuro") && ui.view().includes("Conciliar 1 movimiento"));
  });
  return n;
};

if (require.main === module) module.exports().then(n => { console.log(`\n${n} pruebas de conciliación OK`); process.exit(0); }).catch(e => { console.error("\n✗", e.stack || e.message); process.exit(1); });
