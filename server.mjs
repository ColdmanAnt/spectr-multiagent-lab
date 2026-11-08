import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), 'dist'));
const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = Number(portAt >= 0 ? args[portAt + 1] : process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535 ||
    !(args.length === 0 || (args.length === 2 && args[0] === '--port'))) {
  console.error('Использование: node server.mjs [--port 4173]');
  process.exit(1);
}
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const server = http.createServer(async (req, res) => {
  const fail = (status, message) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(message);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return fail(405, 'Метод не поддерживается');
  }
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (requested.includes('\0')) return fail(400, 'Некорректный путь');
    let path = resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
    if (path !== root && !path.startsWith(root + sep)) return fail(403, 'Доступ запрещён');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const canonical = await realpath(path);
    if (!canonical.startsWith(root + sep)) return fail(403, 'Доступ запрещён');
    const content = await readFile(canonical);
    res.writeHead(200, {
      'Content-Type': mime[extname(canonical)] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error instanceof URIError || error.code === 'ERR_INVALID_URL') return fail(400, 'Некорректный запрос');
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return fail(404, 'Файл не найден');
    console.error(error.message);
    fail(500, 'Ошибка чтения файла');
  }
});
server.on('error', (error) => {
  console.error(`Не удалось запустить сервер: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`СПЕКТР: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
