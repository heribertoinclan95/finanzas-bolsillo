// Pruebas sin dependencias: carga app.js con un DOM falso y revisa las funciones puras.
// Opcional: node tests/run.js ruta/a/datos.json  → compara totales por año con los de Power BI.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "dataset" ? {} : stub()),
  apply: () => stub(),
  set: () => true
});
// store: localStorage falso · red: implementación de fetch (por defecto, sin internet)
function cargar(store = {}, red) {
  const ctx = {
    module: { exports: {} }, console, URLSearchParams, Intl, Date, Set, JSON, Math, Object, Array, String, Number,
    document: { querySelector: () => stub(), querySelectorAll: () => [], addEventListener() {}, createElement: () => stub(), body: stub(), activeElement: null },
    window: { addEventListener() {}, scrollTo() {} },
    navigator: { onLine: false },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    location: { search: "" },
    setTimeout, clearTimeout, fetch: red || (() => Promise.reject(new Error("sin red")))
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), ctx);
  return { api: ctx.module.exports, store };
}

const LKEY = "finanzas-bolsillo-v1", DKEY = "finanzas-bolsillo-datos";
const mov = (id, fecha, desc, cat, monto, tipo = "Egreso", extra = {}) => ({ id, fecha, desc, cat, monto, tipo, cuenta: "Cuenta SIMPLICITY", exportado: false, creado: fecha + "T12:00:00Z", ...extra });
const conMovs = (movs, cfg) => ({ [LKEY]: JSON.stringify({ movs, cfg: { v: 2, ...(cfg || {}) } }) });
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg || `${a} ≠ ${b}`);

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("✓", name); };

(async () => {
  const { api } = cargar();
  const { parseQuick, toRow, toTSV, normTipo, normCat, margen, lineChart, colChart, barsH, instrumento, parseInstrumentos } = api;

  /* ---- Captura rápida y formato de la hoja ---- */
  await t("gasto con categoría por palabra", () => {
    const p = parseQuick("comida 145");
    assert.strictEqual(p.monto, 145); assert.strictEqual(p.tipo, "Egreso");
    assert.strictEqual(p.desc, "comida"); assert.strictEqual(p.cat, "Comida");
  });
  await t("ingreso con + usa Tipo Ingreso (como Power BI)", () => {
    const p = parseQuick("+11652 nómina");
    assert.strictEqual(p.monto, 11652); assert.strictEqual(p.tipo, "Ingreso"); assert.strictEqual(p.cat, "Ingreso");
  });
  await t("cantidad con comas y decimales", () => {
    const p = parseQuick("super walmart 1,234.50");
    assert.strictEqual(p.monto, 1234.5); assert.strictEqual(p.cat, "Super"); assert.strictEqual(p.desc, "super walmart");
  });
  await t("uber → Transporte, oxxo → Comida", () => { assert.strictEqual(parseQuick("uber 87").cat, "Transporte"); assert.strictEqual(parseQuick("oxxo 15").cat, "Comida"); });
  await t("sin palabra conocida → sin categoría", () => assert.strictEqual(parseQuick("xyz 50").cat, null));
  await t("fila en formato Finanzas 2026", () => {
    const m = { id: "a", fecha: "2026-10-06", desc: "desayuno", cat: "Comida", monto: 85, tipo: "Egreso", cuenta: "Cuenta SIMPLICITY" };
    assert.strictEqual(toTSV([m]), "10\t06/10/26\tDESAYUNO\tComida\t$85.00\tEgreso\tCuenta SIMPLICITY");
    const r = toRow({ ...m, tipo: "Ingresos", cat: "Comida" });
    assert.strictEqual(r.categoria, "Ingreso"); assert.strictEqual(r.tipo, "Ingreso");
  });
  await t("normalización de tipos y categorías del historial", () => {
    assert.strictEqual(normTipo("Ingresos"), "Ingreso"); assert.strictEqual(normTipo(" egreso"), "Egreso");
    assert.strictEqual(normCat("comida", "Egreso"), "Comida"); assert.strictEqual(normCat("SALIDA", "Egreso"), "Salida");
    assert.strictEqual(normCat("Libro", "Egreso"), "Libros"); assert.strictEqual(normCat("Otros", "Ingreso"), "Ingreso");
  });
  await t("migración v1 → v2: Ingresos → Ingreso, Salud y bienestar → Salud", () => {
    const store = { [LKEY]: JSON.stringify({
      movs: [{ id: "1", fecha: "2026-10-01", desc: "nomina", cat: "Ingreso", monto: 100, tipo: "Ingresos", exportado: true },
             { id: "2", fecha: "2026-10-02", desc: "farmacia", cat: "Salud y bienestar", monto: 50, tipo: "Egreso", exportado: false }],
      cfg: { cuentas: ["Cuenta SIMPLICITY"], categorias: ["Comida", "Salud y bienestar", "Otros"], reglas: { "Salud y bienestar": ["farmacia"] }, sync: { url: "u", clave: "c" } } }) };
    const { api: a } = cargar(store);
    assert.strictEqual(a.S.movs[0].tipo, "Ingreso"); assert.strictEqual(a.S.movs[1].cat, "Salud");
    assert.ok(a.S.cfg.categorias.includes("Salud") && !a.S.cfg.categorias.includes("Salud y bienestar"));
    assert.ok(a.S.cfg.categorias.includes("Inversion")); assert.strictEqual(a.S.cfg.sync.url, "u");
    assert.strictEqual(a.S.cfg.v, 2);
  });
  await t("dashboards no duplican lo ya enviado a la hoja", () => {
    const store = {
      [LKEY]: JSON.stringify({ movs: [
        { id: "a", fecha: "2026-10-01", desc: "x", cat: "Comida", monto: 10, tipo: "Egreso", exportado: true, enviado: "2026-10-01T10:00:00Z" },
        { id: "b", fecha: "2026-10-02", desc: "y", cat: "Comida", monto: 20, tipo: "Egreso", exportado: true, enviado: "2026-10-03T10:00:00Z" },
        { id: "c", fecha: "2026-10-03", desc: "z", cat: "Comida", monto: 30, tipo: "Egreso", exportado: false }] }),
      [DKEY]: JSON.stringify({ leido: "2026-10-02T00:00:00Z", filas: [["2026-10-01", "X", "Comida", 10, "Egreso", "C"]] })
    };
    const { api: a } = cargar(store);
    const total = a.filas().reduce((s, r) => s + r.monto, 0);
    assert.strictEqual(total, 60); // 10 de la hoja + 20 enviado después de leer + 30 pendiente
  });

  /* ---- Inicio: margen del mes ---- */
  await t("totales del mes coinciden con filas(): gastos = gasto sin inversión + inversión", () => {
    const { api: a } = cargar(conMovs([
      mov("i", "2026-10-01", "nómina", "Ingreso", 12000, "Ingreso"), mov("g1", "2026-10-02", "super", "Super", 1500.5),
      mov("g2", "2026-10-03", "uber", "Transporte", 99.5), mov("v", "2026-10-04", "cetes", "Inversion", 2400),
      mov("otro", "2026-09-30", "cena", "Comida", 400)]));
    const r = a.resumenMes("2026-10", "2026-10-24"), oct = a.filas().filter(x => x.y === 2026 && x.m === 10);
    assert.strictEqual(r.n, 4);
    cerca(r.ingresos, oct.filter(x => x.tipo === "Ingreso").reduce((s, x) => s + x.monto, 0));
    cerca(r.gastos, oct.filter(x => x.tipo === "Egreso").reduce((s, x) => s + x.monto, 0));
    cerca(r.gastos, r.consumo + r.inversion); cerca(r.inversion, 2400); cerca(r.consumo, 1600);
  });
  await t("disponible aparta la meta sin descontar dos veces la inversión", () => {
    // ingresos 10,000 · gasto 3,000 · inversión 2,500 → la meta (20% = 2,000) ya está cubierta
    const { api: a } = cargar(conMovs([mov("i", "2026-10-01", "nómina", "Ingreso", 10000, "Ingreso"), mov("g", "2026-10-02", "super", "Super", 3000), mov("v", "2026-10-03", "cetes", "Inversion", 2500)]));
    const r = a.resumenMes("2026-10", "2026-10-24");
    cerca(r.meta, 2000); cerca(r.reserva, 2500);
    cerca(r.disponible, 4500);                        // 10000 − 3000 − 2500, no 10000 − 3000 − 2500 − 2000
    assert.strictEqual(r.metaCumplida, true); cerca(r.faltaMeta, 0);
    const m = margen(10000, 3000, 500, 0.2);         // inversión por debajo de la meta → se aparta la meta completa
    cerca(m.disponible, 5000); cerca(m.faltaMeta, 1500); assert.strictEqual(m.metaCumplida, false);
  });
  await t("ingreso real separado del estimado (promedio de 3 meses) y marcado aparte", () => {
    const prev = [mov("j", "2026-07-01", "nómina", "Ingreso", 10000, "Ingreso"), mov("a", "2026-08-01", "nómina", "Ingreso", 12000, "Ingreso"), mov("s", "2026-09-01", "nómina", "Ingreso", 11000, "Ingreso")];
    const { api: a } = cargar(conMovs([...prev, mov("g", "2026-10-02", "super", "Super", 1000)]));
    const r = a.resumenMes("2026-10", "2026-10-05");
    cerca(r.ingresos, 0); cerca(r.disponible, -1000);                 // lo real no incluye lo que no has cobrado
    cerca(r.estimado.ingresos, 11000); cerca(r.estimado.disponible, 11000 - 1000 - 2200);
    const { api: b } = cargar(conMovs([...prev, mov("g", "2026-10-02", "super", "Super", 1000), mov("i", "2026-10-03", "nómina", "Ingreso", 11500, "Ingreso")]));
    const r2 = b.resumenMes("2026-10", "2026-10-05");                  // ya cobraste lo habitual → sin estimado
    assert.strictEqual(r2.estimado, null); cerca(r2.ingresos, 11500); cerca(r2.disponible, 11500 - 1000 - 2300);
    assert.strictEqual(a.resumenMes("2026-09", "2026-10-05").estimado, null);   // en un mes pasado no se estima
    assert.strictEqual(a.promIngresos3m(a.filas(), "2026-07"), null);           // sin meses previos con ingresos
  });
  await t("mes sin movimientos y app vacía: ceros, sin estimado ni diario", () => {
    const { api: a } = cargar(conMovs([mov("x", "2026-08-01", "comida", "Comida", 100)]));
    const r = a.resumenMes("2026-10", "2026-10-24");
    assert.strictEqual(r.n, 0); cerca(r.ingresos, 0); cerca(r.gastos, 0); cerca(r.disponible, 0); cerca(r.diario, 0);
    assert.strictEqual(r.estimado, null); assert.strictEqual(r.metaCumplida, false); assert.strictEqual(r.ultimos.length, 1);
    const v = cargar().api.resumenMes("2026-10", "2026-10-24");
    cerca(v.disponible, 0); assert.strictEqual(v.ultimos.length, 0);
  });
  await t("disponible negativo se reporta como tal y el diario queda en cero", () => {
    const { api: a } = cargar(conMovs([mov("i", "2026-10-01", "nómina", "Ingreso", 1000, "Ingreso"), mov("g", "2026-10-02", "renta", "Renta", 5000)]));
    const r = a.resumenMes("2026-10", "2026-10-24");
    cerca(r.disponible, 1000 - 5000 - 200); cerca(r.diario, 0); cerca(r.faltaMeta, 200);
  });
  await t("gasto diario sugerido reparte el margen en los días que faltan, solo en el mes en curso", () => {
    const { api: a } = cargar(conMovs([mov("i", "2026-10-01", "nómina", "Ingreso", 10000, "Ingreso"), mov("g", "2026-10-02", "super", "Super", 2000)]));
    const r = a.resumenMes("2026-10", "2026-10-24");
    cerca(r.disponible, 6000); assert.strictEqual(r.diasRestantes, 8); cerca(r.diario, 750);
    const p = a.resumenMes("2026-10", "2026-11-03");
    assert.strictEqual(p.esActual, false); assert.strictEqual(p.diasRestantes, 0); cerca(p.diario, 0);
  });
  await t("últimos movimientos: los 5 más recientes, primero lo capturado en el cel", () => {
    const store = conMovs([mov("loc", "2026-10-24", "uber", "Transporte", 87)]);
    store[DKEY] = JSON.stringify({ leido: "2026-10-20T00:00:00Z", filas: [
      ["2026-10-24", "SUPER", "Super", 500, "Egreso", "C"], ["2026-10-23", "CAFE", "Comida", 60, "Egreso", "C"], ["2026-10-22", "RENTA", "Renta", 9000, "Egreso", "C"],
      ["2026-10-21", "GYM", "Salud", 700, "Egreso", "C"], ["2026-10-20", "LIBRO", "Libros", 300, "Egreso", "C"], ["2026-09-30", "CENA", "Comida", 400, "Egreso", "C"]] });
    const u = cargar(store).api.resumenMes("2026-10", "2026-10-24").ultimos;
    assert.strictEqual(u.length, 5); assert.strictEqual(u[0].desc, "uber"); assert.ok(u[0].local && u[0].pendiente);
    assert.deepStrictEqual([...u.map(x => x.fecha)], ["2026-10-24", "2026-10-24", "2026-10-23", "2026-10-22", "2026-10-21"]);   // copia al realm local: vm usa otro Array
  });

  /* ---- Sincronización e integridad de los datos locales ---- */
  await t("enviar a la hoja marca exportado, no duplica y conserva la clave y forma de localStorage", async () => {
    const store = conMovs([mov("a", "2026-10-01", "x", "Comida", 10), mov("b", "2026-10-02", "y", "Comida", 20)], { sync: { url: "https://script.google.com/x", clave: "k" } });
    store[DKEY] = JSON.stringify({ leido: "2026-10-01T00:00:00Z", filas: [] });
    let enviadas = null;
    const red = (_url, opts) => { const body = JSON.parse(opts.body); enviadas = body.filas; return Promise.resolve({ json: () => Promise.resolve({ ok: true, ids: body.filas.map(f => f.id), agregadas: body.filas.length, repetidas: 0 }) }); };
    const { api: a, store: s } = cargar(store, red);
    await a.sendPending();
    assert.strictEqual(enviadas.length, 2); assert.ok(a.S.movs.every(m => m.exportado && m.enviado));
    cerca(a.filas().reduce((tot, r) => tot + r.monto, 0), 30);          // enviados después de la última lectura: cuentan una sola vez
    const guardado = JSON.parse(s[LKEY]);
    assert.deepStrictEqual(Object.keys(guardado).sort(), ["cfg", "movs"]);
    assert.strictEqual(guardado.movs.length, 2); assert.strictEqual(guardado.cfg.v, 2);
    assert.strictEqual(new Set(guardado.movs.map(m => m.id)).size, 2);
    assert.deepStrictEqual(Object.keys(guardado.movs[0]).sort(), ["cat", "creado", "cuenta", "desc", "enviado", "exportado", "fecha", "id", "monto", "tipo"]);
    enviadas = null; await a.sendPending(); assert.strictEqual(enviadas, null);   // ya no hay pendientes: no se llama a la hoja
  });

  /* ---- Fase 3: inversión (meta por mes, instrumentos, historial) ---- */
  const d0 = new Date(), ymHoy = d0.getFullYear() + "-" + String(d0.getMonth() + 1).padStart(2, "0");
  const addM = (ym, k) => { let [y, m] = ym.split("-").map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + "-" + String(m).padStart(2, "0"); };
  const invMov = (id, fecha, desc, monto) => mov(id, fecha, desc, "Inversion", monto);
  const ingMov = (id, fecha, monto) => mov(id, fecha, "nómina", "Ingreso", monto, "Ingreso");

  await t("instrumentos: palabra completa, Sin clasificar sin coincidencia y Por revisar si coinciden dos", () => {
    const inst = { NU: ["nu"], GBM: ["gbm"], Bitcoin: ["bitcoin", "bitso", "btc"], CETES: ["cetes", "cetesdirecto"] };
    assert.strictEqual(instrumento("INVERSION NU", inst), "NU");
    assert.strictEqual(instrumento("nuevo celular", inst), "Sin clasificar");      // "nu" no vale como prefijo
    assert.strictEqual(instrumento("Compra en Bitsó", inst), "Bitcoin");          // acentos y mayúsculas no importan
    assert.strictEqual(instrumento("CETES DIRECTO", inst), "CETES");
    assert.strictEqual(instrumento("GBM Y NU", inst), "Por revisar");
    assert.strictEqual(instrumento("", inst), "Sin clasificar");
    assert.deepStrictEqual([...parseInstrumentos("NU: nu, nubank\n\nGBM: gbm").NU], ["nu", "nubank"]);
    assert.strictEqual(parseInstrumentos("sin dos puntos"), null); assert.strictEqual(parseInstrumentos("NU:"), null);
  });
  await t("meta por mes: % vigente fechado, estimado antes del primer registro y cambios sin reescribir el pasado", () => {
    const { api: a } = cargar(conMovs([], { inversion: { pct: 0.2, reparto: [["NU", 1]] } }));
    const inv = a.S.cfg.inversion, m1 = addM(ymHoy, 5), m2 = addM(ymHoy, 8);
    assert.deepStrictEqual([...inv.metas.map(m => m.desde)], [ymHoy]); cerca(inv.metas[0].pct, 0.2);
    assert.deepStrictEqual({ ...a.pctObjetivo("2024-05", inv) }, { pct: 0.2, estimado: true });   // antes del registro: supuesto, y marcado
    assert.deepStrictEqual({ ...a.pctObjetivo(ymHoy, inv) }, { pct: 0.2, estimado: false });
    a.registrarMeta(0.22, ymHoy);                  // cambio en el mismo mes del estreno: se agrega; la referencia histórica (20%) no se toca
    assert.strictEqual(inv.metas.length, 2); cerca(inv.metas[0].pct, 0.2); cerca(a.pctObjetivo("2024-05", inv).pct, 0.2); cerca(a.pctObjetivo(ymHoy, inv).pct, 0.22);
    a.registrarMeta(0.25, m1);
    cerca(a.pctObjetivo(addM(m1, -1), inv).pct, 0.22); cerca(a.pctObjetivo(m1, inv).pct, 0.25); cerca(a.pctObjetivo(m2, inv).pct, 0.25); cerca(inv.pct, 0.25);
    a.registrarMeta(0.3, m1);                      // mismo mes (y no es la primera entrada): corrige el registro, no agrega otro
    assert.strictEqual(inv.metas.length, 3); cerca(inv.metas[2].pct, 0.3); cerca(inv.metas[0].pct, 0.2);
    a.registrarMeta(0.3, m2);                      // sin cambio de %: no agrega
    assert.strictEqual(inv.metas.length, 3);
    // % vigente distinto al último registro (p. ej. guardado por una versión vieja de la app): se registra desde hoy sin tocar lo anterior
    const { api: b } = cargar(conMovs([], { inversion: { pct: 0.25, reparto: [["NU", 1]], instrumentos: { NU: ["nu"] }, metas: [{ desde: "2020-01", pct: 0.2 }] } }));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(b.S.cfg.inversion.metas)), [{ desde: "2020-01", pct: 0.2 }, { desde: ymHoy, pct: 0.25 }]);
  });
  await t("inversionMes: meta con ingresos reales, invertido, pendiente, cumplimiento > 100% y distribución objetivo vs real", () => {
    const { api: a } = cargar(conMovs([ingMov("i", "2026-10-01", 10000), mov("g", "2026-10-02", "super", "Super", 3000),
      invMov("a", "2026-10-03", "NU", 1500), invMov("b", "2026-10-04", "GBM", 300), invMov("c", "2026-10-05", "Bitso", 700),
      invMov("d", "2026-10-06", "CETES", 400), invMov("e", "2026-10-07", "aportación", 100), invMov("f", "2026-10-08", "GBM y NU", 50)]));
    const r = a.inversionMes("2026-10");
    cerca(r.ingresos, 10000); cerca(r.meta, 2000); cerca(r.invertido, 3050); cerca(r.pendiente, 0); cerca(r.extra, 1050); cerca(r.cumplimiento, 1.525); assert.ok(r.cumplida);
    const d = a.distribucion(r.movs, r.meta), f = n => d.filas.find(x => x.nombre === n);
    cerca(f("NU").objetivo, 1200); cerca(f("NU").real, 1500); cerca(f("NU").diferencia, 300); cerca(f("NU").falta, 0);
    cerca(f("GBM").objetivo, 400); cerca(f("GBM").real, 300); cerca(f("GBM").diferencia, -100); cerca(f("GBM").falta, 100);
    cerca(f("Bitcoin").real, 700); cerca(f("CETES").real, 400); assert.ok(f("CETES").fuera); cerca(f("CETES").objetivo, 0);
    cerca(d.sinClasificar, 100); cerca(d.porRevisar, 50); cerca(d.total, 3050); assert.deepStrictEqual([...d.descsRev], ["GBM Y NU"]);
    cerca(d.filas.reduce((s, x) => s + x.real, 0) + d.sinClasificar + d.porRevisar, r.invertido);   // nada se pierde ni se cuenta dos veces
    const m = a.resumenMes("2026-10", "2026-10-24");                                                 // Inicio: mismos números que antes
    cerca(m.inversion, 3050); cerca(m.consumo, 3000); cerca(m.disponible, 10000 - 3000 - 3050); cerca(m.meta, 2000);
  });
  await t("meses sin ingresos o sin inversión: sin meta no hay cumplimiento, sin inversión el pendiente es la meta", () => {
    const { api: a } = cargar(conMovs([invMov("a", "2026-09-03", "NU", 500), ingMov("i", "2026-08-01", 8000)]));
    const s = a.inversionMes("2026-09"); cerca(s.meta, 0); cerca(s.pendiente, 0); assert.strictEqual(s.cumplimiento, null); assert.strictEqual(s.cumplida, false); cerca(s.invertido, 500);
    const ag = a.inversionMes("2026-08"); cerca(ag.meta, 1600); cerca(ag.pendiente, 1600); cerca(ag.cumplimiento, 0); cerca(ag.invertido, 0);
    const v = a.inversionMes("2026-07"); cerca(v.meta, 0); cerca(v.invertido, 0); assert.strictEqual(v.cumplimiento, null);
    const d = a.distribucion([], 0); assert.strictEqual(d.filas.length, 3); cerca(d.total, 0); cerca(d.sinClasificar, 0);
  });
  await t("historial: racha, acumulado contra metas, meses por debajo, proyección y totales iguales a filas()", () => {
    // jun–oct 2026 con ingreso 10,000 (meta 2,000): jun ✓ · jul ✗ · ago ✓ (125%) · sep ✓ · oct en curso, todavía no
    const movs = ["06", "07", "08", "09", "10"].map(m => ingMov("i" + m, `2026-${m}-01`, 10000));
    [["06", 2000], ["07", 1000], ["08", 2500], ["09", 2000], ["10", 500]].forEach(([m, v]) => movs.push(invMov("v" + m, `2026-${m}-05`, "NU", v)));
    movs.push(invMov("may", "2026-05-10", "NU", 300));   // mayo: inversión sin ingresos → sin meta; no rompe la racha
    const { api: a } = cargar(conMovs(movs));
    const h = a.historialInversion("2026-10");
    assert.deepStrictEqual([...h.meses.map(m => m.ym)], ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    assert.strictEqual(h.racha, 2);                                       // sep y ago; octubre en curso no rompe; julio sí
    cerca(h.acumInv, 8300); cerca(h.acumMeta, 10000);
    assert.deepStrictEqual([...h.porDebajo.map(m => m.ym)], ["2026-07"]);  // octubre no cuenta hasta cerrar
    cerca(h.ritmo, (300 + 2000 + 1000 + 2500 + 2000) / 5); cerca(h.proyeccion12, h.ritmo * 12);
    cerca(h.meses.find(m => m.ym === "2026-08").cumplimiento, 1.25);
    const all = a.filas();
    cerca(h.acumInv, all.filter(r => r.cat === "Inversion").reduce((s, r) => s + r.monto, 0));
    cerca(h.meses.reduce((s, m) => s + m.ingresos, 0), all.filter(r => r.tipo === "Ingreso").reduce((s, r) => s + r.monto, 0));
    assert.ok(h.meses.filter(m => m.ym < ymHoy).every(m => m.estimado));  // sin registro previo: metas estimadas, marcadas
  });
  await t("migración de inversión: completa lo que falta sin depender de cfg.v, es idempotente y no toca movimientos", () => {
    const movs = [mov("a", "2026-10-01", "x", "Comida", 10), invMov("b", "2026-10-02", "NU", 20)];
    for (const v of [2, 3]) {   // la fase de seguridad también sube cfg.v a 3: debe dar igual
      const store = { [LKEY]: JSON.stringify({ movs, cfg: { v, cuentas: ["C"], categorias: ["Comida", "Inversion", "Otros"], reglas: {}, inversion: { pct: 0.15, reparto: [["NU", 0.5], ["Vanguard", 0.5]] }, sync: { url: "u", clave: "c" } } }) };
      const { api: a, store: s } = cargar(store);
      const inv = a.S.cfg.inversion;
      cerca(inv.pct, 0.15); assert.deepStrictEqual([...inv.reparto.map(r => r[0])], ["NU", "Vanguard"]);
      assert.deepStrictEqual([...inv.instrumentos.Vanguard], ["vanguard"]); assert.deepStrictEqual([...inv.instrumentos.CETES], ["cetes", "cetesdirecto"]);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(inv.metas)), [{ desde: ymHoy, pct: 0.15 }]);
      assert.strictEqual(a.S.cfg.v, v); assert.strictEqual(a.S.cfg.sync.url, "u");
      assert.strictEqual(JSON.stringify(JSON.parse(s[LKEY]).movs), JSON.stringify(movs));
      const antes = s[LKEY]; a.migrate(); assert.strictEqual(s[LKEY], antes);   // segunda pasada: nada cambia
    }
    const nueva = cargar().api.S.cfg.inversion;                                  // app recién instalada
    assert.strictEqual(nueva.metas.length, 1); assert.ok(nueva.instrumentos.NU && nueva.instrumentos.Bitcoin);
  });
  await t("pantalla Inversión: resumen del mes, Sin clasificar, nota de metas estimadas y selector de año", () => {
    const { api: a } = cargar(conMovs([ingMov("i", ymHoy + "-01", 10000), invMov("a", ymHoy + "-02", "NU", 500), invMov("b", ymHoy + "-03", "aportación", 100),
      ingMov("i2", "2025-03-01", 5000), invMov("c", "2025-03-05", "CETES", 800)]));
    a.S.an.anio = "Todos";
    const html = a.anInversion();
    assert.ok(html.includes("Te faltan") && html.includes("Sin clasificar") && html.includes("Meta estimada") && html.includes('id="fAnio"'));
    assert.ok(html.includes("CETES") && html.includes("Meta vs invertido"));
    a.S.an.anio = ymHoy.slice(0, 4);
    assert.ok(a.anInversion().includes("Ene"));
    assert.ok(a.viewInicio().includes('data-vista="inversion"'));                 // Inicio solo gana el enlace al detalle
  });

  /* ---- Gráficas ---- */
  await t("gráficas: datos para el tooltip, valores sobre barras cuando caben y tabla Ver datos", () => {
    const l = lineChart([{ name: "Ingresos", values: [100, 200, null], color: "red" }], ["Ene", "Feb", "Mar"], { names: ["enero", "febrero", "marzo"] });
    assert.ok(l.includes('data-chart="') && l.includes('<g class="tip"')); assert.ok(l.includes("Ver datos"));
    assert.ok(l.includes("<td>febrero</td>") && l.includes("$200")); assert.ok(!l.includes("<td>marzo</td>"));
    const pocas = colChart([1200, 2400], ["2025", "2026"]);
    assert.ok(pocas.includes('class="val"') && pocas.includes("$2k"));
    const muchas = colChart(Array(12).fill(100), Array(12).fill("x"));
    assert.ok(!muchas.includes('class="val"')); assert.strictEqual((muchas.match(/class="bar"/g) || []).length, 12);
    const b = barsH([["Comida", 1234.5], ["Uber", 500]], 1734.5);
    assert.ok(b.includes('<button type="button" class="bar"') && b.includes("1,234.5") && b.includes("71.2%"));
    assert.ok(barsH([["Comida", 10]], 10, { drill: true }).includes('data-vista="categorias"'));
  });

  /* ---- Comparación con Power BI (opcional) ---- */
  const datos = process.argv[2];
  if (datos) {
    const filas = JSON.parse(fs.readFileSync(datos, "utf8"));
    const { api: a } = cargar({ [DKEY]: JSON.stringify({ leido: "2099-01-01", filas }) });
    const pbi = { 2022: [224953, 153990], 2023: [487995, 386184], 2024: [746131, 596583], 2025: [528220, 475092] };
    await t("totales por año = Power BI (±$2)", () => {
      for (const [y, [i, e]] of Object.entries(pbi)) {
        const rs = a.filas().filter(r => r.y === +y);
        const I = rs.filter(r => r.tipo === "Ingreso").reduce((s, r) => s + r.monto, 0);
        const E = rs.filter(r => r.tipo === "Egreso").reduce((s, r) => s + r.monto, 0);
        assert.ok(Math.abs(I - i) <= 2 && Math.abs(E - e) <= 2, `${y}: ${I} / ${E}`);
      }
    });
  }
  console.log(`\n${n} pruebas OK`);
  process.exit(0);
})().catch(e => { console.error("\n✗", e.message); process.exit(1); });
