/**
 * Puente entre la app Finanzas de Bolsillo y tu Google Sheet "Finanzas 2026".
 * Se pega en Extensiones → Apps Script de esa hoja y se publica como app web.
 *
 * Escribe en la pestaña HOJA, columnas A–G:
 *   A Mes (número) · B Fecha · C Descripción · D Categoría · E Cantidad · F Tipo · G Salió de
 * Lleva una pestaña oculta "_app_ids" con los movimientos ya recibidos para no duplicar.
 */

const HOJA = '2026';            // nombre de la pestaña de gastos
const CLAVE = 'CAMBIA-ESTA-CLAVE'; // invéntala y pégala igual en la app

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.clave !== CLAVE) return out({ ok: false, error: 'Clave incorrecta' });

    const ss = SpreadsheetApp.getActive();
    const hoja = ss.getSheetByName(HOJA);
    if (!hoja) return out({ ok: false, error: 'No existe la pestaña "' + HOJA + '"' });

    if (body.accion === 'ping') return out({ ok: true, hoja: HOJA });
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
        const rango = hoja.getRange(inicio, 1, valores.length, 7);
        rango.setValues(valores);
        hoja.getRange(inicio, 2, valores.length, 1).setNumberFormat('dd/mm/yy');
        hoja.getRange(inicio, 5, valores.length, 1).setNumberFormat('$#,##0.00');
        reg.getRange(reg.getLastRow() + 1, 1, nuevas.length, 2)
           .setValues(nuevas.map(f => [f.id, new Date()]));
      }
      return out({ ok: true, agregadas: nuevas.length, repetidas: filas.length - nuevas.length, ids: filas.map(f => f.id) });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

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
