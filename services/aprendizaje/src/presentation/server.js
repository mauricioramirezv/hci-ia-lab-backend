import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8'));

export function createLearningServer() {
  return createServer({ requestTimeout: 10000, headersTimeout: 5000 }, (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => {
      response.writeHead(status);
      response.end(JSON.stringify(body));
    };
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      send(400, { code: 'INVALID_REQUEST' });
      return;
    }
    if (!['/health/live', '/openapi.json'].includes(pathname)) {
      send(404, { code: 'ROUTE_NOT_FOUND' });
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      send(405, { code: 'METHOD_NOT_ALLOWED' });
      return;
    }
    send(200, pathname === '/openapi.json' ? contract : { status: 'ok', service: 'aprendizaje' });
  });
}
