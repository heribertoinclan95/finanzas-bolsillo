/**
 * Puente entre la app Finanzas de Bolsillo y tu Google Sheet "Finanzas 2026".
 * Se pega en Extensiones → Apps Script de esa hoja y se publica como app web
 * (Ejecutar como: Yo · Acceso: Cualquier usuario).
 *
 * Acciones:
 *   ping     → confirma conexión
 *   agregar  → agrega filas de la app a la pestaña HOJA (columnas A–G), sin duplicar
 *   leer     → devuelve todos los movimientos de HOJA + HISTORICO para los dashboards
 *
 * Columnas: A Mes · B Fecha · C Descripción · D Categoría · E Cantidad · F Tipo · G Salió de
 */

const HOJA = 'Movimientos';      // pestaña donde la app agrega movimientos
const HISTORICO = 'Historico';   // pestaña con 2022–2025 (opcional)
const CLAVE = 'CAMBIA-ESTA-CLAVE'; // la misma que pones en la app

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.clave !== CLAVE) return out({ ok: false, error: 'Clave incorrecta' });

    const ss = SpreadsheetApp.getActive();
    const hoja = ss.getSheetByName(HOJA);
    if (!hoja) return out({ ok: false, error: 'No existe la pestaña "' + HOJA + '"' });

    if (body.accion === 'ping') return out({ ok: true, hoja: HOJA, historico: !!ss.getSheetByName(HISTORICO) });
    if (body.accion === 'leer') return out(leer_(ss));
    if (body.accion !== 'agregar') return out({ ok: false, error: 'Acción desconocida' });

    const lock = LockService.getDocumentLock();
    lock.waitLock(20000);
    try {
      const reg = registro_(ss);
      const vistos = new Set(reg.getLastRow() ? reg.getRange(1, 1, reg.getLastRow(), 1).getValues().flat() : []);
      const filas = (body.filas || []).filter(f => f && f.id);
      const nuevas = filas.filter(f => !vistos.has(f.id));
      if (nuevas.length) {
        const valores = nuevas.map(f => {
          const p = String(f.fecha).split('-').map(Number);           // yyyy-mm-dd
          return [Number(f.mes), new Date(p[0], p[1] - 1, p[2]), String(f.descripcion || ''),
                  String(f.categoria || ''), Number(f.cantidad) || 0, String(f.tipo || ''), String(f.cuenta || '')];
        });
        const inicio = ultimaFilaConDatos_(hoja) + 1;
        hoja.getRange(inicio, 1, valores.length, 7).setValues(valores);
        hoja.getRange(inicio, 2, valores.length, 1).setNumberFormat('dd/mm/yy');
        hoja.getRange(inicio, 5, valores.length, 1).setNumberFormat('$#,##0.00');
        reg.getRange(reg.getLastRow() + 1, 1, nuevas.length, 2).setValues(nuevas.map(f => [f.id, new Date()]));
      }
      return out({ ok: true, agregadas: nuevas.length, repetidas: filas.length - nuevas.length, ids: filas.map(f => f.id) });
    } finally { lock.releaseLock(); }
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

/** Filas compactas: [fecha yyyy-mm-dd, descripción, categoría, cantidad, tipo, cuenta] */
function leer_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const filas = [];
  let malas = 0;
  [HISTORICO, HOJA].forEach(nombre => {
    const h = ss.getSheetByName(nombre);
    if (!h) return;
    const n = ultimaFilaConDatos_(h);
    if (n < 2) return;
    h.getRange(2, 1, n - 1, 7).getValues().forEach(r => {
      const f = fecha_(r[1], tz);
      const q = Number(String(r[4]).replace(/[$,\s]/g, ''));
      if (!f || !isFinite(q) || q === 0) { if (String(r[2]).trim()) malas++; return; }
      filas.push([f, String(r[2] || '').trim(), String(r[3] || '').trim(), Math.round(q * 100) / 100, String(r[5] || '').trim(), String(r[6] || '').trim()]);
    });
  });
  return { ok: true, filas: filas, malas: malas, leido: new Date().toISOString() };
}

function fecha_(v, tz) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);            // dd/mm/aa
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return y + '-' + pad_(m[2]) + '-' + pad_(m[1]); }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return null;
}
function pad_(n) { return String(n).padStart(2, '0'); }

/** Última fila con algo escrito en la columna C (Descripción), ignorando validaciones vacías. */
function ultimaFilaConDatos_(hoja) {
  const n = hoja.getLastRow();
  if (!n) return 0;
  const col = hoja.getRange(1, 3, n, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) if (String(col[i][0]).trim() !== '') return i + 1;
  return 0;
}

function registro_(ss) {
  let r = ss.getSheetByName('_app_ids');
  if (!r) { r = ss.insertSheet('_app_ids'); r.hideSheet(); }
  return r;
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
