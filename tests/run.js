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
  const { parseQuick, toRow, toTSV, normTipo, normCat, margen, lineChart, colChart, barsH } = api;

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
