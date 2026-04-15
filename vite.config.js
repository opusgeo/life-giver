import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// ── Dev-only plugin: POST /api/save-settings → writes public/settings.json ──
function saveSettingsPlugin() {
  return {
    name: 'save-settings',
    configureServer(server) {
      server.middlewares.use('/api/save-settings', (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405); res.end('Method Not Allowed'); return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const filePath = path.resolve('public', 'settings.json');
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(500); res.end(String(e));
          }
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [saveSettingsPlugin()],
});
