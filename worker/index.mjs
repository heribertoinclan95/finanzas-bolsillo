/* Finanzas de Bolsillo — Worker de Cloudflare (sin dependencias).
   1) Sirve la app estática con el binding ASSETS (todo lo que no sea /api/*).
   2) Atiende /api/* como puente protegido hacia el Apps Script de la hoja Finanzas 2026:
      la URL y la clave del script son secretos del Worker; el iPhone nunca las ve.
   Toda petición a /api/* exige el JWT que Cloudflare Access pone en Cf-Access-Jwt-Assertion y se
   verifica completo: firma RS256 contra las llaves públicas del equipo, emisor, audiencia, vigencia
   y correo autorizado. Sin JWT válido no se toca la hoja, aunque alguien llegue por workers.dev.

   Secretos (wrangler secret put NOMBRE, o Settings → Variables and Secrets en el panel):
     SCRIPT_URL     URL /exec del Apps Script
     SCRIPT_CLAVE   la misma clave que lee Code.gs (Propiedades del script → CLAVE)
     ACCESS_TEAM    https://<equipo>.cloudflareaccess.com
     ACCESS_AUD     etiqueta AUD de la aplicación de Access
     ACCESS_EMAILS  correos permitidos, separados por coma

   Rutas:
     POST /api/hoja    { accion: "ping"|"agregar"|"leer", filas }  → respuesta del Apps Script
     GET  /api/yo      correo y vencimiento de la sesión (se muestra en Más)
     GET  /api/entrar  fuerza el login de Access y regresa a la app */

const ACCIONES = ["ping", "agregar", "leer"];
const MAX_CUERPO = 1000000;     // bytes por envío
const MAX_FILAS = 500;
const CACHE_LLAVES = 3600e3;    // 1 h

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
const texto = (t, status = 200) => new Response(t, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    return url.pathname.startsWith("/api/") ? api(request, env, {}) : env.ASSETS.fetch(request);
  }
};

/* deps permite inyectar fetch, reloj y crypto en las pruebas de Node. */
export async function api(request, env, deps = {}) {
  const url = new URL(request.url), ruta = url.pathname.replace(/\/+$/, "");
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD || !env.ACCESS_EMAILS) {
    return json({ ok: false, error: "El Worker aún no tiene configurado Cloudflare Access", codigo: "sin-access" }, 503);
  }

  const sesion = await verificarJWT(tokenDe(request), env, deps);
  if (ruta === "/api/entrar") {
    return sesion.ok ? Response.redirect(url.origin + "/", 302)
      : texto("Cloudflare Access no entregó una sesión válida (" + sesion.codigo + "). Revisa ACCESS_TEAM, ACCESS_AUD y ACCESS_EMAILS en el Worker.", 401);
  }
  if (!sesion.ok) return json({ ok: false, error: "Sesión no válida. Vuelve a entrar.", codigo: sesion.codigo }, 401);
  if (ruta === "/api/yo") return json({ ok: true, email: sesion.email, vence: sesion.exp });
  if (ruta !== "/api/hoja") return json({ ok: false, error: "No existe" }, 404);
  if (request.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  if (!mismaApp(request, url)) return json({ ok: false, error: "Petición rechazada", codigo: "origen" }, 403);
  if (!env.SCRIPT_URL || !env.SCRIPT_CLAVE) return json({ ok: false, error: "El Worker aún no tiene configurada la hoja", codigo: "sin-hoja" }, 503);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_CUERPO) return json({ ok: false, error: "Demasiados datos en un solo envío" }, 413);

  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return json({ ok: false, error: "Cuerpo inválido" }, 400); }
  if (!body || !ACCIONES.includes(body.accion)) return json({ ok: false, error: "Acción desconocida" }, 400);
  const filas = Array.isArray(body.filas) ? body.filas : [];
  if (filas.length > MAX_FILAS) return json({ ok: false, error: "Manda menos de " + MAX_FILAS + " filas por envío" }, 413);

  const f = deps.fetch || fetch;
  let r;
  try {
    r = await f(env.SCRIPT_URL, {
      method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ clave: env.SCRIPT_CLAVE, accion: body.accion, filas })
    });
  } catch (e) { return json({ ok: false, error: "No se pudo llegar al Apps Script" }, 502); }
  const t = await r.text();
  try { return json(JSON.parse(t), 200); }
  catch (e) { return json({ ok: false, error: "El Apps Script no respondió JSON (HTTP " + r.status + ")" }, 502); }
}

/* Solo la propia app puede usar la API: un formulario de otro sitio no puede poner estas cabeceras
   ni mandar application/json, así que la cookie de Access no sirve para un ataque CSRF. */
function mismaApp(request, url) {
  const origen = request.headers.get("Origin"), sitio = request.headers.get("Sec-Fetch-Site");
  if (origen && origen !== url.origin) return false;
  if (sitio && sitio !== "same-origin" && sitio !== "none") return false;
  if (request.headers.get("X-Requested-With") !== "XMLHttpRequest") return false;
  return (request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json");
}

function tokenDe(request) {
  const h = request.headers.get("Cf-Access-Jwt-Assertion");
  if (h) return h.trim();
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;\s]+)/);
  return m ? m[1] : "";
}

/* ---------- JWT de Cloudflare Access ---------- */
const b64u = s => {
  s = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4);
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const parte = p => JSON.parse(new TextDecoder().decode(b64u(p)));

let llaves = { equipo: "", keys: [], ts: 0 };
async function llavesDe(env, f, forzar) {
  if (!forzar && llaves.equipo === env.ACCESS_TEAM && Date.now() - llaves.ts < CACHE_LLAVES) return llaves.keys;
  const r = await f(env.ACCESS_TEAM + "/cdn-cgi/access/certs");
  if (!r.ok) throw new Error("certs " + r.status);
  const j = await r.json();
  llaves = { equipo: env.ACCESS_TEAM, keys: Array.isArray(j.keys) ? j.keys : [], ts: Date.now() };
  return llaves.keys;
}

/* Devuelve { ok, email, exp } o { ok: false, codigo } con el motivo (nunca detalles del token). */
export async function verificarJWT(token, env, deps = {}) {
  const f = deps.fetch || fetch, subtle = (deps.crypto || crypto).subtle;
  const ahora = Math.floor((deps.ahora ? deps.ahora() : Date.now()) / 1000);
  if (!token) return { ok: false, codigo: "sin-token" };
  const p = token.split(".");
  if (p.length !== 3) return { ok: false, codigo: "formato" };
  let h, c;
  try { h = parte(p[0]); c = parte(p[1]); } catch (e) { return { ok: false, codigo: "formato" }; }
  if (!h || !c || h.alg !== "RS256" || !h.kid) return { ok: false, codigo: "alg" };
  let jwk;
  try {
    jwk = (await llavesDe(env, f, false)).find(k => k.kid === h.kid) || (await llavesDe(env, f, true)).find(k => k.kid === h.kid);
  } catch (e) { return { ok: false, codigo: "llaves" }; }
  if (!jwk) return { ok: false, codigo: "kid" };
  let firmaOk = false;
  try {
    const key = await subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    firmaOk = await subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(p[2]), new TextEncoder().encode(p[0] + "." + p[1]));
  } catch (e) { firmaOk = false; }
  if (!firmaOk) return { ok: false, codigo: "firma" };
  if (c.iss !== env.ACCESS_TEAM) return { ok: false, codigo: "emisor" };
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(env.ACCESS_AUD)) return { ok: false, codigo: "audiencia" };
  if (typeof c.exp !== "number" || c.exp <= ahora) return { ok: false, codigo: "vencido" };
  if (typeof c.nbf === "number" && c.nbf > ahora + 60) return { ok: false, codigo: "aun-no" };
  const email = String(c.email || "").trim().toLowerCase();
  const permitidos = env.ACCESS_EMAILS.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!email || !permitidos.includes(email)) return { ok: false, codigo: "correo" };
  return { ok: true, email, exp: c.exp };
}
