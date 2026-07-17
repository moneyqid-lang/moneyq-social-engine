// moneyq-social-engine/dashboard/server.js
// Simple dashboard server with API endpoints
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.DASHBOARD_PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API endpoints
  if (req.url === '/api/generate' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Generate triggered. Check terminal for output.' }));

    // Trigger generate in background
    const { execFile } = await import('node:child_process');
    execFile('node', ['src/orchestrator.js'], { cwd: join(__dirname, '..') }, (err, stdout, stderr) => {
      if (err) console.error('Generate error:', stderr);
      else console.log('Generate output:', stdout);
    });
    return;
  }

  if (req.url === '/api/status') {
    const status = {
      platforms: {
        instagram: { connected: true, username: '@moneyq' },
        threads: { connected: true, username: '@moneyq.id' },
        youtube: { connected: true, channel: 'MoneyQ' },
        tiktok: { connected: false, reason: 'Pending review' },
      },
      lastGenerate: new Date().toISOString(),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = join(__dirname, filePath);

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n📊 MoneyQ Dashboard running at http://localhost:${PORT}\n`);
  console.log('  API Endpoints:');
  console.log('  GET  /api/status    — Platform status');
  console.log('  POST /api/generate  — Trigger content generation\n');
});
