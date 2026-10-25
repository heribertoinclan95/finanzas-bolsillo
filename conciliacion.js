/* Finanzas de Bolsillo — Conciliación bancaria: motor sin DOM.
   Lee estados de cuenta (CSV y .xlsx sin librerías), los normaliza y los compara contra las filas de la app.
   Nada de aquí guarda transacciones: solo huellas (hashes) y decisiones en la clave KEY.
   Se carga antes de app.js; la interfaz vive en conciliacion-ui.js. Se prueba en Node con tests/conciliacion.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Conciliacion = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";

const KEY = "finanzas-bolsillo-conciliacion";   // decisiones y archivos ya conciliados (ver docs/conciliacion.md)
const AUTO = 80;        // puntaje mínimo para dar un movimiento por registrado sin preguntar (además pide importe exacto)
const CANDIDATO = 40;   // puntaje mínimo para proponerlo en "Por revisar"

/* ---------- Texto ---------- */
const pad = n => String(n).padStart(2, "0");
const sinAcentos = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const normDesc = s => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9ÑÜ]+/g, " ").trim();
const normCuenta = s => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\b(CUENTA|TARJETA|TDC|TDD|CTA|BANCO)\b/g, "").replace(/\s+/g, "");
const mismaCuenta = (a, b) => !!a && !!b && (a === b || (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))));
const RUIDO = new Set(("DE LA EL LOS LAS EN Y A AL DEL POR CON SA CV SAPI SOFOM RL SC SUC MX MEX MEXICO CDMX RFC COMPRA PAGO CARGO ABONO " +
  "TARJETA TDC TDD SPEI TRANSFERENCIA TRANSF REF AUT FOLIO CONCEPTO COM NET WWW HTTP HTTPS APP ONLINE INTERNET MXN USD PESOS " +
  "OPERACION MOVIMIENTO RECURRENTE DOMICILIADO QRO GDL MTY MERCHANT PURCHASE").split(" "));
function tokens(descN) {
  return [...new Set(String(descN || "").split(" ").filter(t => t.length >= 2 && !/\d{3,}/.test(t) && !/^\d+$/.test(t) && !RUIDO.has(t)))];
}
/* Parecido entre descripciones: proporción de palabras compartidas (o con el mismo inicio) respecto a la más corta. 0..1 */
function similitud(ta, tb) {
  if (!ta || !tb || !ta.length || !tb.length) return 0;
  let n = 0;
  for (const x of ta) if (tb.some(y => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))))) n++;
  return n / Math.min(ta.length, tb.length);
}
/* Hash FNV-1a de 32 bits con dos semillas → 16 hex. Identificador, no criptografía. */
function h32(s, seed) { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
const hashTexto = s => h32(s, 0x811c9dc5).toString(16).padStart(8, "0") + h32(s, 0x01000193).toString(16).padStart(8, "0");

/* ---------- Fechas e importes ---------- */
const MESN = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DIC: 12, JAN: 1, APR: 4, AUG: 8, DEC: 12 };
const mesNombre = s => MESN[s.slice(0, 4)] || MESN[s.slice(0, 3)] || 0;
function serialExcel(n, base1904) {
  if (!(n > 0 && n < 100000)) return null;
  const d = new Date(Math.round((n + (base1904 ? 1462 : 0) - 25569) * 864e5));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
/* Devuelve "yyyy-mm-dd" o null. fmt: "dmy" | "mdy" | "ymd" | undefined (auto: México primero). */
function parseFecha(v, fmt) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return serialExcel(v);
  const s = sinAcentos(v).trim().toUpperCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && fmt !== "dmy" && fmt !== "mdy") { const d = new Date(s + "T00:00:00Z"); return isNaN(d) ? null : s; }
  let m, y, mo, d;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) {
    const a = +m[1], b = +m[2]; y = +m[3];
    const mdy = fmt === "mdy" || (fmt !== "dmy" && a <= 12 && b > 12);
    d = mdy ? b : a; mo = mdy ? a : b;
  }
  else if ((m = s.match(/^(\d{1,2})\s*(?:DE\s+)?[-/. ]*([A-Z]{3,})[-/. ,]*(?:DE\s+)?(\d{2,4})/))) { d = +m[1]; mo = mesNombre(m[2]); y = +m[3]; }
  else if ((m = s.match(/^([A-Z]{3,})[-/. ]*(\d{1,2})[-/. ,]*(\d{2,4})/))) { mo = mesNombre(m[1]); d = +m[2]; y = +m[3]; }
  else if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if (/^\d{5}$/.test(s)) return serialExcel(+s);
  else return null;
  if (!mo || mo < 1 || mo > 12 || !d || d < 1 || d > 31) return null;
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCDate() !== d) return null;
  return y + "-" + pad(mo) + "-" + pad(d);
}
/* Si alguna fecha trae día > 12 en la primera posición es día/mes; si lo trae en la segunda es mes/día. Por defecto día/mes. */
function detectarFormatoFecha(valores) {
  let dmy = 0, mdy = 0;
  for (const v of valores) {
    const m = String(v ?? "").trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++;
  }
  return mdy && !dmy ? "mdy" : "dmy";
}
/* "$1,234.50", "-1,234.50", "(1,234.50)", "1.234,56", "12,50", "1234.5 MXN" → número con signo; vacío o raro → null */
function parseMonto(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v ?? "").trim();
  if (!s || /^[-−–—]+$/.test(s)) return null;
  const neg = /^\(.*\)$/.test(s) || /[-−–]/.test(s);
  s = s.replace(/[^\d.,]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const hasC = s.includes(","), hasP = s.includes(".");
  if (hasC && hasP) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (hasC) { const p = s.split(","); s = p.length === 2 && p[1].length !== 3 ? p[0] + "." + p[1] : s.replace(/,/g, ""); }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}
function signoTexto(v) {
  const s = sinAcentos(v).trim().toUpperCase();
  if (!s) return null;
  if (/CARGO|RETIRO|DEBITO|EGRESO|COMPRA|WITHDRAW|DEBIT|^D$|^-$|^DR$/.test(s)) return "Egreso";
  if (/ABONO|DEPOSITO|CREDITO|INGRESO|DEPOSIT|CREDIT|^C$|^\+$|^CR$/.test(s)) return "Ingreso";
  return null;
}

/* ---------- CSV ---------- */
function detectarDelim(text) {
  const lineas = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 25);
  let mejor = ",", max = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const c = lineas.map(l => l.split(d).length - 1).sort((a, b) => a - b);
    const med = c[Math.floor(c.length / 2)] || 0;
    const cons = c.filter(x => x === med).length;
    const puntos = med * 100 + cons;
    if (med > 0 && puntos > max) { max = puntos; mejor = d; }
  }
  return mejor;
}
function parseCSV(text, delim) {
  text = String(text ?? "").replace(/^﻿/, "");
  delim = delim || detectarDelim(text);
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === delim) { row.push(cell); cell = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(v => typeof v === "string" ? v.trim() : v)).filter(r => r.some(v => v !== ""));
}
/* UTF-8 si es válido; si no, Windows-1252 (acentos de exportaciones viejas de bancos). */
function decodificar(buffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch (e) { try { return new TextDecoder("windows-1252").decode(buffer); } catch (e2) { return new TextDecoder().decode(buffer); } }
}

/* ---------- XLSX sin librerías: ZIP + XML con expresiones regulares + inflado nativo (DecompressionStream) ---------- */
const utf8 = u8 => new TextDecoder("utf-8").decode(u8);
function zipEntradas(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("no es un archivo .xlsx válido");
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const entradas = {};
  for (let k = 0; k < n && p + 46 <= u8.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    entradas[utf8(u8.subarray(p + 46, p + 46 + nlen))] = { method, csize, usize, loff };
    p += 46 + nlen + elen + clen;
  }
  return entradas;
}
async function zipLeer(buf, e) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const nlen = dv.getUint16(e.loff + 26, true), elen = dv.getUint16(e.loff + 28, true);
  const ini = e.loff + 30 + nlen + elen, datos = u8.subarray(ini, ini + e.csize);
  if (e.method === 0) return datos;
  if (e.method !== 8) throw new Error("compresión no soportada en el .xlsx");
  if (typeof DecompressionStream === "undefined") throw new Error("este navegador no puede descomprimir .xlsx; exporta el estado de cuenta como CSV");
  const out = await new Response(new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
  return new Uint8Array(out);
}
const desXml = s => String(s ?? "").replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, k) =>
  k === "amp" ? "&" : k === "lt" ? "<" : k === "gt" ? ">" : k === "quot" ? '"' : k === "apos" ? "'" : String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : +k.slice(1)));
const attr = (tag, name) => { const m = tag.match(new RegExp("(?:^|\\s)" + name + "=\"([^\"]*)\"")); return m ? desXml(m[1]) : null; };
const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const esFormatoFecha = (id, codigo) => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58) ||
  (!!codigo && /[dmyh]/i.test(codigo.replace(/"[^"]*"|\[[^\]]*\]/g, "")) && !/[#0]/.test(codigo.replace(/"[^"]*"|\[[^\]]*\]/g, "")));
async function leerXLSX(buf) {
  const z = zipEntradas(buf);
  const texto = async n => z[n] ? utf8(await zipLeer(buf, z[n])) : "";
  const wb = await texto("xl/workbook.xml");
  if (!wb) throw new Error("el .xlsx no trae libro de hojas");
  const base1904 = /date1904="(1|true)"/.test(wb);
  const rels = {}; for (const m of (await texto("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b([^>]*)\/?>/g)) { const id = attr(m[1], "Id"), t = attr(m[1], "Target"); if (id && t) rels[id] = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.?\//, ""); }
  const shared = []; for (const m of (await texto("xl/sharedStrings.xml")).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(desXml([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join("")));
  const estilos = await texto("xl/styles.xml");
  const fmts = {}; for (const m of estilos.matchAll(/<numFmt\b([^>]*)\/?>/g)) fmts[attr(m[1], "numFmtId")] = attr(m[1], "formatCode");
  const xfs = []; const cx = estilos.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/); if (cx) for (const m of cx[1].matchAll(/<xf\b([^>]*)\/?>/g)) { const id = +(attr(m[1], "numFmtId") || 0); xfs.push(esFormatoFecha(id, fmts[id])); }
  const hojas = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const nombre = attr(m[1], "name") || "Hoja", rid = attr(m[1], "r:id") || attr(m[1], "id");
    const ruta = rels[rid]; if (!ruta || !z[ruta]) continue;
    const xml = await texto(ruta), filas = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const fila = [];
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], "r"), t = attr(c[1], "t"), s = +(attr(c[1], "s") || 0), cuerpo = c[2] || "";
        const i = ref ? colIdx(ref) : fila.length;
        const v = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = "";
        if (t === "s") val = shared[+v] ?? "";
        else if (t === "inlineStr") val = desXml([...cuerpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(""));
        else if (t === "str" || t === "e") val = desXml(v ?? "");
        else if (t === "b") val = v === "1" ? "1" : "0";
        else if (v != null && v !== "") { const num = Number(v); val = isFinite(num) ? (xfs[s] ? (serialExcel(num, base1904) || num) : num) : desXml(v); }
        while (fila.length < i) fila.push("");
        fila[i] = typeof val === "string" ? val.trim() : val;
      }
      if (fila.some(v => v !== "" && v != null)) filas.push(fila);
    }
    hojas.push({ nombre, filas });
  }
  if (!hojas.length) throw new Error("el .xlsx no tiene hojas con datos");
  return hojas;
}
/* Detecta el formato por contenido y devuelve { hojas: [{ nombre, filas }], hoja: índice sugerido (la hoja con más filas) } */
async function leerArchivo(nombre, buffer) {
  const u8 = new Uint8Array(buffer);
  const esZip = u8[0] === 0x50 && u8[1] === 0x4b, esOle = u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0;
  if (esOle) throw new Error("es un Excel antiguo (.xls). Guárdalo como .xlsx o CSV");
  if (esZip || /\.xlsx$/i.test(nombre || "")) {
    const hojas = await leerXLSX(buffer);
    let hoja = 0; hojas.forEach((h, i) => { if (h.filas.length > hojas[hoja].filas.length) hoja = i; });
    return { hojas, hoja };
  }
  return { hojas: [{ nombre: "CSV", filas: parseCSV(decodificar(buffer)) }], hoja: 0 };
}

/* ---------- Columnas: por encabezado y, si no hay, por contenido ---------- */
const COLS = {
  fecha: /^fecha|^date|^f\.?\s*(oper|valor|mov|aplic|cargo|trans)|^dia\b|^fec\b/,
  saldo: /saldo|balance/,
  cargo: /cargo|retiro|debito|egreso|salida|withdraw|debit|^debe|^gasto/,
  abono: /abono|deposito|credito|ingreso|entrada|deposit|credit|^haber/,
  monto: /^monto|^importe|^cantidad|^amount|^valor|^total/,
  tipo: /^tipo|cargo ?\/ ?abono|naturaleza|^signo|^clase|^d\/c$|^c\/a$/,
  desc: /descrip|concepto|detalle|movimiento|^memo|comercio|establecimiento|leyenda|narrative|beneficiario|observaci/,
  id: /^id\b|^referencia|folio|autorizaci|clave de rastreo|^num|^no\.? ?(de )?(ref|op|mov|tran)|transaction id|^ref\b/
};
const ORDEN = ["fecha", "saldo", "tipo", "cargo", "abono", "monto", "desc", "id"];   // "tipo" antes de "cargo": un encabezado "Cargo/Abono" es el tipo, no el importe
const COLKEYS = ["fecha", "desc", "cargo", "abono", "monto", "tipoCol", "id", "saldo"];
function estadisticas(rows, inicio) {
  const n = Math.max(...rows.slice(inicio, inicio + 80).map(r => r.length), 0), st = [];
  for (let j = 0; j < n; j++) {
    let fechas = 0, nums = 0, llenas = 0, len = 0, neg = 0, suma = 0, distintos = new Set();
    rows.slice(inicio, inicio + 80).forEach(r => {
      const v = r[j]; if (v == null || v === "") return;
      llenas++; distintos.add(String(v).toUpperCase());
      if (typeof v === "string" && !/^\d+([.,]\d+)?$/.test(v.trim()) && parseFecha(v)) fechas++;   // "12345" es referencia o importe, no fecha serial
      const m = typeof v === "number" ? v : (/^[\s$(+\-−–]*[\d.,]+[\s)\-−–]*(MXN|USD)?$/i.test(String(v)) ? parseMonto(v) : null);
      if (m != null) { nums++; suma += Math.abs(m); if (m < 0) neg++; } else len += String(v).length;
    });
    st.push({ j, llenas, fechas, nums, neg, prom: nums ? suma / nums : 0, len: llenas - nums ? len / (llenas - nums) : 0, distintos: distintos.size });
  }
  return st;
}
function asignarNumericas(mapeo, st, libres, rows, inicio) {
  const nums = libres.filter(s => s.llenas && s.nums / s.llenas >= 0.6).sort((a, b) => b.llenas - a.llenas);
  if (!nums.length) return;
  const muestra = rows.slice(inicio, inicio + 80), vale = (r, j) => { const m = parseMonto(r[j]); return m != null && m !== 0; };
  // Cargo y abono casi nunca traen valor en la misma fila; importe y saldo sí.
  const excluyentes = (a, b) => { let ambos = 0, alguno = 0; muestra.forEach(r => { const x = vale(r, a.j), y = vale(r, b.j); if (x || y) alguno++; if (x && y) ambos++; }); return alguno > 0 && ambos <= alguno * 0.1; };
  let resto = nums;
  if (resto.length >= 3) { const saldo = resto.slice().sort((a, b) => b.prom - a.prom)[0]; mapeo.saldo = saldo.j; resto = resto.filter(s => s !== saldo); }
  if (resto.length === 1) { mapeo.monto = resto[0].j; return; }
  const [a, b] = resto;
  if (excluyentes(a, b)) {
    const cargo = a.neg > b.neg ? a : b.neg > a.neg ? b : a.llenas >= b.llenas ? a : b;   // la de más filas suele ser cargos
    mapeo.cargo = cargo.j; mapeo.abono = (cargo === a ? b : a).j;
  } else { const saldo = a.prom >= b.prom ? a : b; mapeo.saldo = saldo.j; mapeo.monto = (saldo === a ? b : a).j; }
}
function detectarColumnas(rows) {
  const mapeo = { fecha: null, desc: null, cargo: null, abono: null, monto: null, tipoCol: null, id: null, saldo: null, inicio: 0, formatoFecha: "dmy", invertir: false };
  let enc = -1;
  for (let i = 0; i < Math.min(rows.length, 40) && enc < 0; i++) {
    const h = {}; let n = 0;
    rows[i].forEach((c, j) => {
      const s = sinAcentos(c).trim().toLowerCase(); if (!s || s.length > 40) return;
      for (const k of ORDEN) if (COLS[k].test(s)) { if (h[k] == null) { h[k] = j; n++; } break; }
    });
    if (h.fecha != null && n >= 2) { enc = i; Object.assign(mapeo, { fecha: h.fecha, desc: h.desc ?? null, cargo: h.cargo ?? null, abono: h.abono ?? null, monto: h.monto ?? null, tipoCol: h.tipo ?? null, id: h.id ?? null, saldo: h.saldo ?? null, inicio: i + 1 }); }
  }
  const st = estadisticas(rows, Math.max(0, mapeo.inicio));
  const usados = () => new Set(COLKEYS.map(k => mapeo[k]).filter(v => typeof v === "number"));
  if (enc < 0) {
    const f = st.filter(s => s.llenas && s.fechas / s.llenas >= 0.5).sort((a, b) => b.fechas - a.fechas)[0];
    if (!f) return { mapeo, encabezado: null };
    mapeo.fecha = f.j;
    mapeo.inicio = Math.max(0, rows.findIndex(r => parseFecha(r[f.j])));
  }
  if (mapeo.tipoCol != null && (st[mapeo.tipoCol] || {}).distintos > 6) { if (mapeo.desc == null) mapeo.desc = mapeo.tipoCol; mapeo.tipoCol = null; }
  if (mapeo.cargo == null && mapeo.abono == null && mapeo.monto == null) asignarNumericas(mapeo, st, st.filter(s => !usados().has(s.j)), rows, Math.max(0, mapeo.inicio));
  if (mapeo.desc == null) {
    const texto = st.filter(s => !usados().has(s.j) && s.llenas && s.nums / s.llenas < 0.4 && s.fechas / s.llenas < 0.5).sort((a, b) => b.len - a.len)[0];
    if (texto) mapeo.desc = texto.j; else if (mapeo.id != null) { mapeo.desc = mapeo.id; mapeo.id = null; }
  }
  if (mapeo.cargo != null && mapeo.abono == null && mapeo.monto == null) { mapeo.monto = mapeo.cargo; mapeo.cargo = null; mapeo.invertir = true; }   // "Cargo" solo: positivo = cargo
  if (mapeo.abono != null && mapeo.cargo == null && mapeo.monto == null) { mapeo.monto = mapeo.abono; mapeo.abono = null; }
  mapeo.formatoFecha = detectarFormatoFecha(rows.slice(mapeo.inicio).map(r => r[mapeo.fecha]));
  return { mapeo, encabezado: enc >= 0 ? rows[enc] : null };
}
/* Tarjetas de crédito que exportan una sola columna con los cargos en positivo: sugiere invertir el signo. */
function sugerirInvertir(mapeo, movs, cuenta) {
  if (mapeo.monto == null || mapeo.tipoCol != null || !movs.length) return false;
  if (!/AMEX|TDC|CREDIT|TARJETA|VISA|MASTER/i.test(sinAcentos(cuenta))) return false;
  return movs.filter(m => m.tipo === "Ingreso").length / movs.length >= 0.7;
}

/* ---------- Normalización: filas crudas → movimientos del banco ---------- */
const red2 = n => Math.round(n * 100) / 100;
function asignarHuellas(movs) {
  const cnt = {};
  movs.forEach(m => {
    const base = [m.cuentaN, m.fecha, m.monto.toFixed(2), m.tipo, m.descN, m.idBanco || ""].join("|");
    const k = cnt[base] || 0; cnt[base] = k + 1;
    m.huella = hashTexto(base + "|" + k);   // dos movimientos iguales el mismo día tienen huellas distintas (0 y 1)
  });
  return movs;
}
function normalizar(rows, mapeo, opts = {}) {
  const movs = [], errores = []; let omitidas = 0;
  const fmtF = mapeo.formatoFecha === "auto" ? detectarFormatoFecha(rows.slice(mapeo.inicio || 0).map(r => r[mapeo.fecha])) : mapeo.formatoFecha;
  for (let i = mapeo.inicio || 0; i < rows.length; i++) {
    const r = rows[i]; if (!r || !r.some(v => v !== "" && v != null)) continue;
    const fecha = mapeo.fecha != null ? parseFecha(r[mapeo.fecha], fmtF) : null;
    let monto = null, tipo = null;
    if (mapeo.cargo != null || mapeo.abono != null) {
      const c = mapeo.cargo != null ? parseMonto(r[mapeo.cargo]) : null, a = mapeo.abono != null ? parseMonto(r[mapeo.abono]) : null;
      if (c && a) { if (Math.abs(c) >= Math.abs(a)) { monto = Math.abs(c); tipo = "Egreso"; } else { monto = Math.abs(a); tipo = "Ingreso"; } }
      else if (c) { monto = Math.abs(c); tipo = "Egreso"; }
      else if (a) { monto = Math.abs(a); tipo = "Ingreso"; }
    } else if (mapeo.monto != null) {
      const v = parseMonto(r[mapeo.monto]);
      if (v != null && v !== 0) {
        let ing = v > 0;
        if (mapeo.tipoCol != null) { const t = signoTexto(r[mapeo.tipoCol]); if (t) ing = t === "Ingreso"; }
        monto = Math.abs(v); tipo = ing ? "Ingreso" : "Egreso";
      }
    }
    if (tipo && mapeo.invertir) tipo = tipo === "Egreso" ? "Ingreso" : "Egreso";
    if (!fecha || !(monto > 0)) { if (fecha || monto != null) errores.push({ fila: i + 1, motivo: !fecha ? "sin fecha" : "sin importe" }); else omitidas++; continue; }
    const desc = String(mapeo.desc != null ? r[mapeo.desc] ?? "" : "").replace(/\s+/g, " ").trim();
    const idBanco = mapeo.id != null ? String(r[mapeo.id] ?? "").trim() : "";
    movs.push({ n: movs.length, fecha, desc, descN: normDesc(desc), monto: red2(monto), tipo, cuenta: opts.cuenta || "", cuentaN: normCuenta(opts.cuenta || ""), idBanco });
  }
  asignarHuellas(movs);
  movs.forEach(m => { m.tok = tokens(m.descN); });
  return { movs, errores, omitidas };
}
/* Huella del archivo: depende de los movimientos leídos (y de la cuenta), no del nombre. Sirve para avisar que ya se concilió. */
const hashArchivo = movs => hashTexto(movs.map(m => m.huella).join(","));

/* ---------- Filas de la app (filas() de app.js) con huella estable ---------- */
function prepararApp(filas) {
  const app = filas.map(r => ({ ref: r.ref, fecha: r.fecha, desc: r.desc || "", descN: normDesc(r.desc), monto: red2(+r.monto || 0), tipo: r.tipo, cat: r.cat, cuenta: r.cuenta || "", cuentaN: normCuenta(r.cuenta || ""), local: !!r.local, pendiente: !!r.pendiente, idBanco: "" }));
  asignarHuellas(app);
  app.forEach(a => { a.tok = tokens(a.descN); });
  return app;
}

/* ---------- Reglas especiales: no son gastos ni ingresos nuevos ---------- */
const RE_PAGO_TDC = /\bPAGO\b.*\b(TARJETA|TDC|TCR|CREDITO|AMEX|AMERICAN EXPRESS|VISA|MASTERCARD|MASTER CARD|LIVERPOOL|BANAMEX|CITIBANAMEX|BBVA|BANCOMER|SANTANDER|HSBC|BANORTE|SCOTIABANK|INBURSA|RAPPI|STORI|KLAR|PLATA|NU)\b|\b(SU PAGO|PAGO RECIBIDO|GRACIAS POR SU PAGO|PAYMENT RECEIVED|THANK YOU|PAGO EN LINEA|PAGO TDC|ABONO A SU TARJETA|PAGO DE TARJETA|PAGO A TARJETA)\b/;
const RE_TRASPASO = /\bTRASPASO\b|\bENTRE CUENTAS\b|\bCUENTAS PROPIAS\b|\bMISM[OA] TITULAR\b/;
const RE_EFECTIVO = /\b(RETIRO|DISPOSICION|DISP)\b.*\b(CAJERO|ATM|EFECTIVO)\b|\bATM\b|\bCAJERO AUTOMATICO\b/;
function especial(b, otrasCuentasN) {
  const d = b.descN;
  if (RE_PAGO_TDC.test(d)) return "pagoTarjeta";
  if (RE_TRASPASO.test(d)) return "traspaso";
  if (otrasCuentasN.some(c => c.length >= 3 && c !== "EFECTIVO" && new RegExp("\\b" + c + "\\b").test(d))) return "traspaso";
  if (b.tipo === "Egreso" && RE_EFECTIVO.test(d)) return "efectivo";
  return null;
}
const REGLAS = { pagoTarjeta: "Pago de tarjeta", traspaso: "Traspaso entre tus cuentas", efectivo: "Retiro de efectivo" };

/* ---------- Puntaje de una pareja banco ↔ app ---------- */
const dias = (f1, f2) => Math.round(Math.abs(new Date(f1 + "T00:00:00Z") - new Date(f2 + "T00:00:00Z")) / 864e5);
const shiftDays = (f, n) => new Date(new Date(f + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
function puntuar(b, a, tol) {
  if (a.tipo !== b.tipo) return null;
  const d = dias(a.fecha, b.fecha); if (d > tol) return null;
  const dif = red2(a.monto - b.monto), adif = Math.abs(dif);
  let s = 0, exacto = false, pideParecido = false;
  if (adif < 0.005) { s += 60; exacto = true; }
  else if (adif <= Math.max(1, b.monto * 0.01)) s += 35;
  else if (adif <= b.monto * 0.15) { s += 15; pideParecido = true; }
  else return null;
  s += d <= 3 ? 30 - 3 * d : 18 - d;
  const sim = similitud(b.tok, a.tok);
  if (sim >= 0.6) s += 15; else if (sim >= 0.3) s += 8;
  if (pideParecido && sim < 0.3) return null;
  const otraCuenta = !mismaCuenta(a.cuentaN, b.cuentaN);
  if (otraCuenta) { if (!exacto) return null; s -= 20; }
  return { score: s, exacto, auto: exacto && !otraCuenta && s >= AUTO, dias: d, difMonto: dif, sim, otraCuenta };
}

/* ---------- Conciliación ----------
   banco: movs de normalizar() · app: prepararApp(filas()) · decisiones: estado.decisiones
   Devuelve registrados, faltantes, revisar, soloApp, traspasos e ignorados. Nunca modifica movimientos. */
function conciliar({ banco, app, cuenta, cuentas = [], tol = 3, decisiones = {} }) {
  const cuentaN = normCuenta(cuenta || "");
  const otrasN = cuentas.map(normCuenta).filter(c => c && c !== cuentaN);
  banco.forEach(b => { if (!b.tok) b.tok = tokens(b.descN); if (!b.cuentaN) b.cuentaN = cuentaN; });
  const usadas = new Set(), asignB = new Set();
  const registrados = [], faltantes = [], revisar = [], traspasos = [], ignorados = [], pendientes = [];
  const porHuella = new Map(app.map(a => [a.huella, a])), porRef = new Map(app.filter(a => a.local).map(a => [a.ref, a]));
  for (const b of banco) {
    const dec = decisiones[b.huella];
    b.regla = especial(b, otrasN);
    if (dec && dec.t === "i") { ignorados.push({ b }); continue; }
    if (dec && dec.t === "v") {
      const a = (dec.id && porRef.get(dec.id)) || (dec.h && porHuella.get(dec.h));
      if (a && !usadas.has(a.huella)) { usadas.add(a.huella); registrados.push({ b, a, manual: true, score: null }); continue; }
    }
    if (dec && dec.t === "g") b.regla = null;   // el usuario dijo que sí es un gasto/ingreso normal
    pendientes.push(b);
  }
  // Solo se comparan filas de la app dentro del periodo del archivo ± tolerancia (el historial completo son miles de filas).
  const fechas = banco.map(b => b.fecha).sort(), desde = fechas[0] || null, hasta = fechas[fechas.length - 1] || null;
  const ventana = desde ? app.filter(a => a.fecha >= shiftDays(desde, -tol) && a.fecha <= shiftDays(hasta, tol)) : [];
  const pares = [], candB = new Map(pendientes.map(b => [b, []])), candA = new Map();
  for (const b of pendientes) for (const a of ventana) {
    if (usadas.has(a.huella)) continue;
    const p = puntuar(b, a, tol); if (!p || p.score < CANDIDATO) continue;
    if (a.fecha < desde || a.fecha > hasta) { p.fueraPeriodo = true; p.auto = false; }   // cruza el periodo: puede ser del estado de cuenta anterior o siguiente, se pregunta
    const par = { b, a, ...p }; pares.push(par); candB.get(b).push(par);
    if (!candA.has(a)) candA.set(a, []); candA.get(a).push(par);
  }
  pares.sort((x, y) => y.score - x.score || x.b.n - y.b.n);
  const clave = r => r.fecha + "|" + r.monto.toFixed(2) + "|" + r.tipo + "|" + r.descN;
  for (const p of pares) {
    if (!p.auto || asignB.has(p.b) || usadas.has(p.a.huella)) continue;
    // Ambiguo si otra fila de la app compite por este cargo (o viceversa) con puntaje casi igual,
    // salvo que sean repetidos idénticos en ambos lados y en el mismo número (dos OXXO de $50 el mismo día).
    const altA = candB.get(p.b).filter(q => q !== p && !usadas.has(q.a.huella) && q.score >= p.score - 10);
    const altB = candA.get(p.a).filter(q => q !== p && !asignB.has(q.b) && q.score >= p.score - 10);
    let ambiguo = altA.length > 0 || altB.length > 0;
    if (ambiguo && altA.length === altB.length && altA.every(q => clave(q.a) === clave(p.a)) && altB.every(q => clave(q.b) === clave(p.b))) ambiguo = false;
    if (ambiguo) continue;
    asignB.add(p.b); usadas.add(p.a.huella); registrados.push({ b: p.b, a: p.a, manual: false, score: p.score });
  }
  for (const b of pendientes) {
    if (asignB.has(b)) continue;
    const candidatos = candB.get(b).filter(q => !usadas.has(q.a.huella)).sort((x, y) => y.score - x.score).slice(0, 5);
    if (b.regla) traspasos.push({ b, regla: b.regla, candidatos });
    else if (candidatos.length) revisar.push({ b, candidatos });
    else faltantes.push({ b, candidatos: [] });
  }
  const enRevision = new Set(revisar.flatMap(r => r.candidatos.map(c => c.a.huella)));
  const soloApp = app.filter(a => desde && !usadas.has(a.huella) && !enRevision.has(a.huella) && mismaCuenta(a.cuentaN, cuentaN) && a.fecha >= desde && a.fecha <= hasta);
  const porFecha = (x, y) => y.b.fecha.localeCompare(x.b.fecha) || x.b.n - y.b.n;
  [registrados, faltantes, revisar, traspasos, ignorados].forEach(l => l.sort(porFecha));
  soloApp.sort((x, y) => y.fecha.localeCompare(x.fecha));
  const suma = (l, t) => red2(l.filter(x => x.b.tipo === t).reduce((s, x) => s + x.b.monto, 0));
  return { registrados, faltantes, revisar, soloApp, traspasos, ignorados, n: banco.length, rango: { desde, hasta },
    faltanEgresos: suma(faltantes, "Egreso"), faltanIngresos: suma(faltantes, "Ingreso") };
}
/* Filas de la app cercanas a un movimiento del banco, para "Vincular con movimiento existente". */
function cercanos(b, app, usadas, maxDias = 10, n = 8) {
  const ini = shiftDays(b.fecha, -maxDias), fin = shiftDays(b.fecha, maxDias);
  return app.filter(a => a.tipo === b.tipo && !usadas.has(a.huella) && a.fecha >= ini && a.fecha <= fin)
    .map(a => ({ a, dif: Math.abs(a.monto - b.monto), d: dias(a.fecha, b.fecha) }))
    .sort((x, y) => x.dif - y.dif || x.d - y.d).slice(0, n);
}

/* ---------- Almacenamiento (clave propia, sin transacciones) ----------
   { v: 1, tol, cuenta, decisiones: { huellaBanco: { t: "v"|"i"|"g", id?, h?, f } }, archivos: { hashArchivo: { cuenta, n, f, nombre } } }
   t: "v" vinculado a una fila de la app (id del movimiento local y/o huella) · "i" ignorado · "g" tratar como movimiento normal (no es traspaso) */
const nuevoEstado = () => ({ v: 1, tol: 3, cuenta: "", decisiones: {}, archivos: {} });
function cargarEstado(storage) {
  try { const j = JSON.parse(storage.getItem(KEY) || "null"); if (j && j.v === 1 && j.decisiones && typeof j.decisiones === "object") return { ...nuevoEstado(), ...j }; } catch (e) { /* dañado: se empieza vacío */ }
  return nuevoEstado();
}
function guardarEstado(storage, estado) { try { storage.setItem(KEY, JSON.stringify(estado)); return true; } catch (e) { return false; } }

return { KEY, AUTO, CANDIDATO, REGLAS, parseCSV, detectarDelim, decodificar, parseFecha, parseMonto, detectarFormatoFecha, normDesc, normCuenta, mismaCuenta, tokens, similitud, hashTexto,
  leerXLSX, leerArchivo, detectarColumnas, normalizar, sugerirInvertir, hashArchivo, prepararApp, especial, puntuar, conciliar, cercanos, dias, shiftDays,
  nuevoEstado, cargarEstado, guardarEstado };
});
