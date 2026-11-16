// Development only: stands in for OpenChamber's service callback, so the service can run outside the app.
// It answers `readSettings()` with PLOI_API_TOKEN (none when unset) and prints what the integration card
// would show. Usage: PLOI_API_TOKEN=… node scripts/dev-host.mjs 4597
import http from 'node:http';

const port = Number(process.argv[2] ?? 4597);
const token = process.env.PLOI_API_TOKEN ?? '';

http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const { method, input } = JSON.parse(body || '{}');
    if (method === 'settings.read') {
      res.end(JSON.stringify({ result: { settings: token ? { 'api-token': token } : {} } }));
      return;
    }
    if (method === 'status.set') console.log('Integration card:', input?.needsConfiguration ?? '(cleared)');
    res.end(JSON.stringify({ result: { saved: true } }));
  });
}).listen(port, '127.0.0.1', () => { console.log(`Fake OpenChamber host on 127.0.0.1:${port}${token ? '' : ' (no token)'}`); });
