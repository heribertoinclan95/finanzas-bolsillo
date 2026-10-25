// Servidor local para probar la app desde la computadora (solo desarrollo, no se publica):
//   node tests/servir.js        → http://localhost:8765/
// Sirve la carpeta del proyecto tal cual, sin caché. Ctrl+C para cerrar.
const http = require("http"), fs = require("fs"), path = require("path");
const RAIZ = path.join(__dirname, ".."), PUERTO = +process.argv[2] || 8765;
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".json": "application/json", ".md": "text/plain; charset=utf-8" };
http.createServer((req, res) => {
  let ruta = decodeURIComponent(req.url.split("?")[0]); if (ruta === "/") ruta = "/index.html";
  const archivo = path.normalize(path.join(RAIZ, ruta));
  if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) { res.writeHead(404); res.end("No existe"); return; }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(archivo).pipe(res);
}).listen(PUERTO, "127.0.0.1", () => console.log(`Abre http://localhost:${PUERTO}/ en Chrome. Ctrl+Shift+M para verla a 390 px. Ctrl+C para cerrar.`));
