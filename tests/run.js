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
function cargar(store = {}) {
  const ctx = {
    module: { exports: {} }, console, URLSearchParams, Intl, Date, Set, JSON, Math, Object, Array, String, Number,
    document: { querySelector: () => stub(), querySelectorAll: () => [], addEventListener() {}, createElement: () => stub(), body: stub(), activeElement: null },
    window: { addEventListener() {}, scrollTo() {} },
    navigator: { onLine: false },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    location: { search: "" },
    setTimeout, clearTimeout, fetch: () => Promise.reject(new Error("sin red"))
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), ctx);
  return { api: ctx.module.exports, store };
}

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };
const { api } = cargar();
const { parseQuick, toRow, toTSV, normTipo, normCat } = api;

t("gasto con categoría por palabra", () => {
  const p = parseQuick("comida 145");
  assert.strictEqual(p.monto, 145); assert.strictEqual(p.tipo, "Egreso");
  assert.strictEqual(p.desc, "comida"); assert.strictEqual(p.cat, "Comida");
});
t("ingreso con + usa Tipo Ingreso (como Power BI)", () => {
  const p = parseQuick("+11652 nómina");
  assert.strictEqual(p.monto, 11652); assert.strictEqual(p.tipo, "Ingreso"); assert.strictEqual(p.cat, "Ingreso");
});
t("cantidad con comas y decimales", () => {
  const p = parseQuick("super walmart 1,234.50");
  assert.strictEqual(p.monto, 1234.5); assert.strictEqual(p.cat, "Super"); assert.strictEqual(p.desc, "super walmart");
});
t("uber → Transporte, oxxo → Comida", () => { assert.strictEqual(parseQuick("uber 87").cat, "Transporte"); assert.strictEqual(parseQuick("oxxo 15").cat, "Comida"); });
t("sin palabra conocida → sin categoría", () => assert.strictEqual(parseQuick("xyz 50").cat, null));
t("fila en formato Finanzas 2026", () => {
  const m = { id: "a", fecha: "2026-10-06", desc: "desayuno", cat: "Comida", monto: 85, tipo: "Egreso", cuenta: "Cuenta SIMPLICITY" };
  assert.strictEqual(toTSV([m]), "10\t06/10/26\tDESAYUNO\tComida\t$85.00\tEgreso\tCuenta SIMPLICITY");
  const r = toRow({ ...m, tipo: "Ingresos", cat: "Comida" });
  assert.strictEqual(r.categoria, "Ingreso"); assert.strictEqual(r.tipo, "Ingreso");
});
t("normalización de tipos y categorías del historial", () => {
  assert.strictEqual(normTipo("Ingresos"), "Ingreso"); assert.strictEqual(normTipo(" egreso"), "Egreso");
  assert.strictEqual(normCat("comida", "Egreso"), "Comida"); assert.strictEqual(normCat("SALIDA", "Egreso"), "Salida");
  assert.strictEqual(normCat("Libro", "Egreso"), "Libros"); assert.strictEqual(normCat("Otros", "Ingreso"), "Ingreso");
});
t("migración v1 → v2: Ingresos → Ingreso, Salud y bienestar → Salud", () => {
  const store = { "finanzas-bolsillo-v1": JSON.stringify({
    movs: [{ id: "1", fecha: "2026-10-01", desc: "nomina", cat: "Ingreso", monto: 100, tipo: "Ingresos", exportado: true },
           { id: "2", fecha: "2026-10-02", desc: "farmacia", cat: "Salud y bienestar", monto: 50, tipo: "Egreso", exportado: false }],
    cfg: { cuentas: ["Cuenta SIMPLICITY"], categorias: ["Comida", "Salud y bienestar", "Otros"], reglas: { "Salud y bienestar": ["farmacia"] }, sync: { url: "u", clave: "c" } } }) };
  const { api: a } = cargar(store);
  assert.strictEqual(a.S.movs[0].tipo, "Ingreso"); assert.strictEqual(a.S.movs[1].cat, "Salud");
  assert.ok(a.S.cfg.categorias.includes("Salud") && !a.S.cfg.categorias.includes("Salud y bienestar"));
  assert.ok(a.S.cfg.categorias.includes("Inversion")); assert.strictEqual(a.S.cfg.sync.url, "u");
  assert.strictEqual(a.S.cfg.v, 2);
});
t("dashboards no duplican lo ya enviado a la hoja", () => {
  const store = {
    "finanzas-bolsillo-v1": JSON.stringify({ movs: [
      { id: "a", fecha: "2026-10-01", desc: "x", cat: "Comida", monto: 10, tipo: "Egreso", exportado: true, enviado: "2026-10-01T10:00:00Z" },
      { id: "b", fecha: "2026-10-02", desc: "y", cat: "Comida", monto: 20, tipo: "Egreso", exportado: true, enviado: "2026-10-03T10:00:00Z" },
      { id: "c", fecha: "2026-10-03", desc: "z", cat: "Comida", monto: 30, tipo: "Egreso", exportado: false }] }),
    "finanzas-bolsillo-datos": JSON.stringify({ leido: "2026-10-02T00:00:00Z", filas: [["2026-10-01", "X", "Comida", 10, "Egreso", "C"]] })
  };
  const { api: a } = cargar(store);
  const total = a.filas().reduce((s, r) => s + r.monto, 0);
  assert.strictEqual(total, 60); // 10 de la hoja + 20 enviado después de leer + 30 pendiente
});

const datos = process.argv[2];
if (datos) {
  const filas = JSON.parse(fs.readFileSync(datos, "utf8"));
  const { api: a } = cargar({ "finanzas-bolsillo-datos": JSON.stringify({ leido: "2099-01-01", filas }) });
  const pbi = { 2022: [224953, 153990], 2023: [487995, 386184], 2024: [746131, 596583], 2025: [528220, 475092] };
  t("totales por año = Power BI (±$2)", () => {
    for (const [y, [i, e]] of Object.entries(pbi)) {
      const rs = a.filas().filter(r => r.y === +y);
      const I = rs.filter(r => r.tipo === "Ingreso").reduce((s, r) => s + r.monto, 0);
      const E = rs.filter(r => r.tipo === "Egreso").reduce((s, r) => s + r.monto, 0);
      assert.ok(Math.abs(I - i) <= 2 && Math.abs(E - e) <= 2, `${y}: ${I} / ${E}`);
    }
  });
}
console.log(`\n${n} pruebas OK`);
