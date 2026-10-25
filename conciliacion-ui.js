/* Finanzas de Bolsillo — Más › Conciliar: vistas y eventos de la conciliación bancaria.
   Usa el motor de conciliacion.js. app.js le entrega sus utilidades en init(ctx) y le delega los elementos
   con data-cz (click, change, submit). El archivo cargado vive solo en memoria; se guardan únicamente decisiones. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ConciliacionUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
"use strict";
const CZ = root.Conciliacion || (typeof require === "function" ? require("./conciliacion.js") : null);
let X = null, E = null;   // X: utilidades de app.js · E: estado guardado (decisiones)
const U = { etapa: "cargar", cuenta: "", archivo: null, filtro: "faltantes", sel: {}, abierto: null, msg: "", confLimpiar: false };
const GRUPOS = [["faltantes", "Faltantes"], ["revisar", "Por revisar"], ["registrados", "Registrados"], ["soloApp", "Solo en la app"], ["traspasos", "Traspasos"], ["ignorados", "Ignorados"]];
const TOLS = [1, 2, 3, 5, 7, 10];
const letra = i => { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const limpiarDesc = s => String(s || "").replace(/\*/g, " ").replace(/\b\d{4,}\b/g, " ").replace(/\s+/g, " ").trim();
const storage = () => root.localStorage;

function init(ctx) { X = ctx; E = CZ.cargarEstado(storage()); U.cuenta = E.cuenta || ""; }
/* La cuenta elegida siempre es una de Ajustes; si no hay, la primera. Se resuelve antes de normalizar para que las huellas no cambien. */
function cuentaActual() { if (!U.cuenta || !X.S.cfg.cuentas.includes(U.cuenta)) U.cuenta = X.S.cfg.cuentas[0] || ""; return U.cuenta; }
function guardar() { if (!CZ.guardarEstado(storage(), E)) X.toast("No se pudo guardar la decisión en el teléfono"); }
function decidir(h, d, sinGuardar) {
  E.decisiones[h] = { ...d, f: new Date().toISOString() };
  delete U.sel[h]; if (U.abierto === h) U.abierto = null;
  if (!sinGuardar) guardar();
}
const catSug = b => b.tipo === "Ingreso" ? "Ingreso" : (X.guessCat(b.desc) || "");
function huellaDeRef(id) { const a = CZ.prepararApp(X.filas()).find(x => x.ref === id); return a ? a.huella : undefined; }
function resultado() {
  const A = U.archivo; if (!A) return null;
  return CZ.conciliar({ banco: A.movs, app: CZ.prepararApp(X.filas()), cuenta: cuentaActual(), cuentas: X.S.cfg.cuentas, tol: E.tol, decisiones: E.decisiones });
}
const movBanco = h => U.archivo && U.archivo.movs.find(m => m.huella === h);

/* ---------- Archivo ---------- */
function cargarArchivo(f) {
  U.msg = ""; cuentaActual();
  Promise.resolve(f.arrayBuffer()).then(buf => CZ.leerArchivo(f.name, buf)).then(({ hojas, hoja }) => {
    U.archivo = { nombre: f.name, hojas, hoja: 0, filas: [], mapeo: null, encabezado: null, movs: [], errores: [], omitidas: 0, hash: "", repetido: null };
    elegirHoja(hoja);
    if (CZ.sugerirInvertir(U.archivo.mapeo, U.archivo.movs, U.cuenta)) { U.archivo.mapeo.invertir = true; renormalizar(); }
    U.etapa = "validar"; U.sel = {}; U.abierto = null; X.render();
  }).catch(e => { U.msg = "No se pudo leer el archivo: " + ((e && e.message) || e); U.archivo = null; U.etapa = "cargar"; X.render(); });
}
function elegirHoja(i) {
  const A = U.archivo; A.hoja = i; A.filas = A.hojas[i].filas;
  const det = CZ.detectarColumnas(A.filas); A.mapeo = det.mapeo; A.encabezado = det.encabezado;
  renormalizar();
}
function renormalizar() {
  const A = U.archivo, r = CZ.normalizar(A.filas, A.mapeo, { cuenta: cuentaActual() });
  A.movs = r.movs; A.errores = r.errores; A.omitidas = r.omitidas;
  A.hash = CZ.hashArchivo(A.movs); A.repetido = E.archivos[A.hash] || null;
}

/* ---------- Vistas ---------- */
function view() {
  if (!X) return "";
  cuentaActual();
  if (!U.archivo && U.etapa !== "cargar") U.etapa = "cargar";
  return { cargar: vCargar, validar: vValidar, mapear: vMapear, resultados: vResultados }[U.etapa]();
}
const selCuenta = () => `<label class="field"><span class="label">Cuenta</span><select data-cz="cuenta">${X.S.cfg.cuentas.map(c => `<option ${c === U.cuenta ? "selected" : ""}>${X.esc(c)}</option>`).join("")}</select></label>`;
function vCargar() {
  const nd = Object.keys(E.decisiones).length, na = Object.keys(E.archivos).length;
  return `<section class="card"><h3>Conciliar estado de cuenta</h3>
    <p class="note">Carga el CSV o Excel de tu banco y la app te dice qué te falta registrar. El archivo no se guarda en el teléfono: solo tus decisiones.</p>
    <div class="two" style="margin-top:12px">${selCuenta()}
      <label class="field"><span class="label">Tolerancia de fecha</span><select data-cz="tol">${TOLS.map(d => `<option value="${d}" ${d === E.tol ? "selected" : ""}>${d} día${d > 1 ? "s" : ""}</option>`).join("")}</select></label>
    </div>
    <label class="btn acc cz-cargar" for="czFile">Cargar estado de cuenta</label>
    <input type="file" id="czFile" data-cz="file" accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
    <p class="note">Sirve el CSV o el .xlsx que descargas de tu banco. Si las columnas no se reconocen, podrás asignarlas a mano.</p>
    ${U.msg ? `<p class="note warn" style="margin-top:8px">${X.esc(U.msg)}</p>` : ""}
  </section>
  <section class="card"><h3>Decisiones guardadas</h3>
    <p class="note">${nd ? `${nd} decisión${nd > 1 ? "es" : ""} (vinculados, ignorados) de ${na} archivo${na !== 1 ? "s" : ""}. Sirven para reconocer lo ya conciliado si vuelves a cargar un estado de cuenta. No guardan importes ni descripciones.` : "Aún no has conciliado ningún archivo."}</p>
    ${nd || na ? `<button class="btn ghost small" data-cz="limpiar" style="margin-top:10px">${U.confLimpiar ? "Toca otra vez para borrar" : "Limpiar decisiones"}</button>` : ""}
  </section>`;
}
function vValidar() {
  const A = U.archivo, m = A.movs, mp = A.mapeo;
  const eg = m.filter(x => x.tipo === "Egreso"), ab = m.filter(x => x.tipo === "Ingreso"), suma = l => l.reduce((s, x) => s + x.monto, 0);
  const fechas = m.map(x => x.fecha).sort();
  const nombreCol = i => i == null ? "—" : (A.encabezado && String(A.encabezado[i] || "").trim()) || "columna " + letra(i);
  const cols = [["Fecha", mp.fecha], ["Descripción", mp.desc], mp.cargo != null ? ["Cargo", mp.cargo] : null, mp.abono != null ? ["Abono", mp.abono] : null,
    mp.monto != null ? ["Importe", mp.monto] : null, mp.tipoCol != null ? ["Tipo", mp.tipoCol] : null, mp.id != null ? ["Referencia", mp.id] : null].filter(Boolean);
  return `<section class="card">
    <div class="rowhead"><h3>Revisa cómo se leyó</h3><button type="button" class="link" data-cz="cancelar">Otro archivo</button></div>
    <p class="note"><b>${X.esc(A.nombre)}</b>${A.hojas.length > 1 ? ` · hoja “${X.esc(A.hojas[A.hoja].nombre)}”` : ""} · ${m.length} movimiento${m.length === 1 ? "" : "s"}${fechas.length ? ` del ${X.ddmmaa(fechas[0])} al ${X.ddmmaa(fechas[fechas.length - 1])}` : ""}</p>
    ${A.repetido ? `<p class="note warn">Este archivo ya lo conciliaste el ${X.fechaHora(A.repetido.f)}. Se aplican tus decisiones de entonces.</p>` : ""}
    <div style="margin-top:10px">${selCuenta()}</div>
    <div class="kpis" style="margin-top:10px">
      <div class="pill out"><span class="label">Cargos</span><span class="v num">${X.fmt.format(suma(eg))}</span><small class="sub">${eg.length} movimiento${eg.length === 1 ? "" : "s"}</small></div>
      <div class="pill in"><span class="label">Abonos</span><span class="v num">${X.fmt.format(suma(ab))}</span><small class="sub">${ab.length} movimiento${ab.length === 1 ? "" : "s"}</small></div>
    </div>
    <p class="note" style="margin-top:10px">${cols.map(([r, i]) => `${r} ← <b>${X.esc(nombreCol(i))}</b>`).join(" · ")}</p>
    ${m.length ? `<div class="tbl"><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Importe</th></tr></thead><tbody>${m.slice(0, 4).map(x => `<tr><td>${X.ddmmaa(x.fecha)}</td><td class="cz-desc">${X.esc(x.desc || "—")}</td><td class="${x.tipo === "Ingreso" ? "pos" : ""}">${x.tipo === "Ingreso" ? "+" : "−"}${X.fmtC.format(x.monto)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="note warn" style="margin-top:8px">No se encontraron movimientos con fecha e importe. Ajusta las columnas.</p>`}
    ${A.errores.length ? `<p class="note" style="margin-top:8px">${A.errores.length} fila${A.errores.length > 1 ? "s" : ""} sin fecha o importe válido se omitieron.</p>` : ""}
    <div class="btns" style="margin-top:12px">
      <button class="btn ghost small" data-cz="mapear">Ajustar columnas</button>
      <button class="btn ghost small" data-cz="invertir" aria-pressed="${!!mp.invertir}">${mp.invertir ? "Signo invertido ✓" : "Invertir signo"}</button>
    </div>
    <p class="note" style="margin-top:8px">Si los cargos aparecen como abonos (pasa con algunas tarjetas), toca “Invertir signo”.</p>
    <button class="btn acc" data-cz="conciliar" style="width:100%;margin-top:12px" ${m.length ? "" : "disabled"}>Conciliar ${m.length} movimiento${m.length === 1 ? "" : "s"}</button>
  </section>`;
}
function vMapear() {
  const A = U.archivo, filas = A.filas, mp = A.mapeo;
  const ncol = Math.max(0, ...filas.slice(0, 60).map(r => r.length));
  const ejemplo = i => { const r = filas[mp.inicio] || filas[0] || []; return String(r[i] ?? "").slice(0, 16); };
  const opts = sel => `<option value="">— ninguna —</option>` + Array.from({ length: ncol }, (_, i) =>
    `<option value="${i}" ${sel === i ? "selected" : ""}>${letra(i)}${A.encabezado && A.encabezado[i] ? " · " + X.esc(String(A.encabezado[i]).slice(0, 16)) : ""}${ejemplo(i) ? " (" + X.esc(ejemplo(i)) + ")" : ""}</option>`).join("");
  const campo = (k, n) => `<label class="field"><span class="label">${n}</span><select name="${k}">${opts(mp[k])}</select></label>`;
  return `<section class="card"><div class="rowhead"><h3>Asignar columnas</h3><button type="button" class="link" data-cz="validar">Volver</button></div>
    <form class="stack" data-cz="mapeo">
      ${A.hojas.length > 1 ? `<label class="field"><span class="label">Hoja</span><select name="hoja">${A.hojas.map((h, i) => `<option value="${i}" ${i === A.hoja ? "selected" : ""}>${X.esc(h.nombre)} (${h.filas.length} filas)</option>`).join("")}</select></label>` : ""}
      ${campo("fecha", "Fecha")}${campo("desc", "Descripción")}
      <p class="note">Si cargos y abonos vienen en columnas separadas, asígnalas. Si hay una sola columna de importe (negativo = cargo), usa Importe.</p>
      <div class="two">${campo("cargo", "Cargo")}${campo("abono", "Abono")}</div>
      <div class="two">${campo("monto", "Importe (una columna)")}${campo("tipoCol", "Tipo (cargo / abono)")}</div>
      <div class="two">${campo("id", "Referencia o ID")}
        <label class="field"><span class="label">Formato de fecha</span><select name="formatoFecha">${[["auto", "Automático"], ["dmy", "día/mes/año"], ["mdy", "mes/día/año"], ["ymd", "año-mes-día"]].map(([v, n]) => `<option value="${v}" ${(mp.formatoFecha || "auto") === v ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>
      <label class="field"><span class="label">Primera fila con movimientos</span><input name="inicio" inputmode="numeric" value="${(mp.inicio || 0) + 1}"></label>
      <button class="btn small" type="submit">Aplicar</button>
    </form></section>`;
}
function filaBanco(b, extra) {
  const i = b.tipo === "Ingreso";
  return `<span class="d"><strong>${X.esc(b.desc || "—")}</strong><small>${X.ddmmaa(b.fecha)}${extra ? " · " + extra : ""}</small></span><span class="m${i ? " in" : ""}">${i ? "+" : "−"}${X.fmtC.format(b.monto)}</span>`;
}
function motivos(c) {
  const t = [];
  if (c.dias) t.push(c.dias === 1 ? "1 día de diferencia" : c.dias + " días de diferencia");
  if (Math.abs(c.difMonto) >= 0.005) t.push("en la app " + X.fmtC.format(Math.abs(c.difMonto)) + (c.difMonto > 0 ? " más" : " menos"));
  if (c.otraCuenta) t.push("registrado en " + (c.a.cuenta || "otra cuenta"));
  if (!t.length && c.sim < 0.3) t.push("descripción distinta");
  return t.map(x => `<span class="cz-tag">${X.esc(x)}</span>`).join("");
}
const filaApp = a => `<span class="d"><strong>${X.esc(a.desc || "—")}</strong><small>${X.ddmmaa(a.fecha)} · ${X.esc(a.cat)} · ${X.esc(a.cuenta)}${a.pendiente ? " · sin enviar" : ""}</small></span>`;
const btnEs = (b, a, txt) => `<button class="btn small" data-cz="es" data-h="${b.huella}" data-a="${a.huella}" data-id="${a.local ? X.esc(a.ref) : ""}">${txt}</button>`;
function panelVincular(b, R) {
  const usadas = new Set(R.registrados.map(r => r.a.huella));
  const lista = CZ.cercanos(b, CZ.prepararApp(X.filas()), usadas, Math.max(E.tol, 10));
  return `<div class="cz-cand"><span class="label">Vincular con un movimiento ya registrado</span>
    ${lista.length ? lista.map(({ a }) => `<div class="cz-c">${filaApp(a)}<span class="num">${X.fmtC.format(a.monto)}</span>${btnEs(b, a, "Vincular")}</div>`).join("") : `<p class="note">No hay movimientos del mismo tipo cerca de esa fecha.</p>`}
  </div>`;
}
function itemFaltante({ b }, R) {
  const h = b.huella, sug = catSug(b);
  return `<div class="cz-item">
    <label class="cz-head sel"><input type="checkbox" data-cz="sel" data-h="${h}" ${U.sel[h] ? "checked" : ""} aria-label="Seleccionar">${filaBanco(b, sug ? "sugerido: " + X.esc(sug) : "")}</label>
    <div class="cz-acts"><button class="btn small acc" data-cz="registrar" data-h="${h}">Registrar</button><button class="btn small ghost" data-cz="vincular" data-h="${h}" aria-pressed="${U.abierto === h}">Vincular</button><button class="btn small ghost" data-cz="ignorar" data-h="${h}">Ignorar</button></div>
    ${U.abierto === h ? panelVincular(b, R) : ""}
  </div>`;
}
function itemRevisar({ b, candidatos }) {
  const h = b.huella;
  return `<div class="cz-item"><div class="cz-head">${filaBanco(b, "en el banco")}</div>
    <div class="cz-cand"><span class="label">¿Es alguno de estos?</span>
      ${candidatos.map(c => `<div class="cz-c"><span class="d"><strong>${X.esc(c.a.desc || "—")}</strong><small>${X.ddmmaa(c.a.fecha)} · ${X.esc(c.a.cat)}${c.a.pendiente ? " · sin enviar" : ""}</small><small>${motivos(c)}</small></span><span class="num">${X.fmtC.format(c.a.monto)}</span>${btnEs(b, c.a, "Es este")}</div>`).join("")}
    </div>
    <div class="cz-acts"><button class="btn small ghost" data-cz="registrar" data-h="${h}">No está, registrar</button><button class="btn small ghost" data-cz="ignorar" data-h="${h}">Ignorar</button></div>
  </div>`;
}
function itemRegistrado({ b, a, manual }) {
  return `<div class="cz-item"><div class="cz-head">${filaBanco(b, "")}</div>
    <p class="cz-link">↳ en la app: <b>${X.esc(a.desc || "—")}</b> · ${X.ddmmaa(a.fecha)} · ${X.esc(a.cat)}${a.pendiente ? " · sin enviar" : ""}${Math.abs(a.monto - b.monto) >= 0.005 ? " · " + X.fmtC.format(a.monto) : ""}${manual ? ` · <button type="button" class="link" data-cz="desvincular" data-h="${b.huella}">Desvincular</button>` : ""}</p>
  </div>`;
}
const itemSoloApp = a => `<button type="button" class="mrow" data-edit="${X.esc(a.ref)}">${filaApp(a)}<span class="num${a.tipo === "Ingreso" ? " pos" : ""}">${a.tipo === "Ingreso" ? "+" : "−"}${X.fmtC.format(a.monto)}</span></button>`;
function itemTraspaso({ b, regla, candidatos }) {
  return `<div class="cz-item"><div class="cz-head">${filaBanco(b, X.esc(CZ.REGLAS[regla] || "Traspaso"))}</div>
    ${candidatos.length ? `<p class="cz-link">Parecido en la app: <b>${X.esc(candidatos[0].a.desc || "—")}</b> · ${X.ddmmaa(candidatos[0].a.fecha)} · ${X.fmtC.format(candidatos[0].a.monto)}. Si es el mismo, revisa que no esté duplicado.</p>` : ""}
    <div class="cz-acts"><button class="btn small ghost" data-cz="normal" data-h="${b.huella}">${b.tipo === "Ingreso" ? "Sí es un ingreso" : "Sí es un gasto"}</button></div>
  </div>`;
}
const itemIgnorado = ({ b }) => `<div class="cz-item"><div class="cz-head">${filaBanco(b, "ignorado")}</div><div class="cz-acts"><button class="btn small ghost" data-cz="deshacer" data-h="${b.huella}">Deshacer</button></div></div>`;
function vResultados() {
  const A = U.archivo, R = resultado();
  const f = GRUPOS.some(g => g[0] === U.filtro && (R[g[0]].length || g[0] === "faltantes")) ? U.filtro : "faltantes";
  const faltH = new Set(R.faltantes.map(x => x.b.huella));
  Object.keys(U.sel).forEach(h => { if (!faltH.has(h)) delete U.sel[h]; });
  const sel = R.faltantes.filter(x => U.sel[x.b.huella]), selTot = sel.reduce((s, x) => s + x.b.monto * (x.b.tipo === "Ingreso" ? 1 : -1), 0);
  const rango = R.rango.desde ? ` del ${X.ddmmaa(R.rango.desde)} al ${X.ddmmaa(R.rango.hasta)}` : "";
  const falt = (R.faltanEgresos ? X.fmt.format(R.faltanEgresos) + " en cargos" : "") + (R.faltanIngresos ? (R.faltanEgresos ? " · " : "") + X.fmt.format(R.faltanIngresos) + " en abonos" : "");
  const lista = { faltantes: () => R.faltantes.map(x => itemFaltante(x, R)), revisar: () => R.revisar.map(itemRevisar), registrados: () => R.registrados.map(itemRegistrado),
    soloApp: () => R.soloApp.length ? [`<section class="card"><div class="mini">${R.soloApp.map(itemSoloApp).join("")}</div><p class="note" style="margin-top:8px">Registrados en ${X.esc(U.cuenta)} dentro del periodo del archivo, pero sin cargo en el banco. Pueden ser gastos de otra cuenta o algo que el banco aún no refleja.</p></section>`] : [],
    traspasos: () => R.traspasos.map(itemTraspaso), ignorados: () => R.ignorados.map(itemIgnorado) }[f]();
  const vacio = { faltantes: "Nada falta: todo lo del banco ya está en la app.", revisar: "Nada por revisar.", registrados: "Ninguno coincide todavía.", soloApp: "Todo lo registrado en esta cuenta aparece en el banco.", traspasos: "Sin pagos de tarjeta ni traspasos.", ignorados: "No has ignorado nada." }[f];
  return `<section class="card">
    <div class="rowhead"><h3>${X.esc(A.nombre)}</h3><button type="button" class="link" data-cz="cancelar">Otro archivo</button></div>
    <p class="note">${R.n} movimiento${R.n === 1 ? "" : "s"} de ${X.esc(U.cuenta)}${rango}. Tolerancia de ${E.tol} día${E.tol > 1 ? "s" : ""}.</p>
    <div class="kpis" style="margin-top:10px">
      <div class="pill"><span class="label">Registrados</span><span class="v num">${R.registrados.length}</span><small class="sub">ya están en la app</small></div>
      <div class="pill out"><span class="label">Faltantes</span><span class="v num">${R.faltantes.length}</span>${falt ? `<small class="sub">${falt}</small>` : ""}</div>
      <div class="pill"><span class="label">Por revisar</span><span class="v num">${R.revisar.length}</span><small class="sub">parecidos, tú decides</small></div>
      <div class="pill"><span class="label">Solo en la app</span><span class="v num">${R.soloApp.length}</span><small class="sub">sin cargo en el banco</small></div>
    </div>
    ${R.traspasos.length ? `<p class="note" style="margin-top:10px">${R.traspasos.length} pago${R.traspasos.length > 1 ? "s" : ""} de tarjeta, traspaso${R.traspasos.length > 1 ? "s" : ""} o retiro${R.traspasos.length > 1 ? "s" : ""} no cuentan como gasto ni ingreso.</p>` : ""}
  </section>
  <div class="filters" role="group" aria-label="Grupo">${GRUPOS.filter(([k]) => R[k].length || k === "faltantes").map(([k, n]) => `<button class="chip" data-cz="filtro" data-f="${k}" aria-pressed="${k === f}">${n} ${R[k].length}</button>`).join("")}</div>
  ${f === "faltantes" && R.faltantes.length ? (sel.length
    ? `<section class="card strip"><span><b>${sel.length}</b> seleccionado${sel.length > 1 ? "s" : ""} · ${(selTot < 0 ? "−" : "+") + X.fmt.format(Math.abs(selTot))}</span><span class="btns"><button class="btn small acc" data-cz="registrarSel">Registrar</button><button class="btn small ghost" data-cz="nadaSel">Quitar</button></span></section>`
    : `<p class="note">Marca varios para registrarlos juntos${R.faltantes.length > 1 ? ` · <button type="button" class="link" data-cz="todosSel">Seleccionar todos</button>` : ""}.</p>`) : ""}
  <div class="cz-list">${lista.length ? lista.join("") : `<p class="cz-vacio">${vacio}</p>`}</div>`;
}

/* ---------- Registrar (siempre con tu confirmación) ---------- */
function abrirCaptura(h) {
  const b = movBanco(h); if (!b) return;
  if (E.decisiones[h] && E.decisiones[h].t === "v") { X.toast("Este movimiento ya está vinculado"); return; }
  X.openSheet({ fecha: b.fecha, desc: limpiarDesc(b.desc), monto: String(b.monto), tipo: b.tipo, cat: catSug(b), cuenta: U.cuenta, _cz: h });
}
/* Gancho desde save() de app.js: el movimiento ya se guardó; aquí solo se anota el vínculo. */
function registrado(h, id, rec) {
  if (!U.archivo || !movBanco(h)) return;
  decidir(h, { t: "v", id, h: huellaDeRef(id) });
}
function seleccionados() { const R = resultado(); return R ? R.faltantes.filter(x => U.sel[x.b.huella]).map(x => x.b) : []; }
function cerrarHoja() { const host = root.document.querySelector("#sheetHost"); if (host) host.innerHTML = ""; }
function abrirVarios() {
  const items = seleccionados();
  if (!items.length) { X.toast("Marca al menos un movimiento"); return; }
  const host = root.document.querySelector("#sheetHost");
  host.innerHTML = `<div class="scrim" id="czScrim"><form class="sheet" data-cz="varios" role="dialog" aria-label="Registrar varios movimientos">
    <div class="grab"></div><h2>Registrar ${items.length} movimiento${items.length > 1 ? "s" : ""}</h2>
    <p class="note">Revisa descripción y categoría. Se guardan en el cel al confirmar; después los envías a la hoja como siempre.</p>
    <div class="cz-varios">${items.map(b => `<div class="cz-v" data-item="${b.huella}">
      <div class="cz-vh"><span class="num ${b.tipo === "Ingreso" ? "pos" : "neg"}">${b.tipo === "Ingreso" ? "+" : "−"}${X.fmtC.format(b.monto)}</span><small>${X.ddmmaa(b.fecha)} · ${X.esc(U.cuenta)}</small></div>
      <input name="desc" value="${X.esc(limpiarDesc(b.desc))}" aria-label="Descripción" autocomplete="off">
      ${b.tipo === "Ingreso" ? `<small class="note">Ingreso</small>` : `<select name="cat" aria-label="Categoría">${X.S.cfg.categorias.map(c => `<option ${c === (catSug(b) || "Otros") ? "selected" : ""}>${X.esc(c)}</option>`).join("")}</select>`}
    </div>`).join("")}</div>
    <div class="btns"><button type="button" class="btn ghost" data-cz="cerrar">Cancelar</button><button type="submit" class="btn acc">Registrar ${items.length}</button></div>
  </form></div>`;
  const form = host.querySelector("form");
  form.addEventListener("submit", e => { e.preventDefault(); const lista = leerVarios(form); cerrarHoja(); registrarVarios(lista); });
  form.addEventListener("click", e => { const t = e.target.closest("button"); if (t && t.dataset.cz === "cerrar") cerrarHoja(); });
  host.querySelector("#czScrim").addEventListener("click", e => { if (e.target.id === "czScrim") cerrarHoja(); });
}
function leerVarios(form) {
  return Array.from(form.querySelectorAll("[data-item]")).map(el => {
    const d = el.querySelector('[name="desc"]'), c = el.querySelector('[name="cat"]');
    return { h: el.dataset.item, desc: d ? d.value.trim() : "", cat: c ? c.value : "" };
  });
}
/* lista: [{ h, desc, cat }]. Crea cada movimiento una sola vez: si ya hay decisión para esa huella, lo salta. */
function registrarVarios(lista) {
  if (!U.archivo) return 0;
  let n = 0;
  lista.forEach(({ h, desc, cat }) => {
    if (E.decisiones[h]) return;
    const b = movBanco(h); if (!b) return;
    const rec = { fecha: b.fecha, desc: desc || limpiarDesc(b.desc), cat: b.tipo === "Ingreso" ? "Ingreso" : (cat || catSug(b) || "Otros"), monto: b.monto, tipo: b.tipo, cuenta: U.cuenta, exportado: false, creado: new Date().toISOString() };
    const id = X.addMov(rec);
    decidir(h, { t: "v", id, h: huellaDeRef(id) }, true);
    n++;
  });
  guardar(); X.render();
  X.toast(n ? `${n} movimiento${n > 1 ? "s" : ""} registrado${n > 1 ? "s" : ""}. Envíalos a la hoja desde Google Sheet.` : "Nada nuevo que registrar");
  return n;
}

/* ---------- Eventos delegados desde app.js ---------- */
function click(btn) {
  const k = btn.dataset.cz, h = btn.dataset.h;
  if (k === "limpiar") {
    if (!U.confLimpiar) { U.confLimpiar = true; btn.textContent = "Toca otra vez para borrar"; return true; }
    E = { ...CZ.nuevoEstado(), tol: E.tol, cuenta: U.cuenta }; guardar(); U.confLimpiar = false;
    X.toast("Decisiones de conciliación borradas"); X.render(); return true;
  }
  U.confLimpiar = false;
  if (k === "cancelar") { U.archivo = null; U.etapa = "cargar"; U.sel = {}; U.abierto = null; X.render(); return true; }
  if (!U.archivo) return false;
  if (k === "mapear") { U.etapa = "mapear"; X.render(); return true; }
  if (k === "validar") { U.etapa = "validar"; X.render(); return true; }
  if (k === "invertir") { U.archivo.mapeo.invertir = !U.archivo.mapeo.invertir; renormalizar(); X.render(); return true; }
  if (k === "conciliar") {
    if (!U.archivo.movs.length) return true;
    E.archivos[U.archivo.hash] = { cuenta: U.cuenta, n: U.archivo.movs.length, f: new Date().toISOString(), nombre: String(U.archivo.nombre || "").slice(0, 60) };
    E.cuenta = U.cuenta; guardar();
    U.etapa = "resultados"; U.filtro = "faltantes"; X.render(); if (root.scrollTo) root.scrollTo(0, 0); return true;
  }
  if (k === "filtro") { U.filtro = btn.dataset.f; U.abierto = null; X.render(); return true; }
  if (k === "registrar") { abrirCaptura(h); return true; }
  if (k === "vincular") { U.abierto = U.abierto === h ? null : h; X.render(); return true; }
  if (k === "es") { decidir(h, { t: "v", h: btn.dataset.a, id: btn.dataset.id || undefined }); X.toast("Vinculado"); X.render(); return true; }
  if (k === "ignorar") { decidir(h, { t: "i" }); X.render(); return true; }
  if (k === "normal") { decidir(h, { t: "g" }); X.render(); return true; }
  if (k === "deshacer" || k === "desvincular") { delete E.decisiones[h]; guardar(); X.render(); return true; }
  if (k === "todosSel") { resultado().faltantes.forEach(x => { U.sel[x.b.huella] = true; }); X.render(); return true; }
  if (k === "nadaSel") { U.sel = {}; X.render(); return true; }
  if (k === "registrarSel") { abrirVarios(); return true; }
  return false;
}
function change(el) {
  const k = el.dataset.cz;
  if (k === "cuenta") { U.cuenta = el.value; E.cuenta = el.value; guardar(); if (U.archivo) { renormalizar(); U.sel = {}; } X.render(); return true; }
  if (k === "tol") { E.tol = TOLS.includes(+el.value) ? +el.value : 3; guardar(); X.render(); return true; }
  if (k === "sel") { if (el.checked) U.sel[el.dataset.h] = true; else delete U.sel[el.dataset.h]; X.render(); return true; }
  if (k === "file") { const f = el.files && el.files[0]; if (f) cargarArchivo(f); el.value = ""; return true; }
  return false;
}
function submit(form) {
  if (form.dataset.cz !== "mapeo" || !U.archivo) return false;
  const A = U.archivo, val = n => { const el = form.querySelector(`[name="${n}"]`); return el ? el.value : ""; };
  const hoja = val("hoja");
  if (hoja !== "" && +hoja !== A.hoja) { elegirHoja(+hoja); X.render(); return true; }   // otra hoja: se vuelven a detectar las columnas
  const num = n => { const v = val(n); return v === "" ? null : +v; }, mp = A.mapeo;
  ["fecha", "desc", "cargo", "abono", "monto", "tipoCol", "id"].forEach(k => { mp[k] = num(k); });
  mp.formatoFecha = val("formatoFecha") || "auto";
  const ini = parseInt(val("inicio"), 10); mp.inicio = ini > 0 ? ini - 1 : 0;
  if (mp.fecha == null || (mp.monto == null && mp.cargo == null && mp.abono == null)) { X.toast("Elige la columna de fecha y la de importe (o cargo y abono)"); return true; }
  renormalizar(); U.etapa = "validar"; X.render(); return true;
}

return { init, view, click, change, submit, registrado, registrarVarios, resultado, cargarArchivo, estado: () => E, _U: U, limpiarDesc };
});
