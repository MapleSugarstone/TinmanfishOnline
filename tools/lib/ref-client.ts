// Talks to tools/ref-server.ts. Runs queue on the server and can take many minutes before it answers,
// longer than fetch's header timeout, so this uses a plain request with no timeout.
import http from 'node:http';

export const SERVER = 'http://127.0.0.1:8791';

export function serverPost<T>(path: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${SERVER}${path}`, { method: 'POST' }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(text));
        else resolve(JSON.parse(text) as T);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

export function serverUp(): Promise<boolean> {
  return fetch(`${SERVER}/status`).then((r) => r.ok, () => false);
}
