/* Finanzas de Bolsillo — app de una sola página, sin dependencias.
   Datos:
   - S.movs   → lo que capturas en el iPhone (localStorage, clave LKEY)
   - S.datos  → copia de tu Google Sheet (Histórico + Movimientos) para los dashboards (clave DKEY)
   Los dashboards usan filas() = hoja + lo capturado que aún no llega a la hoja.
   Hoja: callScript() habla con el Worker protegido (/api/hoja); la URL y la clave del Apps Script son secretos del Worker.
   El modo "directo" (URL y clave en el cel) solo existe mientras dura la transición; se cambia en Más › Google Sheet.
   Pestañas: Inicio (margen del mes en curso) · Movimientos · Análisis (subpestañas) · Más (hoja, ajustes, respaldo). */
(() => {
"use strict";

/* ---------- Configuración ---------- */
const CFG_VERSION = 3;
const CATEGORIAS = ["Comida", "Super", "Transporte", "Salida", "Subscripcion", "Salud", "Renta", "Entretenimiento", "Libros", "Inversion", "Educacion", "Negocio", "SAT", "Otros"];
const DEFAULT_CFG = {
  v: CFG_VERSION,
  cuentas: ["Cuenta SIMPLICITY", "AMEX", "Efectivo"],
  categorias: CATEGORIAS.slice(),
  reglas: {
    "Comida": ["desayuno", "comida", "cena", "postre", "agua", "cafe", "café", "dogo", "tacos", "lunch", "antojo", "oxxo"],
    "Super": ["super", "súper", "walmart", "soriana", "chedraui", "costco", "sams", "extra"],
    "Transporte": ["uber", "didi", "taxi", "gasolina", "camion", "camión", "caseta", "estacionamiento"],
    "Salida": ["salida", "bar", "cerveza", "antro", "fiesta"],
    "Subscripcion": ["netflix", "spotify", "claude", "chatgpt", "icloud", "youtube", "prime", "telcel", "suscripcion", "suscripción", "subscripcion"],
    "Salud": ["farmacia", "doctor", "befit", "gym", "gimnasio", "medicina", "dentista", "consulta"],
    "Renta": ["renta"],
    "Entretenimiento": ["cine", "concierto", "boletos", "juego"],
    "Libros": ["libro", "libros", "kindle"],
    "Inversion": ["cetes", "gbm", "bitso", "inversion", "inversión", "nu"],
    "Educacion": ["curso", "colegiatura", "diplomado"],
    "SAT": ["sat", "impuesto"],
    "Otros": ["ropa", "topps", "apuesta", "regalo"]
  },
  inversion: { pct: 0.20, reparto: [["NU", 0.6], ["GBM", 0.2], ["Bitcoin", 0.2]] },
  sync: { modo: "worker", url: "", clave: "" }   // modo: "worker" (por el Worker protegido) · "directo" (transición: URL y clave en el cel)
};
const LKEY = "finanzas-bolsillo-v1";
const DKEY = "finanzas-bolsillo-datos";
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MES3 = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const fmtC = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2, minimumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));
const pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "—";
const short = v => { const a = Math.abs(v); return (v < 0 ? "−" : "") + (a >= 1e6 ? "$" + (a / 1e6).toFixed(1) + "M" : a >= 1e3 ? "$" + Math.round(a / 1e3) + "k" : "$" + Math.round(a)); };

const S = {
  movs: [], cfg: clone(DEFAULT_CFG), datos: null,
  tab: "inicio", ym: today().slice(0, 7), filter: "Todos", buscar: "",
  expScope: "pend", sending: false, leyendo: false, mas: "hoja", confirmarBorrado: false,
  sesion: { estado: "desconocido", email: "", vence: 0 },   // sesión de Cloudflare Access: desconocido · activa · vencida · sin-worker
  an: { vista: "resumen", anio: String(new Date().getFullYear()), mes: 0, cat: "Comida", metrica: "Egreso" }
};

/* ---------- Normalización (mismas reglas para hoja, histórico y captura) ---------- */
const CANON = Object.fromEntries(CATEGORIAS.concat(["Ingreso"]).map(c => [c.toLowerCase(), c]));
Object.assign(CANON, { "libro": "Libros", "ingresos": "Ingreso", "suscripcion": "Subscripcion", "suscripción": "Subscripcion", "inversión": "Inversion", "educación": "Educacion", "salud y bienestar": "Salud" });
const normTipo = (t, c) => String(t || "").trim().toLowerCase().startsWith("ingres") || String(c || "").trim().toLowerCase().startsWith("ingres") ? "Ingreso" : "Egreso";
function normCat(c, tipo) {
  if (tipo === "Ingreso") return "Ingreso";
  const k = CANON[String(c || "").trim().toLowerCase()];
  return !k || k === "Ingreso" ? (String(c || "").trim() || "Otros") : k;
}
const isIn = m => normTipo(m.tipo) === "Ingreso";

/* ---------- Almacenamiento ---------- */
function load() {
  try {
    const j = JSON.parse(localStorage.getItem(LKEY) || "null");
    if (j) {
      S.movs = Array.isArray(j.movs) ? j.movs : [];
      S.cfg = { ...clone(DEFAULT_CFG), ...(j.cfg || {}), v: (j.cfg && j.cfg.v) || 1 };
      S.cfg.sync = { ...DEFAULT_CFG.sync, ...(S.cfg.sync || {}) };
      if (S.cfg.sync.modo !== "directo") S.cfg.sync.modo = "worker";
    }
  } catch (e) { /* datos dañados: se empieza vacío */ }
  migrate();
  try { const d = JSON.parse(localStorage.getItem(DKEY) || "null"); if (d && Array.isArray(d.filas)) S.datos = d; } catch (e) {}
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
}
function migrate() {
  let changed = false;
  // v1 guardaba ingresos como Tipo "Ingresos"; Power BI y la hoja usan "Ingreso".
  S.movs.forEach(m => { if (m.tipo === "Ingresos") { m.tipo = "Ingreso"; changed = true; } if (m.tipo === "Ingreso" && m.cat !== "Ingreso") { m.cat = "Ingreso"; changed = true; } });
  if ((S.cfg.v || 1) < 2) {
    const cats = S.cfg.categorias.map(c => c === "Salud y bienestar" ? "Salud" : c);
    CATEGORIAS.forEach(c => { if (!cats.includes(c)) cats.splice(cats.indexOf("Otros") >= 0 ? cats.indexOf("Otros") : cats.length, 0, c); });
    S.cfg.categorias = [...new Set(cats)];
    const reglas = { ...DEFAULT_CFG.reglas };
    Object.entries(S.cfg.reglas || {}).forEach(([k, v]) => { const kk = k === "Salud y bienestar" ? "Salud" : k; reglas[kk] = [...new Set([...(reglas[kk] || []), ...v])]; });
    S.cfg.reglas = reglas;
    S.movs.forEach(m => { if (m.cat === "Salud y bienestar") m.cat = "Salud"; });
    S.cfg.v = 2; changed = true;
  }
  if ((S.cfg.v || 1) < 3) {
    // v3: la hoja se alcanza por el Worker protegido. Quien ya tenía URL y clave sigue en modo directo
    // hasta que cambie al Worker en Más › Google Sheet; nada se borra solo (migración reversible).
    S.cfg.sync.modo = S.cfg.sync.url ? "directo" : "worker";
    S.cfg.v = 3; changed = true;
  }
  if (changed) persist();
}
function persist() {
  try { localStorage.setItem(LKEY, JSON.stringify({ movs: S.movs, cfg: S.cfg })); return true; }
  catch (e) { toast("No se pudo guardar en el teléfono. Libera espacio y vuelve a intentar."); return false; }
}
function saveDatos() { try { localStorage.setItem(DKEY, JSON.stringify(S.datos)); } catch (e) { toast("Tu historial no cupo en el teléfono; se usará solo mientras la app esté abierta."); } }
function addMov(m) { S.movs.push({ id: uid(), ...m }); persist(); }
function updMov(id, patch) { const m = S.movs.find(x => x.id === id); if (m) Object.assign(m, patch); persist(); }
function delMov(id) { S.movs = S.movs.filter(x => x.id !== id); persist(); }

/* ---------- Todas las filas para dashboards ---------- */
let _cacheKey = "", _cache = [];
function filas() {
  const key = (S.datos ? S.datos.leido + S.datos.filas.length : "x") + "|" + S.movs.length + "|" + S.movs.reduce((a, m) => a + (m.exportado ? 1 : 0) + (+m.monto || 0), 0);
  if (key === _cacheKey) return _cache;
  const out = [];
  if (S.datos) {
    S.datos.filas.forEach((r, i) => {
      const tipo = normTipo(r[4], r[2]); // una fila con categoría "Ingreso" es ingreso aunque diga Egreso
      out.push({ ref: "h" + i, fecha: r[0], desc: r[1], cat: normCat(r[2], tipo), monto: +r[3] || 0, tipo, cuenta: r[5], hoja: true });
    });
  }
  const corte = S.datos ? S.datos.leido : null;
  S.movs.forEach(m => {
    if (corte && m.exportado && !(m.enviado && m.enviado > corte)) return; // ya viene en la hoja
    const tipo = normTipo(m.tipo);
    out.push({ ref: m.id, fecha: m.fecha, desc: m.desc, cat: normCat(m.cat, tipo), monto: +m.monto || 0, tipo, cuenta: m.cuenta, local: true, pendiente: !m.exportado });
  });
  out.forEach(r => { r.y = +r.fecha.slice(0, 4); r.m = +r.fecha.slice(5, 7); });
  _cacheKey = key; _cache = out;
  return out;
}
const sum = arr => arr.reduce((a, m) => a + (+m.monto || 0), 0);
const egr = arr => sum(arr.filter(r => r.tipo === "Egreso"));
const ing = arr => sum(arr.filter(r => r.tipo === "Ingreso"));
const inv = arr => sum(arr.filter(r => r.tipo === "Egreso" && r.cat === "Inversion"));
const years = () => [...new Set(filas().map(r => r.y))].filter(Boolean).sort();

/* ---------- Inicio: margen del mes (funciones puras, probadas en tests/run.js) ---------- */
// Margen = ingresos reales − gasto sin inversión − lo mayor entre la meta y lo ya invertido.
// La meta se aparta mientras no inviertes; cuando ya invertiste, no se descuenta dos veces.
// Es un margen presupuestal según los registros, no el saldo de las cuentas.
function margen(ingresos, consumo, inversion, pctMeta) {
  const meta = ingresos * (pctMeta || 0), reserva = Math.max(meta, inversion);
  return { meta, reserva, disponible: ingresos - consumo - reserva, faltaMeta: Math.max(0, meta - inversion), metaCumplida: meta > 0 && inversion >= meta };
}
// Promedio de ingresos de los 3 meses anteriores que sí tuvieron ingresos; null si ninguno.
function promIngresos3m(all, ym) {
  const vals = [];
  for (let k = 0; k < 3; k++) {
    ym = shiftMonth(ym, -1);
    const [y, m] = ym.split("-").map(Number), v = ing(all.filter(r => r.y === y && r.m === m));
    if (v > 0) vals.push(v);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function resumenMes(ym, hoy) {
  hoy = hoy || today();
  const [y, mo] = ym.split("-").map(Number);
  const all = filas(), ms = all.filter(r => r.y === y && r.m === mo);
  const ingresos = ing(ms), gastos = egr(ms), inversion = inv(ms), consumo = gastos - inversion;
  const pctMeta = S.cfg.inversion.pct || 0;
  const m = margen(ingresos, consumo, inversion, pctMeta);
  const esActual = hoy.slice(0, 7) === ym, diasMes = new Date(y, mo, 0).getDate();
  const diaHoy = esActual ? +hoy.slice(8, 10) : diasMes;
  const diasRestantes = esActual ? diasMes - diaHoy + 1 : 0;
  const diario = esActual && m.disponible > 0 ? m.disponible / diasRestantes : 0;
  // Referencia secundaria: si aún no has cobrado lo habitual, qué margen tendrías con tu ingreso típico. Siempre va marcada "Estimado".
  const prom = esActual ? promIngresos3m(all, ym) : null;
  const estimado = prom && ingresos < prom ? { ingresos: prom, ...margen(prom, consumo, inversion, pctMeta) } : null;
  const ultimos = all.map((r, i) => [r, i]).sort((a, b) => b[0].fecha.localeCompare(a[0].fecha) || b[1] - a[1]).slice(0, 5).map(a => a[0]);
  const nIng = ms.filter(r => r.tipo === "Ingreso").length;
  // De dónde viene cada movimiento del mes: filas de la hoja o capturas del cel (y cuántas faltan por enviar).
  const origen = { hoja: ms.filter(r => !r.local).length, local: ms.filter(r => r.local).length, pend: ms.filter(r => r.pendiente).length };
  return { ym, y, mo, ingresos, gastos, inversion, consumo, pctMeta, ...m, esActual, diasMes, diaHoy, diasRestantes, diario, estimado, ultimos, n: ms.length, nIng, origen };
}
// Cuenta compacta de Inicio: cada paso con su monto (ya con signo, suman el total) y la causa del resultado en una frase.
function explicaMargen(r) {
  const mes = MESES[r.mo - 1], pct = Math.round(r.pctMeta * 100) + "%", sinIng = r.ingresos <= 0, antes = r.ingresos - r.consumo;
  const apartado = r.reserva <= 0 ? "Apartado para inversión" : r.inversion >= r.meta ? "Inversión ya hecha" : `Meta de inversión (${pct})`;
  const pasos = [
    { k: "ingresos", label: "Ingresos recibidos", monto: r.ingresos },
    { k: "consumo", label: r.inversion > 0 ? "Gastos sin inversión" : "Gastos", monto: -r.consumo },
    { k: "reserva", label: apartado, monto: -r.reserva },
    { k: "disponible", label: "Disponible", monto: r.disponible, total: true }
  ];
  let causa;
  if (!r.n) causa = `Sin movimientos en ${mes}.`;
  else if (sinIng && r.consumo > 0) causa = `Sin ingresos registrados en ${mes}: todo lo gastado queda en negativo. Si ya cobraste, captúralo con +.`;
  else if (sinIng) causa = `Sin ingresos registrados en ${mes}; se descuenta lo que invertiste.`;
  else if (r.disponible < 0 && antes >= 0) causa = `Ibas ${fmt.format(antes)} a favor; los ${fmt.format(r.reserva)} apartados para inversión te dejan en negativo.`;
  else if (r.disponible < 0) causa = `Gastaste ${fmt.format(-antes)} más de lo que entró, sin contar la inversión. Es según tus registros, no tu saldo bancario.`;
  else causa = `Margen de ${mes} según tus registros, no tu saldo bancario.`;
  return { causa, pasos };
}

/* ---------- Captura rápida estilo WhatsApp ---------- */
function guessCat(text) {
  const t = " " + String(text).toLowerCase() + " ";
  for (const [cat, words] of Object.entries(S.cfg.reglas || {})) {
    if (!S.cfg.categorias.includes(cat)) continue;
    if (words.some(w => t.includes(" " + w + " ") || (w.length > 3 && t.includes(" " + w)))) return cat;
  }
  return null;
}
function parseQuick(s) {
  s = s.trim(); if (!s) return null;
  const m = s.match(/(\+)?\$?\s*(\d[\d,]*(?:\.\d+)?)/);
  if (!m) return { desc: s, cat: guessCat(s) };
  const monto = parseFloat(m[2].replace(/,/g, ""));
  const ingreso = !!m[1];
  const desc = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  return { monto, tipo: ingreso ? "Ingreso" : "Egreso", desc: desc || (ingreso ? "Ingreso" : ""), cat: ingreso ? "Ingreso" : guessCat(desc) };
}

/* ---------- Formato de la hoja ---------- */
const monthLabel = ym => { const [y, mo] = ym.split("-"); return MESES[+mo - 1] + " " + y; };
function shiftMonth(ym, d) { let [y, m] = ym.split("-").map(Number); m += d; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } return y + "-" + pad(m); }
const ddmmaa = f => { const [y, m, d] = f.split("-"); return d + "/" + m + "/" + y.slice(2); };
const dayName = f => new Date(f + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" });
/* A Mes · B Fecha dd/mm/aa · C Descripción (MAYÚSCULAS) · D Categoría · E Cantidad · F Tipo · G Salió de */
function toRow(m) {
  const tipo = normTipo(m.tipo);
  return { id: m.id, mes: +m.fecha.slice(5, 7), fecha: m.fecha, descripcion: (m.desc || "").toUpperCase(),
    categoria: normCat(m.cat, tipo), cantidad: +m.monto || 0, tipo, cuenta: m.cuenta || "" };
}
const toTSV = rows => rows.map(toRow).map(r => [r.mes, ddmmaa(r.fecha), r.descripcion, r.categoria, "$" + fmt2.format(r.cantidad), r.tipo, r.cuenta].join("\t")).join("\n");

/* ---------- Gráficas SVG ----------
   Sin librerías. Tocar o arrastrar sobre el SVG muestra periodo y valor (chartTip) y cada gráfica
   trae un "Ver datos" con la tabla exacta (verDatos). */
const YCOL = y => `var(--y${((y % 5) + 5) % 5})`;
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const attr = o => esc(JSON.stringify(o));
function verDatos(cols, rows) {
  const con = rows.filter(r => r.slice(1).some(v => v != null));
  if (!con.length) return "";
  return `<details class="verdatos"><summary>Ver datos</summary><div class="tbl"><table>
    <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${con.map(r => `<tr>${r.map((v, i) => `<td>${i ? (v == null ? "—" : fmtC.format(v)) : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}
function lineChart(series, labels, opts = {}) {
  const W = 340, H = 180, L = 40, R = 10, T = 10, B = 22;
  const all = series.flatMap(s => s.values.filter(v => v != null));
  const minV = Math.min(0, ...all), maxV = niceMax(Math.max(...all, 1));
  const lo = minV < 0 ? -niceMax(-minV) : 0;
  const x = i => L + (labels.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (labels.length - 1));
  const y = v => T + (H - T - B) * (1 - (v - lo) / (maxV - lo));
  const ticks = [lo, lo + (maxV - lo) / 2, maxV];
  const grid = ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 4}" y="${y(t) + 3}" class="ax" text-anchor="end">${short(t)}</text>`).join("");
  const xl = labels.map((l, i) => (labels.length <= 12 || i % 2 === 0) ? `<text x="${x(i)}" y="${H - 6}" class="ax" text-anchor="middle">${esc(l)}</text>` : "").join("");
  const zero = lo < 0 ? `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="zero"/>` : "";
  const lines = series.map(s => {
    const pts = s.values.map((v, i) => v == null ? null : [x(i), y(v)]);
    let d = "", pen = false;
    pts.forEach(p => { if (!p) { pen = false; return; } d += (pen ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); pen = true; });
    const lastI = s.values.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
    const end = lastI != null && lastI >= 0 ? `<circle cx="${x(lastI)}" cy="${y(s.values[lastI])}" r="3.2" fill="${s.color}"/>` : "";
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.bold ? 2.6 : 1.7}" stroke-linejoin="round" stroke-linecap="round" ${s.dim ? 'opacity=".45"' : ""}/>${end}`;
  }).join("");
  const names = opts.names || labels;
  const legend = series.length > 1 ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
  const data = { tipo: "line", W, H, L, R, T, B, lo, hi: maxV, names, series: series.map(s => ({ name: String(s.name), color: s.color, values: s.values })) };
  const tabla = verDatos([opts.col || "Periodo", ...series.map(s => String(s.name))], names.map((n, i) => [n, ...series.map(s => s.values[i])]));
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.label || "Gráfica")}" data-chart="${attr(data)}">${grid}${zero}${lines}${xl}<g class="tip" aria-hidden="true"></g></svg>${legend}${tabla}`;
}
function colChart(values, labels, opts = {}) {
  const W = 340, H = 160, L = 40, R = 6, B = 22;
  const bw = (W - L - R) / values.length;
  const conValor = bw >= 34;                 // con pocas barras cabe el valor encima; si no, sale al tocar
  const T = conValor ? 18 : 8;
  const maxV = niceMax(Math.max(...values.map(Math.abs), 1));
  const hasNeg = values.some(v => v < 0);
  const lo = hasNeg ? -maxV : 0;
  const y = v => T + (H - T - B) * (1 - (v - lo) / (maxV - lo));
  const ticks = hasNeg ? [lo, 0, maxV] : [0, maxV / 2, maxV];
  const grid = ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 && hasNeg ? "zero" : "grid"}"/><text x="${L - 4}" y="${y(t) + 3}" class="ax" text-anchor="end">${short(t)}</text>`).join("");
  const bars = values.map((v, i) => {
    const y0 = y(0), y1 = y(v), top = Math.min(y0, y1), h = Math.max(Math.abs(y1 - y0), v ? 1.5 : 0);
    const fill = opts.posneg ? (v >= 0 ? "var(--in)" : "var(--out)") : (opts.colors ? opts.colors[i] : "var(--ink)");
    const cx = (L + i * bw + bw / 2).toFixed(1);
    const val = conValor && v ? `<text x="${cx}" y="${(v >= 0 ? top - 4 : Math.min(top + h + 10, H - B - 2)).toFixed(1)}" class="val" text-anchor="middle">${short(v)}</text>` : "";
    return `<rect class="bar" data-i="${i}" x="${(L + i * bw + bw * .18).toFixed(1)}" y="${top.toFixed(1)}" width="${(bw * .64).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}"/>${val}`;
  }).join("");
  const xl = labels.map((l, i) => l ? `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${esc(l)}</text>` : "").join("");
  const names = opts.names || labels;
  const data = { tipo: "col", W, H, L, R, T, B, lo, hi: maxV, names, series: [{ name: opts.serie || "Valor", values }] };
  const tabla = verDatos([opts.col || "Periodo", opts.serie || "Valor"], names.map((n, i) => [n, values[i]]));
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.label || "Gráfica")}" data-chart="${attr(data)}">${grid}${bars}${xl}<g class="tip" aria-hidden="true"></g></svg>${tabla}`;
}
/* Barras horizontales. Tocar una fila muestra el valor exacto; con opts.drill lleva a Análisis › Categorías. */
function barsH(entries, total, opts = {}) {
  const max = Math.max(...entries.map(e => e[1]), 1);
  return `<div class="bars">${entries.map(([c, v], i) => `
    <button type="button" class="bar" ${opts.drill ? `data-cat-an="${esc(c)}" data-vista="categorias" aria-label="Ver ${esc(c)} en Categorías"` : 'data-bar aria-pressed="false"'}>
      <span class="n">${esc(c)}</span>
      <span class="a num">${fmt.format(v)}${total ? `<span class="pct">${pct(v, total)}</span>` : ""}</span>
      <span class="exact num">${fmtC.format(v)}${total ? `<span class="pct">${(v / total * 100).toFixed(1)}%</span>` : ""}</span>
      <span class="track"><span class="fill${i === 0 ? " top" : ""}" style="width:${(v / max * 100).toFixed(1)}%"></span></span>
    </button>`).join("")}</div>`;
}
/* Tooltip: pasa la posición del dedo al viewBox, busca el periodo más cercano y lo dibuja dentro del SVG sin salirse. */
let tipSvg = null;
function chartTip(svg, clientX) {
  const d = JSON.parse(svg.dataset.chart), g = svg.querySelector(".tip");
  if (!g || !d.names.length) return;
  const rect = svg.getBoundingClientRect(), span = d.W - d.L - d.R, n = d.names.length;
  const vx = (clientX - rect.left) / rect.width * d.W;
  let i = Math.max(0, Math.min(n - 1, d.tipo === "col" ? Math.floor((vx - d.L) / (span / n)) : n === 1 ? 0 : Math.round((vx - d.L) / (span / (n - 1)))));
  const hay = j => j >= 0 && j < n && d.series.some(s => s.values[j] != null);
  for (let k = 1; !hay(i) && k < n; k++) { if (hay(i - k)) i -= k; else if (hay(i + k)) i += k; }   // meses futuros sin dato: salta al más cercano con dato
  if (!hay(i)) { hideTip(svg); return; }
  const y = v => d.T + (d.H - d.T - d.B) * (1 - (v - d.lo) / (d.hi - d.lo));
  const cx = d.tipo === "col" ? d.L + (i + .5) * span / n : d.L + (n === 1 ? span / 2 : i * span / (n - 1));
  const con = d.series.filter(s => s.values[i] != null);
  const lineas = [String(d.names[i])].concat(con.map(s => (d.series.length > 1 ? s.name + "  " : "") + fmt.format(s.values[i])));
  const tw = Math.max(...lineas.map(l => l.length)) * 6.2 + 14, th = lineas.length * 13 + 8;
  const tx = Math.max(0, Math.min(d.W - tw, cx + 10 + tw > d.W ? cx - 10 - tw : cx + 10));
  const topY = con.length ? Math.min(...con.map(s => y(Math.max(0, s.values[i])))) : d.H;
  const ty = topY < d.T + th + 6 ? d.H - d.B - th - 4 : d.T;
  const puntos = d.tipo === "line" ? con.map(s => `<circle cx="${cx.toFixed(1)}" cy="${y(s.values[i]).toFixed(1)}" r="4" fill="${s.color}"/>`).join("") : "";
  g.innerHTML = con.length ? `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${d.T}" y2="${d.H - d.B}"/>${puntos}
    <rect x="${tx.toFixed(1)}" y="${ty}" width="${tw.toFixed(1)}" height="${th}" rx="6"/>
    ${lineas.map((l, k) => `<text x="${(tx + 7).toFixed(1)}" y="${ty + 14 + k * 13}"${k ? "" : ' class="t"'}>${esc(l)}</text>`).join("")}` : "";
  svg.querySelectorAll("rect.bar").forEach(b => b.classList.toggle("dim", con.length > 0 && +b.dataset.i !== i));
  tipSvg = svg;
}
function hideTip(svg) {
  if (!svg) return;
  const g = svg.querySelector(".tip"); if (g) g.innerHTML = "";
  svg.querySelectorAll("rect.bar.dim").forEach(b => b.classList.remove("dim"));
  if (tipSvg === svg) tipSvg = null;
}
function delta(actual, antes, invert) {
  if (!antes) return "";
  const d = (actual - antes) / antes, up = d > 0;
  const bueno = invert ? !up : up;
  return `<span class="delta ${bueno ? "good" : "bad"}">${up ? "▲" : "▼"} ${Math.abs(Math.round(d * 100))}%</span>`;
}

/* ---------- Vista: Inicio (solo el mes en curso, sin comparativos) ---------- */
function emptyState(ym) {
  return `<div class="empty"><strong>Sin movimientos en ${esc(monthLabel(ym))}</strong>
  Toca <b>+</b> y escribe como en tu chat de WhatsApp:<br><br><code>comida 145</code> · <code>uber 87</code> · <code>+11652 nómina</code></div>`;
}
const fechaCorta = f => new Date(f + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
function filaMini(r) {
  const i = r.tipo === "Ingreso";
  return `<button type="button" class="mrow" data-edit="${esc(r.ref)}"><span class="d"><strong>${esc(r.desc || "—")}</strong><small>${esc(i ? "Ingreso" : r.cat)} · ${esc(fechaCorta(r.fecha))}${r.pendiente ? '<span class="flag" title="Falta pasar a la hoja"></span>' : ""}</small></span><span class="num${i ? " pos" : ""}">${i ? "+" : "−"}${fmt.format(r.monto)}</span></button>`;
}
function viewInicio() {
  const ym = today().slice(0, 7);
  if (!filas().length) return emptyState(ym) + syncHint();
  const r = resumenMes(ym), mes = MESES[r.mo - 1], neg = r.disponible < 0, pctTxt = Math.round(r.pctMeta * 100) + "%";
  const dinero = v => (v < 0 ? "−" : "") + fmt.format(Math.abs(v));
  const ex = explicaMargen(r);
  let hint;
  if (!r.n) hint = `Sin movimientos en ${mes}. Toca <b>+</b> para registrar el primero.`;
  else if (neg) hint = ex.causa;
  else hint = ex.causa + (r.esActual && r.disponible > 0 ? ` ${r.diasRestantes === 1 ? "Último día" : `Quedan ${r.diasRestantes} días`}: <b class="num">${fmt.format(r.diario)}</b> al día.` : "");
  const est = r.estimado ? `<p class="est"><span class="tag-est">Estimado</span><span>Con tu ingreso habitual de ${fmt.format(r.estimado.ingresos)}, el margen sería <b class="num">${dinero(r.estimado.disponible)}</b>. Arriba solo cuenta lo ya cobrado.</span></p>` : "";
  const avance = r.meta > 0 ? Math.min(1, r.inversion / r.meta) : r.inversion > 0 ? 1 : 0;
  const metaTxt = r.meta <= 0 && r.inversion <= 0 ? `Meta: ${pctTxt} de tus ingresos. Se calcula al registrar ingresos.`
    : r.meta <= 0 ? `Invertiste ${fmt.format(r.inversion)} sin ingresos registrados este mes.`
    : r.metaCumplida ? `Meta del ${pctTxt} cumplida${r.inversion > r.meta ? `, con ${fmt.format(r.inversion - r.meta)} extra` : ""}.`
    : `Meta del ${pctTxt}: faltan ${fmt.format(r.faltaMeta)}.`;
  const pend = S.movs.filter(m => !m.exportado).length, conectado = !!(S.cfg.sync.url && S.cfg.sync.clave);
  // Cuenta compacta bajo el número y, en una línea, de dónde salen los datos (hoja o cel).
  const o = r.origen, fila = p => `<div class="paso${p.total ? " total" : ""}"><span>${p.label}</span><span class="num${p.total ? (neg ? " neg" : "") : p.monto > 0 ? " in" : ""}">${p.monto < 0 ? "−" : ""}${fmt.format(Math.abs(p.monto))}</span></div>`;
  const fuente = !r.n ? "" : `${r.n} movimiento${r.n === 1 ? "" : "s"}: ` + [S.datos ? `${o.hoja} de la hoja` : "", o.local ? `${o.local} de este cel${o.pend ? ` (${o.pend} sin enviar)` : ""}` : ""].filter(Boolean).join(" · ")
    + (!S.datos ? " · hoja sin leer" : datosViejos() ? " · hoja de hace más de 3 h" : "");
  return `<section class="hero">
    <div class="label">Disponible para gastar</div>
    <div class="big${neg ? " neg" : ""}">${dinero(r.disponible)}</div>
    <p class="hint">${hint}</p>${est}
    ${r.n ? `<div class="cuenta">${ex.pasos.map(fila).join("")}</div><p class="fuente">${fuente}</p>` : ""}
  </section>
  <section class="card goal">
    <div class="rowhead"><h3>Inversión</h3><span class="num">${fmt.format(r.inversion)}${r.meta > 0 ? ` <span class="muted">de ${fmt.format(r.meta)}</span>` : ""}</span></div>
    <span class="track"><span class="fill${r.metaCumplida ? " top" : ""}" style="width:${Math.round(avance * 100)}%"></span></span>
    <p class="note">${metaTxt}</p>
  </section>
  ${pend ? `<section class="card strip"><span><b>${pend}</b> movimiento${pend > 1 ? "s" : ""} sin pasar a la hoja</span>
    ${conectado ? `<button class="btn small acc" id="sendBtn" ${S.sending ? "disabled" : ""}>${S.sending ? "Enviando…" : "Enviar"}</button>` : `<button class="btn small ghost" data-go="mas">Ver</button>`}</section>` : ""}
  ${r.ultimos.length ? `<section class="card"><div class="rowhead"><h3>Últimos movimientos</h3><button type="button" class="link" data-go="movs">Ver todos</button></div><div class="mini">${r.ultimos.map(filaMini).join("")}</div></section>` : ""}
  ${syncHint()}`;
}
function syncHint() {
  if (S.datos) return "";
  return S.cfg.sync.url ? `<p class="note center">Toca <b>Actualizar desde la hoja</b> en “Más” para traer tu historial.</p>`
    : `<p class="note center">Conecta tu Google Sheet en “Más” para ver tu historial completo.</p>`;
}

/* ---------- Vista: Análisis (tus páginas de Power BI, con todo el historial) ---------- */
const VISTAS = [["resumen", "Resumen"], ["categorias", "Categorías"], ["anios", "Años"], ["inversion", "Inversión"], ["habitos", "Hábitos"]];
function viewAnalisis() {
  const all = filas();
  if (!all.length) return `<div class="empty"><strong>Aún no hay datos</strong>Registra movimientos o conecta tu hoja en “Más”.</div>`;
  const ys = years();
  if (S.an.anio !== "Todos" && !ys.includes(+S.an.anio)) S.an.anio = String(ys[ys.length - 1]);
  const head = `<div class="filters seg-tabs" role="tablist" aria-label="Página">${VISTAS.map(([k, n]) => `<button class="chip" data-vista="${k}" aria-pressed="${S.an.vista === k}">${n}</button>`).join("")}</div>`;
  const filtro = S.an.vista === "anios" ? "" : `<div class="slicers">
      <label class="field"><span class="label">Año</span><select id="fAnio">${["Todos", ...ys.map(String)].map(a => `<option ${a === S.an.anio ? "selected" : ""}>${a}</option>`).join("")}</select></label>
      ${S.an.vista === "resumen" || S.an.vista === "habitos" ? `<label class="field"><span class="label">Mes</span><select id="fMes"><option value="0">Todos</option>${MESES.map((m, i) => `<option value="${i + 1}" ${S.an.mes === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></label>` : ""}
    </div>`;
  const body = { resumen: anResumen, categorias: anCategorias, anios: anAnios, inversion: anInversion, habitos: anHabitos }[S.an.vista]();
  return head + filtro + body + (S.datos ? `<p class="note center">Datos de tu hoja al ${new Date(S.datos.leido).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>` : syncHint());
}
function sel() {
  return filas().filter(r => (S.an.anio === "Todos" || r.y === +S.an.anio) && (!S.an.mes || r.m === S.an.mes));
}
function kpis(rs, mesSel) {
  const i = ing(rs), e = egr(rs), b = i - e;
  // Con un mes elegido compara los egresos con el mismo mes del año anterior (antes vivía en la pestaña Mes).
  const prev = mesSel ? egr(filas().filter(r => r.y === mesSel.y - 1 && r.m === mesSel.m)) : 0;
  return `<div class="kpis">
    <div class="pill in"><span class="label">Ingresos</span><span class="v num">${fmt.format(i)}</span></div>
    <div class="pill out"><span class="label">Egresos</span><span class="v num">${fmt.format(e)}</span>${prev ? `<small class="sub">${delta(e, prev, true)} vs ${MES3[mesSel.m - 1].toLowerCase()} ${mesSel.y - 1}</small>` : ""}</div>
    <div class="pill"><span class="label">Balance</span><span class="v num ${b < 0 ? "neg" : ""}">${b < 0 ? "−" : ""}${fmt.format(Math.abs(b))}</span></div>
    <div class="pill"><span class="label">% de gasto</span><span class="v num">${pct(e, i)}</span></div>
  </div>`;
}
function periodos(rs) {
  // Con un año elegido: 12 meses. Con "Todos": por año. names = nombre completo para el tooltip y la tabla.
  if (S.an.anio === "Todos") { const ys = years(); return { labels: ys.map(String), names: ys.map(String), grupos: ys.map(y => rs.filter(r => r.y === y)) }; }
  const hoy = new Date(), fut = i => +S.an.anio === hoy.getFullYear() && i > hoy.getMonth();
  return { labels: MES3, names: MESES, grupos: MES3.map((_, i) => fut(i) ? null : rs.filter(r => r.m === i + 1)) };
}
function anResumen() {
  const rs = sel();
  const base = filas().filter(r => S.an.anio === "Todos" || r.y === +S.an.anio);
  const p = periodos(base);
  const ingS = p.grupos.map(g => g && ing(g)), egrS = p.grupos.map(g => g && egr(g)), bal = ingS.map((v, i) => v == null ? null : v - egrS[i]);
  const e = egr(rs);
  const byCat = {}; rs.filter(r => r.tipo === "Egreso").forEach(r => byCat[r.cat] = (byCat[r.cat] || 0) + r.monto);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const top = rs.filter(r => r.tipo === "Egreso").sort((a, b) => b.monto - a.monto).slice(0, 8);
  const mesSel = S.an.anio !== "Todos" && S.an.mes ? { y: +S.an.anio, m: S.an.mes } : null;
  return `${kpis(rs, mesSel)}${mesSel ? anMes(rs, mesSel) : ""}
  <section class="card"><h3>Ingresos vs egresos</h3>${lineChart([{ name: "Ingresos", values: ingS, color: "var(--in)", bold: true }, { name: "Egresos", values: egrS, color: "var(--out)", bold: true }], p.labels, { label: "Ingresos y egresos por periodo", names: p.names })}</section>
  <section class="card"><h3>Desviación</h3><p class="note">Lo que te sobró (verde) o faltó (rojo) en cada ${S.an.anio === "Todos" ? "año" : "mes"}.</p>${colChart(bal.map(v => v || 0), p.labels, { posneg: true, label: "Balance por periodo", names: p.names, serie: "Balance" })}</section>
  ${cats.length ? `<section class="card"><h3>Egresos por categoría</h3>${barsH(cats, e, { drill: true })}<p class="note" style="margin-top:10px">Toca una categoría para verla a detalle.</p></section>` : ""}
  <section class="card"><h3>Por ${S.an.anio === "Todos" ? "año" : "mes"}</h3><div class="tbl"><table>
    <thead><tr><th></th><th>Ingresos</th><th>Egresos</th><th>Balance</th><th>% gasto</th></tr></thead>
    <tbody>${p.labels.map((l, i) => ingS[i] || egrS[i] ? `<tr><td>${l}</td><td>${short(ingS[i])}</td><td>${short(egrS[i])}</td><td class="${bal[i] < 0 ? "neg" : "pos"}">${short(bal[i])}</td><td>${pct(egrS[i], ingS[i])}</td></tr>` : "").join("")}</tbody></table></div></section>
  ${top.length ? `<section class="card"><h3>Gastos más grandes</h3>${listaSimple(top)}</section>` : ""}`;
}
/* Detalle del mes elegido: proyección al cierre y gasto por día (antes estaban en la pestaña Mes). */
function anMes(rs, { y, m }) {
  const outs = rs.filter(r => r.tipo === "Egreso");
  if (!outs.length) return "";
  const dias = new Date(y, m, 0).getDate();
  const daily = Array(dias).fill(0); outs.forEach(r => { const d = +r.fecha.slice(8, 10); if (d >= 1 && d <= dias) daily[d - 1] += r.monto; });
  const dMax = Math.max(...daily);
  const hoy = new Date(), esActual = hoy.getFullYear() === y && hoy.getMonth() + 1 === m;
  const consumo = egr(outs) - inv(outs), ritmo = esActual ? consumo / hoy.getDate() : 0;
  return `${esActual ? `<section class="card"><span class="label">Proyección al cierre</span><p class="kpi num">${fmt.format(ritmo * dias)}</p><p class="note">Gasto sin inversión si sigues al ritmo de ${fmt.format(ritmo)} por día.</p></section>` : ""}
  <section class="card"><h3>Gasto por día</h3>${colChart(daily, daily.map((_, i) => i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : ""), { label: "Gasto por día del mes", names: daily.map((_, i) => (i + 1) + " de " + MESES[m - 1]), col: "Día", serie: "Gasto" })}
    <p class="note">Día más caro: ${daily.indexOf(dMax) + 1} de ${MESES[m - 1]}, ${fmt.format(dMax)}.</p></section>`;
}
function listaSimple(rs) {
  return `<div class="mini">${rs.map(r => `<div class="mrow"><span class="d"><strong>${esc(r.desc || "—")}</strong><small>${esc(r.cat)} · ${esc(ddmmaa(r.fecha))}</small></span><span class="num">${fmt.format(r.monto)}</span></div>`).join("")}</div>`;
}
function porAnioMes(rs, filtro) {
  const ys = years();
  return ys.map(y => ({ y, values: MES3.map((_, i) => { if (y === new Date().getFullYear() && i > new Date().getMonth()) return null; return sum(rs.filter(r => r.y === y && r.m === i + 1 && filtro(r))); }) }));
}
function anCategorias() {
  const cats = [...new Set(filas().filter(r => r.tipo === "Egreso").map(r => r.cat))];
  const tot = c => egr(filas().filter(r => r.cat === c));
  cats.sort((a, b) => tot(b) - tot(a));
  if (!cats.includes(S.an.cat)) S.an.cat = cats[0];
  const c = S.an.cat;
  const rs = filas().filter(r => r.tipo === "Egreso" && r.cat === c);
  const series = porAnioMes(rs, () => true).filter(s => S.an.anio === "Todos" || s.y === +S.an.anio || s.y === +S.an.anio - 1)
    .map(s => ({ name: String(s.y), values: s.values, color: YCOL(s.y), bold: s.y === Math.max(...years()), dim: S.an.anio !== "Todos" && s.y !== +S.an.anio }));
  const enAnio = rs.filter(r => S.an.anio === "Todos" || r.y === +S.an.anio);
  const porDesc = {}; enAnio.forEach(r => { const k = (r.desc || "—").toUpperCase(); (porDesc[k] ||= [0, 0]); porDesc[k][0] += r.monto; porDesc[k][1]++; });
  const topD = Object.entries(porDesc).sort((a, b) => b[1][0] - a[1][0]).slice(0, 8);
  const anual = years().map(y => [y, egr(rs.filter(r => r.y === y))]);
  return `<div class="filters" role="group" aria-label="Categoría">${cats.map(k => `<button class="chip" data-cat-an="${esc(k)}" aria-pressed="${k === c}">${esc(k)}</button>`).join("")}</div>
  <section class="card"><h3>${esc(c)} por mes</h3><p class="note">${S.an.anio === "Todos" ? "Cada línea es un año." : `${S.an.anio} contra ${+S.an.anio - 1}.`}</p>${lineChart(series, MES3, { label: c + " por mes y año", names: MESES })}</section>
  <section class="card"><h3>${esc(c)} por año</h3>${colChart(anual.map(a => a[1]), anual.map(a => String(a[0])), { colors: anual.map(a => YCOL(a[0])), label: c + " por año", col: "Año", serie: c })}
    <p class="note">Promedio mensual ${S.an.anio === "Todos" ? "histórico" : S.an.anio}: <b class="num" style="color:var(--ink)">${fmt.format(promMensual(enAnio))}</b></p></section>
  ${topD.length ? `<section class="card"><h3>En qué exactamente</h3><div class="mini">${topD.map(([d, [m, n]]) => `<div class="mrow"><span class="d"><strong>${esc(d)}</strong><small>${n} ${n > 1 ? "veces" : "vez"}</small></span><span class="num">${fmt.format(m)}</span></div>`).join("")}</div></section>` : ""}`;
}
function promMensual(rs) {
  const meses = new Set(rs.map(r => r.y + "-" + r.m)).size;
  return meses ? egr(rs) / meses : 0;
}
function anAnios() {
  const all = filas();
  const met = S.an.metrica;
  const f = { Egreso: r => r.tipo === "Egreso", Ingreso: r => r.tipo === "Ingreso" };
  let series;
  if (met === "Balance") {
    const i = porAnioMes(all, f.Ingreso), e = porAnioMes(all, f.Egreso);
    series = i.map((s, k) => ({ y: s.y, values: s.values.map((v, j) => v == null ? null : v - e[k].values[j]) }));
  } else series = porAnioMes(all, f[met]);
  const ys = years(), maxY = Math.max(...ys);
  const tabla = ys.map(y => { const r = all.filter(x => x.y === y); return { y, i: ing(r), e: egr(r), n: new Set(r.map(x => x.m)).size }; });
  return `<div class="filters" role="group" aria-label="Indicador">${["Egreso", "Ingreso", "Balance"].map(m => `<button class="chip" data-metrica="${m}" aria-pressed="${m === met}">${m === "Egreso" ? "Egresos" : m === "Ingreso" ? "Ingresos" : "Balance"}</button>`).join("")}</div>
  <section class="card"><h3>${met === "Egreso" ? "Egresos" : met === "Ingreso" ? "Ingresos" : "Balance"} por mes, cada año</h3>
    ${lineChart(series.map(s => ({ name: String(s.y), values: s.values, color: YCOL(s.y), bold: s.y === maxY })), MES3, { label: "Comparativa por año", names: MESES })}</section>
  <section class="card"><h3>Año contra año</h3><div class="tbl"><table>
    <thead><tr><th>Año</th><th>Ingresos</th><th>Egresos</th><th>Balance</th><th>% gasto</th><th>Gasto/mes</th></tr></thead>
    <tbody>${tabla.map((t, k) => `<tr><td>${t.y}${t.n < 12 ? `<small class="muted"> ${t.n}m</small>` : ""}</td><td>${short(t.i)}</td><td>${short(t.e)} ${k ? delta(t.e / t.n, tabla[k - 1].e / tabla[k - 1].n, true) : ""}</td><td class="${t.i - t.e < 0 ? "neg" : "pos"}">${short(t.i - t.e)}</td><td>${pct(t.e, t.i)}</td><td>${short(t.n ? t.e / t.n : 0)}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">La flecha compara el gasto promedio por mes contra el año anterior.</p></section>`;
}
function anInversion() {
  const all = filas(), rs = all.filter(r => r.tipo === "Egreso" && r.cat === "Inversion");
  const ys = years(), maxY = Math.max(...ys);
  const anual = ys.map(y => ({ y, inv: sum(rs.filter(r => r.y === y)), ing: ing(all.filter(r => r.y === y)) }));
  const enSel = rs.filter(r => S.an.anio === "Todos" || r.y === +S.an.anio);
  const ingSel = ing(all.filter(r => S.an.anio === "Todos" || r.y === +S.an.anio));
  const meta = S.cfg.inversion.pct, metaSel = ingSel * meta;
  const porDesc = {}; enSel.forEach(r => { const k = (r.desc || "—").toUpperCase(); porDesc[k] = (porDesc[k] || 0) + r.monto; });
  return `<div class="kpis">
    <div class="pill"><span class="label">Invertido</span><span class="v num">${fmt.format(sum(enSel))}</span></div>
    <div class="pill"><span class="label">% del ingreso</span><span class="v num">${pct(sum(enSel), ingSel)}</span><small class="sub">meta ${Math.round(meta * 100)}%</small></div>
  </div>
  ${metaSel > 0 ? `<section class="card"><h3>Reparto de la meta</h3><p class="note">${Math.round(meta * 100)}% del ingreso del periodo: <b class="num" style="color:var(--ink)">${fmt.format(metaSel)}</b></p>
    <div class="invest">${S.cfg.inversion.reparto.map(([n, p]) => `<div><b>${esc(n)}</b><span class="num">${fmt.format(metaSel * p)}</span></div>`).join("")}</div></section>` : ""}
  <section class="card"><h3>Inversión por año</h3>${colChart(anual.map(a => a.inv), anual.map(a => String(a.y)), { colors: anual.map(a => YCOL(a.y)), label: "Inversión por año", col: "Año", serie: "Invertido" })}
    <div class="tbl"><table><thead><tr><th>Año</th><th>Invertido</th><th>% ingreso</th><th>vs meta</th></tr></thead><tbody>
    ${anual.map(a => { const p = a.ing ? a.inv / a.ing : 0; return `<tr><td>${a.y}</td><td>${short(a.inv)}</td><td>${pct(a.inv, a.ing)}</td><td class="${p >= meta ? "pos" : "neg"}">${p >= meta ? "Cumplida" : short(a.ing * meta - a.inv) + " abajo"}</td></tr>`; }).join("")}</tbody></table></div></section>
  <section class="card"><h3>Por mes, cada año</h3>${lineChart(porAnioMes(rs, () => true).map(s => ({ name: String(s.y), values: s.values, color: YCOL(s.y), bold: s.y === maxY })), MES3, { label: "Inversión por mes", names: MESES })}</section>
  ${Object.keys(porDesc).length ? `<section class="card"><h3>A dónde fue</h3>${barsH(Object.entries(porDesc).sort((a, b) => b[1] - a[1]).slice(0, 8), sum(enSel))}</section>` : ""}
  ${enSel.length ? `<section class="card"><h3>Movimientos de inversión</h3>${listaSimple(enSel.slice().sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 15))}</section>` : ""}`;
}
function anHabitos() {
  const rs = sel(), all = filas();
  const outs = rs.filter(r => r.tipo === "Egreso");
  const i = ing(rs), e = egr(rs), iv = inv(rs), consumo = e - iv;
  const dias = new Set(rs.map(r => r.fecha)).size ? diasPeriodo() : 0;
  // Gastos que más se repiten
  const rep = {}; outs.filter(r => r.cat !== "Inversion" && r.cat !== "Renta").forEach(r => { const k = (r.desc || "—").toUpperCase(); (rep[k] ||= [0, 0]); rep[k][0]++; rep[k][1] += r.monto; });
  const reps = Object.entries(rep).filter(([, v]) => v[0] >= 3).sort((a, b) => b[1][0] - a[1][0]).slice(0, 8);
  // Suscripciones: últimos 3 meses con datos
  const ultimos = [...new Set(all.map(r => r.y * 100 + r.m))].sort((a, b) => b - a).slice(0, 3);
  const subs = {}; all.filter(r => r.cat === "Subscripcion" && ultimos.includes(r.y * 100 + r.m)).forEach(r => { const k = (r.desc || "—").toUpperCase(); subs[k] = (subs[k] || 0) + r.monto; });
  const subsL = Object.entries(subs).map(([k, v]) => [k, v / Math.max(ultimos.length, 1)]).sort((a, b) => b[1] - a[1]);
  const subsT = subsL.reduce((a, b) => a + b[1], 0);
  // Día de la semana
  const dow = Array(7).fill(0); outs.filter(r => r.cat !== "Inversion" && r.cat !== "Renta").forEach(r => { dow[(new Date(r.fecha + "T12:00:00").getDay() + 6) % 7] += r.monto; });
  return `<div class="kpis">
    <div class="pill"><span class="label">Tasa de ahorro</span><span class="v num">${pct(i - consumo, i)}</span><small class="sub">ingreso que no se gastó</small></div>
    <div class="pill"><span class="label">Gasto diario</span><span class="v num">${fmt.format(dias ? consumo / dias : 0)}</span><small class="sub">sin inversión</small></div>
  </div>
  <section class="card"><h3>Suscripciones</h3><p class="note">Promedio mensual de los últimos ${ultimos.length} meses: <b class="num" style="color:var(--ink)">${fmt.format(subsT)}</b> · al año ${fmt.format(subsT * 12)}</p>${subsL.length ? barsH(subsL.slice(0, 8)) : ""}</section>
  ${reps.length ? `<section class="card"><h3>Lo que más se repite</h3><div class="mini">${reps.map(([d, [n, m]]) => `<div class="mrow"><span class="d"><strong>${esc(d)}</strong><small>${n} veces · ${fmt.format(m / n)} c/u</small></span><span class="num">${fmt.format(m)}</span></div>`).join("")}</div></section>` : ""}
  <section class="card"><h3>Qué día gastas más</h3>${colChart(dow, ["L", "M", "M", "J", "V", "S", "D"], { label: "Gasto por día de la semana", names: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"], col: "Día", serie: "Gasto" })}<p class="note">Sin renta ni inversión.</p></section>`;
}
function diasPeriodo() {
  const hoy = new Date();
  if (S.an.anio === "Todos") { const f = filas().map(r => r.fecha).sort(); return Math.max(1, Math.round((new Date(today()) - new Date(f[0])) / 864e5) + 1); }
  const y = +S.an.anio;
  if (S.an.mes) { const dm = new Date(y, S.an.mes, 0).getDate(); return y === hoy.getFullYear() && S.an.mes === hoy.getMonth() + 1 ? hoy.getDate() : dm; }
  if (y === hoy.getFullYear()) return Math.round((hoy - new Date(y, 0, 1)) / 864e5) + 1;
  return (y % 4 === 0 ? 366 : 365);
}

/* ---------- Vista: Movimientos ---------- */
function viewMovs() {
  const [y, mo] = S.ym.split("-").map(Number);
  const q = S.buscar.trim().toLowerCase();
  const base = q ? filas().filter(r => (r.desc || "").toLowerCase().includes(q)) : filas().filter(r => r.y === y && r.m === mo);
  const buscador = `<label class="search"><input id="buscar" type="search" placeholder="Buscar en todo tu historial…" value="${esc(S.buscar)}" autocomplete="off"></label>`;
  if (!base.length) return buscador + (q ? `<div class="empty"><strong>Nada con “${esc(S.buscar)}”</strong></div>` : emptyState(S.ym));
  const cats = ["Todos", "Ingresos", ...new Set(base.filter(r => r.tipo === "Egreso").map(r => r.cat))];
  if (!cats.includes(S.filter)) S.filter = "Todos";
  const list = base.filter(r => S.filter === "Todos" || (S.filter === "Ingresos" ? r.tipo === "Ingreso" : (r.tipo === "Egreso" && r.cat === S.filter)))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.local ? 1 : 0) - (a.local ? 1 : 0)).slice(0, 300);
  const groups = {}; list.forEach(r => (groups[r.fecha] ||= []).push(r));
  const tot = q ? `<p class="note">${list.length} resultado${list.length > 1 ? "s" : ""} · ${fmt.format(egr(list))} en egresos</p>` : "";
  return `${buscador}<div class="filters" role="group" aria-label="Filtrar">${cats.map(c => `<button class="chip" data-filter="${esc(c)}" aria-pressed="${c === S.filter}">${esc(c)}</button>`).join("")}</div>${tot}
  ${Object.entries(groups).map(([f, arr]) => {
    const o = egr(arr);
    return `<div class="day"><div class="dayhead"><b>${esc(q ? ddmmaa(f) + " · " + dayName(f) : dayName(f))}</b><span class="num">${o ? "−" + fmtC.format(o) : ""}</span></div>
    ${arr.map(r => { const i = r.tipo === "Ingreso"; return `<button class="row" data-edit="${esc(r.ref)}">
      <span class="dot ${i ? "in" : ""}">${esc(i ? "+" : (r.cat || "O")[0])}</span>
      <span class="d"><strong>${esc(r.desc || "—")}</strong><small>${esc(i ? "Ingreso" : r.cat)} · ${esc(r.cuenta || "")}${r.pendiente ? '<span class="flag" title="Falta pasar a la hoja"></span>' : ""}</small></span>
      <span class="m num ${i ? "in" : ""}">${i ? "+" : "−"}${fmtC.format(r.monto)}</span></button>`; }).join("")}</div>`;
  }).join("")}`;
}

/* ---------- Vista: Más (Google Sheet, ajustes y respaldo) ---------- */
function exportRows() {
  const base = S.expScope === "pend" ? S.movs.filter(m => !m.exportado) : S.movs.filter(m => m.fecha.slice(0, 7) === S.ym);
  return base.slice().sort((a, b) => (a.fecha + (a.creado || "")).localeCompare(b.fecha + (b.creado || "")));
}
const MAS = [["hoja", "Google Sheet"], ["ajustes", "Ajustes"], ["respaldo", "Respaldo"]];
const modoWorker = () => S.cfg.sync.modo !== "directo";
/* "Conectada" = hay forma de llegar a la hoja: por el Worker (mientras no sepamos que falta configurarlo) o con URL y clave. */
const conectada = () => modoWorker() ? S.sesion.estado !== "sin-worker" : !!(S.cfg.sync.url && S.cfg.sync.clave);
const fechaHora = iso => new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/* Estado de la sincronización: siempre visible arriba de Más */
function estadoSync() {
  const pend = S.movs.filter(m => !m.exportado).length;
  const via = !modoWorker() ? '<span class="ok">Conectada.</span>' : S.sesion.estado === "activa" ? '<span class="ok">Conectada por el Worker protegido.</span>' : "Por el Worker protegido.";
  const estado = !conectada() ? (modoWorker() ? "El Worker protegido aún no está configurado: puedes copiar y pegar las filas." : "Sin conexión con tu Google Sheet: puedes copiar y pegar las filas.")
    : !S.datos ? `${via} Aún no se ha traído tu historial.`
    : `${via} ${S.datos.filas.length.toLocaleString("es-MX")} movimientos de tu hoja, al ${fechaHora(S.datos.leido)}.${S.datos.malas ? ` ${S.datos.malas} filas sin fecha o cantidad válida se omitieron.` : ""}`;
  return `<section class="card sync">
    <p class="note">${estado}</p>${sesionTxt()}
    <p class="note">${pend ? `<span class="warn">${pend} movimiento${pend > 1 ? "s" : ""} sin pasar a la hoja.</span>` : "Todo lo capturado ya está en la hoja."}</p>
    ${conectada() ? `<button class="btn ghost small" id="readBtn" style="margin-top:10px" ${S.leyendo ? "disabled" : ""}>${S.leyendo ? "Actualizando…" : "Actualizar desde la hoja"}</button>` : ""}
  </section>`;
}
function viewMas() {
  const chips = `<div class="filters seg-tabs" role="tablist" aria-label="Sección">${MAS.map(([k, n]) => `<button class="chip" data-mas="${k}" aria-pressed="${S.mas === k}">${n}</button>`).join("")}</div>`;
  return chips + estadoSync() + { hoja: masHoja, ajustes: masAjustes, respaldo: masRespaldo }[S.mas]();
}
function masHoja() {
  const rows = exportRows(), pend = rows.filter(m => !m.exportado).length, conectado = conectada();
  return `<section class="card exp">
    <h3>Pasar a Finanzas 2026</h3>
    <p class="note">Mismas columnas que tu hoja: Mes · Fecha · Descripción · Categoría · Cantidad · Tipo · Salió de.</p>
    <div class="filters" style="margin:12px 0 10px" role="group" aria-label="Qué pasar">
      <button class="chip" data-scope="pend" aria-pressed="${S.expScope === "pend"}">Pendientes</button>
      <button class="chip" data-scope="mes" aria-pressed="${S.expScope === "mes"}">Capturados en ${esc(monthLabel(S.ym))}</button>
    </div>
    ${rows.length ? `
      ${conectado ? `<button class="btn acc" id="sendBtn" style="width:100%;margin-bottom:10px" ${pend && !S.sending ? "" : "disabled"}>${S.sending ? "Enviando…" : pend ? `Enviar ${pend} a la hoja` : "Nada pendiente de enviar"}</button>` : ""}
      <textarea id="tsv" readonly aria-label="Filas para pegar">${esc(toTSV(rows))}</textarea>
      <div class="btns" style="margin-top:10px">
        <button class="btn ${conectado ? "ghost" : "acc"}" id="copyBtn">Copiar ${rows.length} fila${rows.length > 1 ? "s" : ""}</button>
        <button class="btn ghost" id="markBtn" ${pend ? "" : "disabled"}>Marcar ${pend || ""} como pasados</button>
      </div>` :
      `<p class="note" style="padding:14px 0">${S.expScope === "pend" ? "Todo está pasado a tu hoja." : "No capturaste nada desde el cel este mes."}</p>`}
  </section>
  ${cardConexion()}`;
}
/* Estado de la sesión de Cloudflare Access (solo en modo Worker). */
function sesionTxt() {
  if (!modoWorker()) return "";
  const s = S.sesion;
  if (s.estado === "vencida") return `<p class="note"><span class="warn">Tu sesión de Cloudflare venció.</span> <button class="btn small" type="button" id="loginBtn">Entrar</button></p>`;
  if (s.estado === "activa" && s.email) return `<p class="note">Sesión de ${esc(s.email)}${s.vence ? ", vence el " + fechaHora(s.vence * 1000) : ""}.</p>`;
  return "";
}
/* Conexión con la hoja. Modo Worker: nada que capturar, solo probar y entrar de nuevo a Cloudflare.
   Modo directo (transición): el formulario de siempre más el paso al Worker; las credenciales no se borran solas. */
function cardConexion() {
  const s = S.cfg.sync, conCred = !!(s.url && s.clave);
  const entrar = S.sesion.estado === "vencida" ? "" : `<button class="btn ghost small" type="button" id="loginBtn">Entrar a Cloudflare</button>`;
  if (modoWorker()) {
    return `<section class="card"><h3>Conexión con Google Sheet</h3>
    <p class="note">Los envíos pasan por el Worker protegido de Cloudflare. La URL y la clave de tu Apps Script viven como secretos del servidor, no en este iPhone.</p>
    <div class="btns"><button class="btn ghost small" type="button" id="testBtn">Probar conexión</button>${entrar}</div>
    ${conCred ? `<p class="note" style="margin-top:14px">Este iPhone todavía guarda la URL y la clave del modo directo. Cuando confirmes que el Worker funciona, bórralas; mientras, puedes volver al modo directo.</p>
    <div class="btns"><button class="btn ghost small" type="button" id="directoBtn">Volver al modo directo</button><button class="btn ghost small" type="button" id="borrarCredBtn">${S.confirmarBorrado ? "¿Seguro? Toca otra vez" : "Borrar credenciales del teléfono"}</button></div>` : ""}
  </section>`;
  }
  return `<section class="card"><h3>Conexión con Google Sheet</h3>
    <form class="stack" id="syncForm">
      <p class="note">${conCred ? "“Enviar” agrega las filas directo a Finanzas 2026. Cambia la URL o la clave solo si vuelves a publicar el Apps Script." : "Pega aquí la URL y la clave de tu Apps Script (las instrucciones están en el README del repo). Sin conexión puedes seguir copiando y pegando."}</p>
      <div class="field"><span class="label">URL del Apps Script</span><input id="syncUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(s.url)}"></div>
      <div class="field"><span class="label">Clave</span><input id="syncClave" type="password" autocomplete="off" autocapitalize="off" value="${esc(s.clave)}"></div>
      <div class="btns"><button class="btn ghost small" type="button" id="testBtn">Probar conexión</button><button class="btn small" type="submit">Guardar</button></div>
    </form>
    <p class="note" style="margin-top:14px"><b>Modo protegido (nuevo).</b> Cuando el Worker y Cloudflare Access estén listos, pruébalo y cámbiate aquí. Tus credenciales se quedan en el cel hasta que tú las borres.</p>
    <div class="btns"><button class="btn ghost small" type="button" id="probarWorkerBtn">Probar el Worker</button><button class="btn small" type="button" id="usarWorkerBtn">Usar el Worker protegido</button>${entrar}</div>
  </section>`;
}
function masAjustes() {
  return `<section class="card"><h3>Meta de inversión</h3>
    <form class="stack" id="invForm">
      <div class="two"><div class="field"><span class="label">% del ingreso</span><input id="invPct" inputmode="decimal" value="${Math.round(S.cfg.inversion.pct * 100)}"></div>
      <div class="field"><span class="label">Reparto</span><input id="invRep" autocomplete="off" value="${esc(S.cfg.inversion.reparto.map(([n, p]) => n + " " + Math.round(p * 100)).join(", "))}"></div></div>
      <p class="note">Inicio aparta este porcentaje de tus ingresos al calcular el disponible. Ejemplo de reparto: <code>NU 60, GBM 20, Bitcoin 20</code></p>
      <button class="btn small" type="submit">Guardar meta</button>
    </form>
  </section>
  ${cfgCard("Cuentas", "cuentas")}
  ${cfgCard("Categorías de gasto", "categorias")}`;
}
function masRespaldo() {
  return `<section class="card"><h3>Respaldo</h3>
    <p class="note">Lo que capturas vive en este iPhone hasta que lo envías a la hoja. Descarga un respaldo de vez en cuando.</p>
    <div class="btns" style="margin-top:10px">
      <button class="btn ghost small" id="backupBtn">Descargar respaldo</button>
      <label class="btn ghost small" for="restoreFile" style="text-align:center">Restaurar respaldo</label>
      <input type="file" id="restoreFile" accept="application/json,.json">
    </div>
    <p class="note" style="margin-top:8px">${S.movs.length} movimientos capturados en el cel.</p>
  </section>`;
}
function cfgCard(title, key) {
  return `<section class="card"><h3>${title}</h3>
  <div class="tags">${S.cfg[key].map((c, i) => `<span class="tag">${esc(c)}<button aria-label="Quitar ${esc(c)}" data-rm="${key}:${i}">×</button></span>`).join("")}</div>
  <form class="addrow" data-add="${key}"><input id="add-${key}" placeholder="Agregar…" autocomplete="off"><button class="btn ghost small">Agregar</button></form></section>`;
}

/* ---------- Render ---------- */
const TITLES = { movs: "Movimientos", analisis: "Análisis", mas: "Más" };
function render() {
  tipSvg = null;
  const conMes = S.tab === "movs" && !S.buscar.trim();
  $(".monthnav").hidden = !conMes;
  $("#monthLbl").textContent = monthLabel(S.ym);
  $("#tabTitle").textContent = S.tab === "inicio" ? monthLabel(today().slice(0, 7)) : TITLES[S.tab];
  document.querySelectorAll("nav.tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  const pend = S.movs.filter(m => !m.exportado).length;
  const b = $("#pendBadge"); b.hidden = !pend; b.textContent = pend;
  const focusSearch = document.activeElement && document.activeElement.id === "buscar";
  $("#main").innerHTML = S.tab === "inicio" ? viewInicio() : S.tab === "analisis" ? viewAnalisis() : S.tab === "movs" ? viewMovs() : viewMas();
  if (focusSearch) { const i = $("#buscar"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  $("#status").textContent = navigator.onLine === false ? "Sin internet · todo se guarda en tu iPhone" : "";
}

/* ---------- Hoja de captura / edición ---------- */
let draft = null;
function openSheet(existing) {
  const last = S.movs.slice().sort((a, b) => (b.creado || "").localeCompare(a.creado || ""))[0];
  draft = existing ? { ...existing } : { tipo: "Egreso", monto: "", desc: "", cat: "", cuenta: (last && last.cuenta) || S.cfg.cuentas[0], fecha: today() };
  draft._confirmDel = false;
  drawSheet(!existing);
}
function drawSheet(focusQuick) {
  const d = draft, isI = d.tipo === "Ingreso";
  $("#sheetHost").innerHTML = `<div class="scrim" id="scrim"><form class="sheet" id="mform" role="dialog" aria-label="${d.id ? "Editar" : "Nuevo"} movimiento">
    <div class="grab"></div>
    <h2>${d.id ? "Editar movimiento" : "Nuevo movimiento"}</h2>
    ${d.id ? "" : `<div class="quick"><input id="quick" placeholder="comida 145   ·   +11652 nómina" autocomplete="off" enterkeyhint="done">
      <small>Escribe como en WhatsApp y se llena solo. Con “+” es ingreso.</small></div>`}
    <div class="seg" role="group" aria-label="Tipo">
      <button type="button" class="o" data-tipo="Egreso" aria-pressed="${!isI}">Egreso</button>
      <button type="button" class="i" data-tipo="Ingreso" aria-pressed="${isI}">Ingreso</button>
    </div>
    <label class="amount"><span>$</span><input id="monto" inputmode="decimal" placeholder="0" value="${esc(d.monto)}" aria-label="Cantidad"></label>
    <div class="field"><span class="label">Descripción</span><input id="desc" value="${esc(d.desc)}" placeholder="Ej. desayuno" autocomplete="off"></div>
    ${isI ? "" : `<div class="field"><span class="label">Categoría</span><div class="catgrid">${S.cfg.categorias.map(c => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${c === d.cat}">${esc(c)}</button>`).join("")}</div></div>`}
    <div class="two">
      <div class="field"><span class="label">Salió de / entró a</span><select id="cuenta">${S.cfg.cuentas.map(c => `<option ${c === d.cuenta ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="field"><span class="label">Fecha</span><input type="date" id="fecha" value="${esc(d.fecha)}"></div>
    </div>
    <div class="btns">
      ${d.id ? `<button type="button" class="btn danger" id="delBtn">Borrar</button>` : `<button type="button" class="btn ghost" id="cancelBtn">Cancelar</button>`}
      <button type="submit" class="btn acc">${d.id ? "Guardar cambios" : "Registrar"}</button>
    </div>
  </form></div>`;
  const f = $("#mform");
  f.addEventListener("input", e => {
    const id = e.target.id;
    if (id === "monto") d.monto = e.target.value;
    if (id === "desc") { d.desc = e.target.value; if (!d._catTouched && d.tipo === "Egreso") { const g = guessCat(d.desc); if (g && g !== d.cat) { d.cat = g; markCats(); } } }
    if (id === "fecha") d.fecha = e.target.value;
    if (id === "cuenta") d.cuenta = e.target.value;
    if (id === "quick") { const p = parseQuick(e.target.value); if (p) applyQuick(p); }
  });
  f.addEventListener("change", e => { if (e.target.id === "cuenta") d.cuenta = e.target.value; });
  f.addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.tipo) {
      d.tipo = t.dataset.tipo;
      if (d.tipo === "Ingreso") d.cat = "Ingreso"; else if (d.cat === "Ingreso") d.cat = guessCat(d.desc) || "";
      drawSheet(false);
    }
    if (t.dataset.cat) { d.cat = t.dataset.cat; d._catTouched = true; markCats(); }
    if (t.id === "cancelBtn") closeSheet();
    if (t.id === "delBtn") {
      if (!d._confirmDel) { d._confirmDel = true; t.textContent = "Toca otra vez para borrar"; }
      else { delMov(d.id); closeSheet(); render(); toast(d.exportado ? "Borrado del cel. Si ya estaba en tu hoja, bórralo también ahí." : "Movimiento borrado"); }
    }
  });
  f.addEventListener("submit", e => { e.preventDefault(); save(); });
  $("#scrim").addEventListener("click", e => { if (e.target.id === "scrim") closeSheet(); });
  const q = $("#quick");
  if (focusQuick && q) setTimeout(() => q.focus(), 60);
}
function markCats() { document.querySelectorAll("#mform [data-cat]").forEach(b => b.setAttribute("aria-pressed", b.dataset.cat === draft.cat)); }
function applyQuick(p) {
  const d = draft, prevTipo = d.tipo;
  if (p.monto != null) { d.monto = String(p.monto); $("#monto").value = d.monto; }
  d.desc = p.desc || ""; $("#desc").value = d.desc;
  if (p.tipo) d.tipo = p.tipo;
  if (p.cat) d.cat = p.cat; else if (d.tipo === "Egreso" && !d._catTouched) d.cat = "";
  if (prevTipo !== d.tipo) {
    const qv = $("#quick").value; drawSheet(false);
    const q = $("#quick"); q.value = qv; q.focus(); q.setSelectionRange(qv.length, qv.length);
  } else markCats();
}
function closeSheet() { $("#sheetHost").innerHTML = ""; draft = null; }
function save() {
  const d = draft, monto = parseFloat(String(d.monto).replace(/[,$\s]/g, ""));
  if (!(monto > 0)) { toast("Escribe una cantidad mayor a cero"); $("#monto").focus(); return; }
  const rec = { fecha: d.fecha || today(), desc: (d.desc || "").trim(), cat: d.tipo === "Ingreso" ? "Ingreso" : (d.cat || "Otros"), monto, tipo: d.tipo, cuenta: d.cuenta };
  const editing = !!d.id;
  if (editing) updMov(d.id, { ...rec, exportado: d.exportado });
  else addMov({ ...rec, exportado: false, creado: new Date().toISOString() });
  closeSheet();
  S.ym = rec.fecha.slice(0, 7);
  render();
  toast(editing ? (d.exportado ? "Guardado. Si ya estaba en tu hoja, corrígelo también ahí." : "Cambios guardados")
                : (rec.tipo === "Ingreso" ? "Ingreso" : "Egreso") + " de " + fmtC.format(monto) + " registrado");
}
let tT;
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(tT); tT = setTimeout(() => el.hidden = true, 2800); }

/* ---------- Google Sheet ---------- */
const API = "api/hoja";                                              // ruta del Worker protegido (misma página)
const XHR = { "X-Requested-With": "XMLHttpRequest" };                // con esto Access contesta 401 y no una redirección
const sinSesion = estado => { S.sesion = { estado, email: "", vence: 0 }; };
async function callScript(payload) {
  let res, j;
  if (modoWorker()) {
    // El Worker de Cloudflare reenvía al Apps Script con la URL y la clave que viven en el servidor; aquí nunca viajan.
    res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", ...XHR }, body: JSON.stringify(payload) });
    if (res.status === 401 || res.redirected) { sinSesion("vencida"); throw new Error("tu sesión de Cloudflare venció. Entra de nuevo desde Más."); }
    if (res.status === 503 || res.status === 404 || res.status === 405) {
      sinSesion("sin-worker"); j = await res.json().catch(() => null);
      throw new Error((j && j.error) || "el Worker protegido aún no está configurado");
    }
    j = await res.json().catch(() => null);
    if (!j) throw new Error("el Worker respondió algo inesperado (HTTP " + res.status + ")");
  } else {
    // Modo directo (transición): text/plain evita la verificación CORS previa que Apps Script no responde
    res = await fetch(S.cfg.sync.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ clave: S.cfg.sync.clave, ...payload }) });
    j = await res.json();
  }
  if (!j.ok) throw new Error(j.error || "La hoja rechazó la solicitud");
  if (modoWorker() && S.sesion.estado !== "activa") S.sesion = { ...S.sesion, estado: "activa" };
  return j;
}
/* Modo Worker: pregunta quién está en sesión (correo y vencimiento) para mostrarlo en Más. */
async function revisarSesion(silencioso) {
  if (!modoWorker() || navigator.onLine === false) return;
  try {
    const res = await fetch("api/yo", { headers: XHR });
    if (res.status === 401) sinSesion("vencida");
    else if (res.status === 503 || res.status === 404 || res.status === 405) sinSesion("sin-worker");
    else { const j = await res.json(); if (j.ok) S.sesion = { estado: "activa", email: j.email || "", vence: j.vence || 0 }; }
    render();
  } catch (e) { if (!silencioso) toast("No se pudo revisar la sesión"); }
}
async function probarHoja() {
  try {
    const j = await callScript({ accion: "ping" });
    toast("Conectada a la hoja “" + (j.hoja || "") + "”" + (j.historico === false ? " (sin pestaña Historico)" : "") + (modoWorker() ? " por el Worker" : ""));
    return true;
  } catch (err) { toast("No conectó: " + err.message); return false; }
}
async function sendPending() {
  const pend = S.movs.filter(m => !m.exportado);
  if (!pend.length) return;
  S.sending = true; render();
  try {
    const j = await callScript({ accion: "agregar", filas: pend.map(toRow) });
    const ok = new Set(j.ids || pend.map(m => m.id)), ahora = new Date().toISOString();
    pend.forEach(m => { if (ok.has(m.id)) { m.exportado = true; m.enviado = ahora; } });
    persist();
    const n = j.agregadas ?? ok.size;
    toast(`${n} fila${n === 1 ? "" : "s"} en tu hoja` + (j.repetidas ? ` · ${j.repetidas} ya estaban` : ""));
  } catch (e) {
    toast(navigator.onLine === false ? "Sin internet. Se quedan pendientes y las mandas después." : "No se pudo enviar: " + e.message);
  } finally { S.sending = false; render(); }
}
async function readSheet(silencioso) {
  if (!conectada() || S.leyendo) return;
  S.leyendo = true; if (!silencioso) render();
  try {
    const j = await callScript({ accion: "leer" });
    if (!Array.isArray(j.filas)) throw new Error("tu Apps Script no tiene la acción “leer”; pega la versión nueva del README");
    S.datos = { filas: j.filas, leido: j.leido || new Date().toISOString(), malas: j.malas || 0 };
    saveDatos();
    if (!silencioso) toast(j.filas.length.toLocaleString("es-MX") + " movimientos de tu hoja");
  } catch (e) {
    if (!silencioso) toast(navigator.onLine === false ? "Sin internet. Se usa lo último que se trajo." : "No se pudo leer la hoja: " + e.message);
  } finally { S.leyendo = false; render(); }
}

/* ---------- Respaldo ---------- */
/* El respaldo nunca lleva la URL ni la clave del Apps Script. */
const respaldoJSON = () => ({ app: "finanzas-bolsillo", version: 2, fecha: new Date().toISOString(), movs: S.movs, cfg: { ...S.cfg, sync: { ...DEFAULT_CFG.sync, modo: S.cfg.sync.modo } } });
function backup() {
  const blob = new Blob([JSON.stringify(respaldoJSON(), null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "finanzas-respaldo-" + today() + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function restore(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result);
      if (!Array.isArray(j.movs)) throw new Error();
      const have = new Set(S.movs.map(m => m.id));
      const nuevos = j.movs.filter(m => m && m.id && m.fecha && !have.has(m.id));
      S.movs.push(...nuevos);
      if (j.cfg) { S.cfg.cuentas = j.cfg.cuentas || S.cfg.cuentas; S.cfg.categorias = j.cfg.categorias || S.cfg.categorias; }
      migrate(); persist(); render(); toast(nuevos.length + " movimientos restaurados");
    } catch (e) { toast("Ese archivo no es un respaldo de esta app"); }
  };
  r.readAsText(file);
}

/* ---------- Eventos ---------- */
$("#fab").addEventListener("click", () => openSheet(null));
$("#prevM").addEventListener("click", () => { S.ym = shiftMonth(S.ym, -1); render(); });
$("#nextM").addEventListener("click", () => { S.ym = shiftMonth(S.ym, 1); render(); });
document.querySelectorAll("nav.tabs [data-tab]").forEach(b => b.addEventListener("click", () => { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
window.addEventListener("online", render); window.addEventListener("offline", render);

$("#main").addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.go) {                                  // "Ver todos" y "Ver" desde Inicio
    S.tab = t.dataset.go;
    if (S.tab === "movs") { S.buscar = ""; S.ym = today().slice(0, 7); }
    render(); window.scrollTo(0, 0); return;
  }
  if (t.dataset.mas) { S.mas = t.dataset.mas; render(); }
  if (t.hasAttribute("data-bar")) t.setAttribute("aria-pressed", t.getAttribute("aria-pressed") !== "true");
  if (t.dataset.filter) { S.filter = t.dataset.filter; render(); }
  if (t.dataset.catAn || t.dataset.vista) {           // subpestañas de Análisis y "drill" desde una categoría
    if (t.dataset.catAn) S.an.cat = t.dataset.catAn;
    const cambio = t.dataset.vista && t.dataset.vista !== S.an.vista;
    if (t.dataset.vista) S.an.vista = t.dataset.vista;
    render(); if (cambio) window.scrollTo(0, 0);
  }
  if (t.dataset.metrica) { S.an.metrica = t.dataset.metrica; render(); }
  if (t.dataset.edit) {
    const m = S.movs.find(x => x.id === t.dataset.edit);
    if (m) openSheet(m); else toast("Este movimiento viene de tu hoja; edítalo ahí.");
  }
  if (t.dataset.scope) { S.expScope = t.dataset.scope; render(); }
  if (t.dataset.rm) {
    const [k, i] = t.dataset.rm.split(":");
    if (S.cfg[k].length > 1) { S.cfg[k] = S.cfg[k].filter((_, j) => j !== +i); persist(); render(); } else toast("Deja al menos una");
  }
  if (t.id === "copyBtn") {
    const ta = $("#tsv");
    try { await navigator.clipboard.writeText(ta.value); toast("Copiado. Pégalo en la columna A de tu hoja."); }
    catch (err) { ta.focus(); ta.select(); toast("Texto seleccionado: usa Copiar"); }
  }
  if (t.id === "markBtn") { const ahora = new Date().toISOString(); exportRows().forEach(m => { if (!m.exportado) { m.exportado = true; m.enviado = ahora; } }); persist(); render(); toast("Marcados como pasados"); }
  if (t.id === "sendBtn") { await sendPending(); readSheet(true); }
  if (t.id === "readBtn") readSheet(false);
  if (t.id === "testBtn") {
    t.textContent = "Probando…";
    if (modoWorker()) { if (S.sesion.estado === "sin-worker") sinSesion("desconocido"); await probarHoja(); }
    else {
      const url = $("#syncUrl").value.trim(), clave = $("#syncClave").value;
      if (!url) { toast("Pega primero la URL del Apps Script"); t.textContent = "Probar conexión"; return; }
      const prev = S.cfg.sync; S.cfg.sync = { ...prev, url, clave };
      await probarHoja();
      S.cfg.sync = prev;
    }
    t.textContent = "Probar conexión";
    render();
  }
  if (t.id === "probarWorkerBtn" || t.id === "usarWorkerBtn") {   // desde el modo directo: prueba el Worker sin perder las credenciales
    const prev = S.cfg.sync; S.cfg.sync = { ...prev, modo: "worker" }; sinSesion("desconocido");
    const ok = await probarHoja();
    if (ok && t.id === "usarWorkerBtn") { persist(); toast("Listo: los envíos pasan por el Worker protegido"); revisarSesion(true); }
    else S.cfg.sync = prev;
    render();
  }
  if (t.id === "directoBtn") { S.cfg.sync.modo = "directo"; S.confirmarBorrado = false; persist(); render(); toast("De vuelta al modo directo"); }
  if (t.id === "borrarCredBtn") {                                   // dos toques: el borrado no tiene vuelta atrás
    if (!S.confirmarBorrado) { S.confirmarBorrado = true; render(); return; }
    S.confirmarBorrado = false; S.cfg.sync = { ...S.cfg.sync, url: "", clave: "" }; persist(); render(); toast("Credenciales borradas de este iPhone");
  }
  if (t.id === "loginBtn") location.assign("api/entrar");           // Access pide el código y regresa a la app
  if (t.id === "backupBtn") backup();
});
// Gráficas: tocar o arrastrar muestra el valor. Con mouse se oculta al salir; en táctil se queda hasta tocar fuera.
$("#main").addEventListener("pointerdown", e => {
  const svg = e.target.closest("svg[data-chart]");
  if (tipSvg && tipSvg !== svg) hideTip(tipSvg);
  if (svg) chartTip(svg, e.clientX);
});
$("#main").addEventListener("pointermove", e => {
  const svg = e.target.closest("svg[data-chart]");
  if (svg && (e.pointerType === "mouse" || e.buttons)) chartTip(svg, e.clientX);
});
$("#main").addEventListener("pointerout", e => {
  const svg = e.target.closest("svg[data-chart]");
  if (svg && e.pointerType === "mouse" && !svg.contains(e.relatedTarget)) hideTip(svg);
});
$("#main").addEventListener("change", e => {
  if (e.target.id === "restoreFile" && e.target.files[0]) restore(e.target.files[0]);
  if (e.target.id === "fAnio") { S.an.anio = e.target.value; render(); }
  if (e.target.id === "fMes") { S.an.mes = +e.target.value; render(); }
});
let tB;
$("#main").addEventListener("input", e => { if (e.target.id === "buscar") { S.buscar = e.target.value; clearTimeout(tB); tB = setTimeout(render, 250); } });
$("#main").addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id === "syncForm") {
    S.cfg.sync = { ...S.cfg.sync, url: $("#syncUrl").value.trim(), clave: $("#syncClave").value };
    persist(); render(); toast(S.cfg.sync.url ? "Conexión guardada" : "Conexión quitada");
    if (S.cfg.sync.url) readSheet(false);
    return;
  }
  if (e.target.id === "invForm") {
    const p = parseFloat($("#invPct").value) / 100;
    const rep = $("#invRep").value.split(",").map(s => s.trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)%?$/)).filter(Boolean).map(m => [m[1], parseFloat(m[2]) / 100]);
    const tot = rep.reduce((a, r) => a + r[1], 0);
    if (!(p > 0 && p <= 1) || !rep.length || Math.abs(tot - 1) > 0.01) { toast("Revisa: el reparto debe sumar 100%"); return; }
    S.cfg.inversion = { pct: p, reparto: rep }; persist(); render(); toast("Meta guardada");
    return;
  }
  const f = e.target.closest("[data-add]"); if (!f) return;
  const k = f.dataset.add, inp = f.querySelector("input"), v = inp.value.trim();
  if (v && !S.cfg[k].includes(v)) { S.cfg[k] = [...S.cfg[k], v]; persist(); render(); toast("Agregado: " + v); }
  else inp.value = "";
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && draft) closeSheet(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && datosViejos()) readSheet(true); });
const datosViejos = () => !S.datos || (Date.now() - new Date(S.datos.leido)) > 3 * 36e5;

// Arranque
load();
render();
if (new URLSearchParams(location.search).has("nuevo")) openSheet(null);
if (datosViejos()) readSheet(true);
revisarSesion(true);
// El service worker se registra aquí y no en index.html: la CSP de _headers no permite scripts en línea.
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

// Funciones puras para pruebas en Node
if (typeof module !== "undefined") module.exports = { parseQuick, toRow, toTSV, normTipo, normCat, S, filas, migrate, margen, promIngresos3m, resumenMes, explicaMargen, viewInicio, lineChart, colChart, barsH, sendPending, render, callScript, respaldoJSON, revisarSesion, conectada, modoWorker };
})();
