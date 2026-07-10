#!/usr/bin/env node
import 'dotenv/config';

async function main() {
  const [,, command] = process.argv;

  switch (command) {
    case 'generate':
      const { run } = await import('./orchestrator.js');
      await run();
      break;
    case 'health':
      const { healthCheck } = await import('./utils/health.js');
      await healthCheck();
      break;
    default:
      console.log('MoneyQ Social Engine v1.0.0');
      console.log('Usage: node src/index.js [generate|health]');
  }
}

main().catch(console.error);
