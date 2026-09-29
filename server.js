// Tiny zero-dependency server: serves the site and saves your data to data.json.
// Run:  node server.js   then open http://localhost:4173
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const STATIC = new Set(['index.html', 'style.css', 'app.js', 'firebase-config.js']);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

function send(res, code, body, type = 'text/plain') {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/data') {
    if (req.method === 'GET') {
      return fs.readFile(DATA_FILE, 'utf8', (err, txt) =>
        err ? send(res, 404, '{}', 'application/json') : send(res, 200, txt, 'application/json'));
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on('end', () => {
        try { JSON.parse(body); } catch { return send(res, 400, 'bad json'); }
        const tmp = DATA_FILE + '.tmp';
        fs.writeFile(tmp, body, (e) => {
          if (e) return send(res, 500, 'write failed');
          fs.rename(tmp, DATA_FILE, (e2) => (e2 ? send(res, 500, 'rename failed') : send(res, 200, 'ok')));
        });
      });
      return;
    }
    return send(res, 405, 'method not allowed');
  }

  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!STATIC.has(name)) return send(res, 404, 'not found');
  fs.readFile(path.join(ROOT, name), (err, buf) =>
    err ? send(res, 404, 'not found') : send(res, 200, buf, TYPES[path.extname(name)]));
}).listen(PORT, '127.0.0.1', () => console.log(`Motivation is running at http://localhost:${PORT}`));
