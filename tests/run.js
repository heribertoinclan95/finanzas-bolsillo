// Pruebas sin dependencias: carga app.js con un DOM falso y revisa las funciones puras.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "dataset" ? {} : stub()),
  apply: () => stub(),
  set: () => true
});
const ctx = {
  module: { exports: {} }, console, URLSearchParams, Intl, Date, Set, JSON, Math, Object, Array, String, Number,
  document: { querySelector: () => stub(), querySelectorAll: () => [], addEventListener() {}, createElement: () => stub(), body: stub() },
  window: { addEventListener() {}, scrollTo() {} },
  navigator: { onLine: true },
  localStorage: { getItem: () => null, setItem() {} },
  location: { search: "" },
  setTimeout, clearTimeout
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), ctx);
const { parseQuick, toRow, toTSV } = ctx.module.exports;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

t("gasto con categoría por palabra", () => {
  const p = parseQuick("comida 145");
  assert.strictEqual(p.monto, 145); assert.strictEqual(p.tipo, "Egreso");
  assert.strictEqual(p.desc, "comida"); assert.strictEqual(p.cat, "Comida");
});
t("ingreso con +", () => {
  const p = parseQuick("+11652 nómina");
  assert.strictEqual(p.monto, 11652); assert.strictEqual(p.tipo, "Ingresos"); assert.strictEqual(p.cat, "Ingreso");
});
t("cantidad con comas y decimales", () => {
  const p = parseQuick("super walmart 1,234.50");
  assert.strictEqual(p.monto, 1234.5); assert.strictEqual(p.cat, "Super"); assert.strictEqual(p.desc, "super walmart");
});
t("uber → Transporte", () => assert.strictEqual(parseQuick("uber 87").cat, "Transporte"));
t("sin palabra conocida → sin categoría", () => assert.strictEqual(parseQuick("xyz 50").cat, null));
t("fila en formato Finanzas 2026", () => {
  const m = { id: "a", fecha: "2026-10-06", desc: "desayuno", cat: "Comida", monto: 85, tipo: "Egreso", cuenta: "Cuenta SIMPLICITY" };
  assert.strictEqual(toTSV([m]), "10\t06/10/26\tDESAYUNO\tComida\t$85.00\tEgreso\tCuenta SIMPLICITY");
  const r = toRow({ ...m, tipo: "Ingresos", cat: "Comida" });
  assert.strictEqual(r.categoria, "Ingreso"); assert.strictEqual(r.tipo, "Ingresos");
});
console.log(`\n${n} pruebas OK`);
