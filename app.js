/* Finanzas de Bolsillo — app de una sola página, sin dependencias.
   Datos: localStorage del teléfono (clave LKEY). Opcional: envío a Google Sheet vía Apps Script. */
(() => {
"use strict";

/* ---------- Configuración por defecto ---------- */
const DEFAULT_CFG = {
  cuentas: ["Cuenta SIMPLICITY", "AMEX", "Efectivo"],
  categorias: ["Comida", "Super", "Despensa", "Transporte", "Subscripcion", "Salud y bienestar", "Renta", "SAT", "Otros"],
  reglas: {
    "Comida": ["desayuno", "comida", "cena", "postre", "agua", "cafe", "café", "dogo", "tacos", "lunch", "antojo"],
    "Super": ["super", "súper", "walmart", "soriana", "chedraui", "costco", "sams"],
    "Transporte": ["uber", "didi", "taxi", "gasolina", "camion", "camión", "caseta"],
    "Subscripcion": ["netflix", "spotify", "claude", "chatgpt", "icloud", "youtube", "prime", "suscripcion", "suscripción", "subscripcion"],
    "Salud y bienestar": ["farmacia", "doctor", "befit", "gym", "medicina", "dentista"],
    "Renta": ["renta"],
    "SAT": ["sat", "impuesto"],
    "Otros": ["ropa", "topps", "apuesta", "regalo"]
  },
  inversion: { pct: 0.20, reparto: [["CETES", 0.674], ["GBM", 0.196], ["Cripto", 0.13]] },
  sync: { url: "", clave: "" }
};
const LKEY = "finanzas-bolsillo-v1";
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2, minimumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));

const S = { movs: [], cfg: clone(DEFAULT_CFG), tab: "mes", ym: today().slice(0, 7), filter: "Todos", expScope: "pend", sending: false };

/* ---------- Almacenamiento local ---------- */
function load() {
  try {
    const j = JSON.parse(localStorage.getItem(LKEY) || "null");
    if (j) {
      S.movs = Array.isArray(j.movs) ? j.movs : [];
      S.cfg = { ...clone(DEFAULT_CFG), ...(j.cfg || {}) };
      S.cfg.sync = { ...DEFAULT_CFG.sync, ...(S.cfg.sync || {}) };
    }
  } catch (e) { /* datos dañados: se empieza vacío */ }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
}
function persist() {
  try { localStorage.setItem(LKEY, JSON.stringify({ movs: S.movs, cfg: S.cfg })); return true; }
  catch (e) { toast("No se pudo guardar en el teléfono. Libera espacio y vuelve a intentar."); return false; }
}
function addMov(m) { S.movs.push({ id: uid(), ...m }); persist(); }
function updMov(id, patch) { const m = S.movs.find(x => x.id === id); if (m) Object.assign(m, patch); persist(); }
function delMov(id) { S.movs = S.movs.filter(x => x.id !== id); persist(); }

/* ---------- Captura rápida estilo WhatsApp ---------- */
function guessCat(text) {
  const t = " " + String(text).toLowerCase() + " ";
  for (const [cat, words] of Object.entries(S.cfg.reglas || {})) {
    if (!S.cfg.categorias.includes(cat)) continue;
    if (words.some(w => t.includes(" " + w))) return cat;
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
  return { monto, tipo: ingreso ? "Ingresos" : "Egreso", desc: desc || (ingreso ? "Ingreso" : ""), cat: ingreso ? "Ingreso" : guessCat(desc) };
}

/* ---------- Cálculos ---------- */
const inMonth = ym => S.movs.filter(m => (m.fecha || "").slice(0, 7) === ym);
const sum = arr => arr.reduce((a, m) => a + (+m.monto || 0), 0);
const isIn = m => m.tipo === "Ingresos";
const monthLabel = ym => { const [y, mo] = ym.split("-"); return MESES[+mo - 1] + " " + y; };
function shiftMonth(ym, d) { let [y, m] = ym.split("-").map(Number); m += d; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } return y + "-" + pad(m); }
const ddmmaa = f => { const [y, m, d] = f.split("-"); return d + "/" + m + "/" + y.slice(2); };
const dayName = f => new Date(f + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" });

/* Fila en el formato de la hoja Finanzas 2026:
   A Mes (número) · B Fecha dd/mm/aa · C Descripción (MAYÚSCULAS) · D Categoría · E Cantidad · F Tipo · G Salió de */
function toRow(m) {
  return {
    id: m.id,
    mes: +m.fecha.slice(5, 7),
    fecha: m.fecha,
    descripcion: (m.desc || "").toUpperCase(),
    categoria: isIn(m) ? "Ingreso" : (m.cat || "Otros"),
    cantidad: +m.monto || 0,
    tipo: isIn(m) ? "Ingresos" : "Egreso",
    cuenta: m.cuenta || ""
  };
}
const toTSV = rows => rows.map(toRow).map(r => [r.mes, ddmmaa(r.fecha), r.descripcion, r.categoria, "$" + fmt2.format(r.cantidad), r.tipo, r.cuenta].join("\t")).join("\n");

/* ---------- Vistas ---------- */
function emptyState() {
  return `<div class="empty"><strong>Sin movimientos en ${esc(monthLabel(S.ym))}</strong>
  Toca <b>+</b> y escribe como en tu chat de WhatsApp:<br><br><code>comida 145</code> · <code>uber 87</code> · <code>+11652 nómina</code></div>`;
}

function viewMes() {
  const ms = inMonth(S.ym), ins = ms.filter(isIn), outs = ms.filter(m => !isIn(m));
  const tIn = sum(ins), tOut = sum(outs), neto = tIn - tOut;
  if (!ms.length) return emptyState();
  const [y, mo] = S.ym.split("-").map(Number);
  const byCat = {}; outs.forEach(m => { const c = m.cat || "Otros"; byCat[c] = (byCat[c] || 0) + (+m.monto || 0); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxC = cats.length ? cats[0][1] : 1;
  const byAcc = {}; outs.forEach(m => { const c = m.cuenta || "—"; byAcc[c] = (byAcc[c] || 0) + (+m.monto || 0); });
  const accs = Object.entries(byAcc).sort((a, b) => b[1] - a[1]);
  const days = new Date(y, mo, 0).getDate();
  const daily = Array(days).fill(0); outs.forEach(m => { const d = +m.fecha.slice(8, 10); if (d >= 1 && d <= days) daily[d - 1] += +m.monto || 0; });
  const dMax = Math.max(...daily, 1), W = 300, H = 70, bw = W / days;
  const bars = daily.map((v, i) => {
    const h = v ? Math.max(2, v / dMax * (H - 6)) : 0;
    const top = v === dMax && v > 0;
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${top ? "var(--accent)" : "var(--ink)"}" opacity="${top ? 1 : .75}"/>`;
  }).join("");
  const inv = tIn * S.cfg.inversion.pct;
  return `
  <section class="hero">
    <div class="label">Neto de ${esc(MESES[mo - 1])}</div>
    <div class="big ${neto < 0 ? "neg" : ""}">${neto < 0 ? "−" : ""}${fmt.format(Math.abs(neto))}</div>
    <div class="split">
      <div class="pill in"><span class="label">Ingresos</span><span class="v num">${fmt.format(tIn)}</span></div>
      <div class="pill out"><span class="label">Egresos</span><span class="v num">${fmt.format(tOut)}</span></div>
    </div>
  </section>
  ${cats.length ? `<section class="card"><h3>En qué se fue</h3><div class="bars">${cats.map(([c, v]) => `
    <div class="bar"><span class="n">${esc(c)}</span><span class="a num">${fmt.format(v)}<span class="pct">${Math.round(v / tOut * 100)}%</span></span>
    <div class="track"><div class="fill" style="width:${(v / maxC * 100).toFixed(1)}%"></div></div></div>`).join("")}</div></section>` : ""}
  ${outs.length ? `<section class="card daily"><h3>Gasto por día</h3>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Gasto diario del mes">${bars}</svg>
    <div class="axis num"><span>1</span><span>${Math.ceil(days / 2)}</span><span>${days}</span></div>
    <p class="note" style="margin-top:8px">Día más caro: ${daily.indexOf(dMax) + 1} de ${esc(MESES[mo - 1])}, ${fmt.format(dMax)}</p></section>` : ""}
  ${accs.length ? `<section class="card"><h3>Por cuenta</h3><div class="bars">${accs.map(([c, v]) => `
    <div class="bar"><span class="n">${esc(c)}</span><span class="a num">${fmt.format(v)}</span></div>`).join("")}</div></section>` : ""}
  ${tIn > 0 ? `<section class="card"><h3>Para invertir este mes</h3>
    <p class="note">${Math.round(S.cfg.inversion.pct * 100)}% de tus ingresos: <b class="num" style="color:var(--ink)">${fmt.format(inv)}</b></p>
    <div class="invest">${S.cfg.inversion.reparto.map(([n, p]) => `<div><b>${esc(n)}</b><span class="num">${fmt.format(inv * p)}</span></div>`).join("")}</div></section>` : ""}`;
}

function viewMovs() {
  const ms = inMonth(S.ym);
  if (!ms.length) return emptyState();
  const cats = ["Todos", "Ingresos", ...new Set(ms.filter(m => !isIn(m)).map(m => m.cat || "Otros"))];
  if (!cats.includes(S.filter)) S.filter = "Todos";
  const list = ms.filter(m => S.filter === "Todos" || (S.filter === "Ingresos" ? isIn(m) : (!isIn(m) && (m.cat || "Otros") === S.filter)))
    .sort((a, b) => (b.fecha + (b.creado || "")).localeCompare(a.fecha + (a.creado || "")));
  const groups = {}; list.forEach(m => (groups[m.fecha] ||= []).push(m));
  return `<div class="filters" role="group" aria-label="Filtrar">${cats.map(c => `<button class="chip" data-filter="${esc(c)}" aria-pressed="${c === S.filter}">${esc(c)}</button>`).join("")}</div>
  ${Object.entries(groups).map(([f, arr]) => {
    const o = sum(arr.filter(m => !isIn(m)));
    return `<div class="day"><div class="dayhead"><b>${esc(dayName(f))}</b><span class="num">${o ? "−" + fmt.format(o) : ""}</span></div>
    ${arr.map(m => `<button class="row" data-edit="${esc(m.id)}">
      <span class="dot ${isIn(m) ? "in" : ""}">${esc(isIn(m) ? "+" : (m.cat || "O")[0])}</span>
      <span class="d"><strong>${esc(m.desc || "—")}</strong><small>${esc(isIn(m) ? "Ingreso" : (m.cat || "Otros"))} · ${esc(m.cuenta || "")}${m.exportado ? "" : '<span class="flag" title="Falta pasar a la hoja"></span>'}</small></span>
      <span class="m num ${isIn(m) ? "in" : ""}">${isIn(m) ? "+" : "−"}${fmt.format(+m.monto || 0)}</span></button>`).join("")}</div>`;
  }).join("")}`;
}

function exportRows() {
  const base = S.expScope === "pend" ? S.movs.filter(m => !m.exportado) : inMonth(S.ym);
  return base.slice().sort((a, b) => (a.fecha + (a.creado || "")).localeCompare(b.fecha + (b.creado || "")));
}

function viewHoja() {
  const rows = exportRows(), pend = rows.filter(m => !m.exportado).length;
  const conectado = !!(S.cfg.sync.url && S.cfg.sync.clave);
  return `<section class="card exp">
    <h3>Pasar a Finanzas 2026</h3>
    <p class="note">Mismas columnas que tu hoja: Mes · Fecha · Descripción · Categoría · Cantidad · Tipo · Salió de.</p>
    <div class="filters" style="margin:12px 0 10px" role="group" aria-label="Qué pasar">
      <button class="chip" data-scope="pend" aria-pressed="${S.expScope === "pend"}">Pendientes</button>
      <button class="chip" data-scope="mes" aria-pressed="${S.expScope === "mes"}">Todo ${esc(monthLabel(S.ym))}</button>
    </div>
    ${rows.length ? `
      ${conectado ? `<button class="btn acc" id="sendBtn" style="width:100%;margin-bottom:10px" ${pend && !S.sending ? "" : "disabled"}>${S.sending ? "Enviando…" : pend ? `Enviar ${pend} a la hoja` : "Nada pendiente de enviar"}</button>` : ""}
      <textarea id="tsv" readonly aria-label="Filas para pegar">${esc(toTSV(rows))}</textarea>
      <div class="btns" style="margin-top:10px">
        <button class="btn ${conectado ? "ghost" : "acc"}" id="copyBtn">Copiar ${rows.length} fila${rows.length > 1 ? "s" : ""}</button>
        <button class="btn ghost" id="markBtn" ${pend ? "" : "disabled"}>Marcar ${pend || ""} como pasados</button>
      </div>` :
      `<p class="note" style="padding:14px 0">${S.expScope === "pend" ? "Todo está pasado a tu hoja." : "No hay movimientos este mes."}</p>`}
  </section>

  <section class="card"><h3>Conexión con Google Sheet</h3>
    <form class="stack" id="syncForm">
      <p class="note">${conectado ? '<span class="ok">Conectada.</span> “Enviar a la hoja” agrega las filas directo a Finanzas 2026.' : "Pega aquí la URL y la clave de tu Apps Script (las instrucciones están en el README del repo). Sin conexión puedes seguir copiando y pegando."}</p>
      <div class="field"><span class="label">URL del Apps Script</span><input id="syncUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(S.cfg.sync.url)}"></div>
      <div class="field"><span class="label">Clave</span><input id="syncClave" type="password" autocomplete="off" value="${esc(S.cfg.sync.clave)}"></div>
      <div class="btns"><button class="btn ghost small" type="button" id="testBtn">Probar conexión</button><button class="btn small" type="submit">Guardar</button></div>
    </form>
  </section>

  ${cfgCard("Cuentas", "cuentas")}
  ${cfgCard("Categorías de gasto", "categorias")}

  <section class="card"><h3>Respaldo</h3>
    <p class="note">Tus movimientos viven en este iPhone. Descarga un respaldo de vez en cuando o mantén la conexión con tu hoja.</p>
    <div class="btns" style="margin-top:10px">
      <button class="btn ghost small" id="backupBtn">Descargar respaldo</button>
      <label class="btn ghost small" for="restoreFile" style="text-align:center">Restaurar respaldo</label>
      <input type="file" id="restoreFile" accept="application/json,.json">
    </div>
    <p class="note" style="margin-top:8px">${S.movs.length} movimientos guardados.</p>
  </section>`;
}

function cfgCard(title, key) {
  return `<section class="card"><h3>${title}</h3>
  <div class="tags">${S.cfg[key].map((c, i) => `<span class="tag">${esc(c)}<button aria-label="Quitar ${esc(c)}" data-rm="${key}:${i}">×</button></span>`).join("")}</div>
  <form class="addrow" data-add="${key}"><input id="add-${key}" placeholder="Agregar…" autocomplete="off"><button class="btn ghost small">Agregar</button></form></section>`;
}

/* ---------- Render ---------- */
const TITLES = { mes: "Resumen del mes", movs: "Movimientos", hoja: "Pasar a la hoja" };
function render() {
  $("#monthLbl").textContent = monthLabel(S.ym);
  $("#tabTitle").textContent = TITLES[S.tab];
  document.querySelectorAll("nav.tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  const pend = S.movs.filter(m => !m.exportado).length;
  const b = $("#pendBadge"); b.hidden = !pend; b.textContent = pend;
  $("#main").innerHTML = S.tab === "mes" ? viewMes() : S.tab === "movs" ? viewMovs() : viewHoja();
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
  const d = draft, isI = d.tipo === "Ingresos";
  $("#sheetHost").innerHTML = `<div class="scrim" id="scrim"><form class="sheet" id="mform" role="dialog" aria-label="${d.id ? "Editar" : "Nuevo"} movimiento">
    <div class="grab"></div>
    <h2>${d.id ? "Editar movimiento" : "Nuevo movimiento"}</h2>
    ${d.id ? "" : `<div class="quick"><input id="quick" placeholder="comida 145   ·   +11652 nómina" autocomplete="off" enterkeyhint="done">
      <small>Escribe como en WhatsApp y se llena solo. Con “+” es ingreso.</small></div>`}
    <div class="seg" role="group" aria-label="Tipo">
      <button type="button" class="o" data-tipo="Egreso" aria-pressed="${!isI}">Egreso</button>
      <button type="button" class="i" data-tipo="Ingresos" aria-pressed="${isI}">Ingreso</button>
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
      if (d.tipo === "Ingresos") d.cat = "Ingreso"; else if (d.cat === "Ingreso") d.cat = guessCat(d.desc) || "";
      drawSheet(false);
    }
    if (t.dataset.cat) { d.cat = t.dataset.cat; d._catTouched = true; markCats(); }
    if (t.id === "cancelBtn") closeSheet();
    if (t.id === "delBtn") {
      if (!d._confirmDel) { d._confirmDel = true; t.textContent = "Toca otra vez para borrar"; }
      else { delMov(d.id); closeSheet(); render(); toast("Movimiento borrado"); }
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
  const rec = { fecha: d.fecha || today(), desc: (d.desc || "").trim(), cat: d.tipo === "Ingresos" ? "Ingreso" : (d.cat || "Otros"), monto, tipo: d.tipo, cuenta: d.cuenta };
  const editing = !!d.id;
  if (editing) updMov(d.id, { ...rec, exportado: d.exportado });
  else addMov({ ...rec, exportado: false, creado: new Date().toISOString() });
  closeSheet();
  S.ym = rec.fecha.slice(0, 7);
  render();
  toast(editing ? (d.exportado ? "Guardado. Si ya estaba en tu hoja, corrígelo también ahí." : "Cambios guardados")
                : (rec.tipo === "Ingresos" ? "Ingreso" : "Egreso") + " de " + fmt.format(monto) + " registrado");
}
let tT;
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(tT); tT = setTimeout(() => el.hidden = true, 2800); }

/* ---------- Envío a Google Sheet ---------- */
async function callScript(payload) {
  // text/plain evita la verificación CORS previa que Apps Script no responde
  const res = await fetch(S.cfg.sync.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ clave: S.cfg.sync.clave, ...payload }) });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "La hoja rechazó el envío");
  return j;
}
async function sendPending() {
  const pend = exportRows().filter(m => !m.exportado);
  if (!pend.length) return;
  S.sending = true; render();
  try {
    const j = await callScript({ accion: "agregar", filas: pend.map(toRow) });
    const ok = new Set(j.ids || pend.map(m => m.id));
    pend.forEach(m => { if (ok.has(m.id)) m.exportado = true; });
    persist();
    toast(`${j.agregadas ?? ok.size} fila${(j.agregadas ?? ok.size) === 1 ? "" : "s"} en tu hoja` + (j.repetidas ? ` · ${j.repetidas} ya estaban` : ""));
  } catch (e) {
    toast(navigator.onLine === false ? "Sin internet. Se quedan pendientes y las mandas después." : "No se pudo enviar: " + e.message);
  } finally { S.sending = false; render(); }
}

/* ---------- Respaldo ---------- */
function backup() {
  const blob = new Blob([JSON.stringify({ app: "finanzas-bolsillo", version: 1, fecha: new Date().toISOString(), movs: S.movs, cfg: { ...S.cfg, sync: { url: "", clave: "" } } }, null, 1)], { type: "application/json" });
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
      persist(); render(); toast(nuevos.length + " movimientos restaurados");
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
  if (t.dataset.filter) { S.filter = t.dataset.filter; render(); }
  if (t.dataset.edit) { const m = S.movs.find(x => x.id === t.dataset.edit); if (m) openSheet(m); }
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
  if (t.id === "markBtn") {
    exportRows().forEach(m => { m.exportado = true; }); persist(); render(); toast("Marcados como pasados");
  }
  if (t.id === "sendBtn") sendPending();
  if (t.id === "testBtn") {
    const url = $("#syncUrl").value.trim(), clave = $("#syncClave").value;
    if (!url) { toast("Pega primero la URL del Apps Script"); return; }
    const prev = S.cfg.sync; S.cfg.sync = { url, clave };
    t.textContent = "Probando…";
    try { const j = await callScript({ accion: "ping" }); toast("Conectada a la hoja “" + (j.hoja || "") + "”"); }
    catch (err) { toast("No conectó: " + err.message); S.cfg.sync = prev; }
    t.textContent = "Probar conexión";
  }
  if (t.id === "backupBtn") backup();
});
$("#main").addEventListener("change", e => { if (e.target.id === "restoreFile" && e.target.files[0]) restore(e.target.files[0]); });
$("#main").addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id === "syncForm") {
    S.cfg.sync = { url: $("#syncUrl").value.trim(), clave: $("#syncClave").value };
    persist(); render(); toast(S.cfg.sync.url ? "Conexión guardada" : "Conexión quitada");
    return;
  }
  const f = e.target.closest("[data-add]"); if (!f) return;
  const k = f.dataset.add, inp = f.querySelector("input"), v = inp.value.trim();
  if (v && !S.cfg[k].includes(v)) { S.cfg[k] = [...S.cfg[k], v]; persist(); render(); toast("Agregado: " + v); }
  else inp.value = "";
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && draft) closeSheet(); });

// Atajo: abrir directo la captura con ?nuevo (útil desde un Atajo de iOS)
load();
render();
if (new URLSearchParams(location.search).has("nuevo")) openSheet(null);

// Exponer funciones puras para pruebas en Node
if (typeof module !== "undefined") module.exports = { parseQuick, toRow, toTSV };
})();
