// ===== Entry Point =====

// Load .env from project root BEFORE anything else
import './load-env.js';

import { startServer } from './server.js';

console.log('🐕 土狗猎手 TuGou Catcher - Starting...');
console.log(`Time: ${new Date().toISOString()}`);
console.log(`Node: ${process.version}`);
console.log('');

startServer();
