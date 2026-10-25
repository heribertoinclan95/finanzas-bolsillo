/* Service worker: la app abre sin internet.
   Cada vez que cambies archivos de la app, sube VERSION para que el iPhone baje la nueva.
   Seguridad: nunca intercepta /api/ (Worker) ni /cdn-cgi/ (Cloudflare Access) y solo guarda en caché
   respuestas completas y sin redirección; así el login de Access jamás se guarda como si fuera la app. */
const VERSION = "v5";
const CACHE = "finanzas-" + VERSION;
const ARCHIVOS = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];
const SIN_SW = /\/(api|cdn-cgi)\//;                                   // rutas que van directo a la red
const guardable = r => !!r && r.ok && !r.redirected;                   // un 200 real, no un 302 al login
const guardableExterno = r => !!r && (r.type === "opaque" || (r.ok && !r.redirected));

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("finanzas-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;               // los envíos a la hoja pasan directo
  const url = new URL(req.url);
  if (SIN_SW.test(url.pathname)) return;          // Worker y Access: sin caché ni intermediarios
  if (url.origin === location.origin) {
    // Red primero para tener siempre la última versión; si no hay internet, caché.
    e.respondWith(fetch(req).then(res => {
      if (guardable(res)) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })
      .then(r => r || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))));
  } else if (url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com")) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (guardableExterno(res)) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
