// ===== Environment Loader =====
// Reads .env from project root (one level above backend/).
// Must be imported BEFORE any other module that reads process.env.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '..', '.env');
const localEnvPath = path.resolve(__dirname, '..', '..', '.env.local');
const shellEnvKeys = new Set(Object.keys(process.env));

function loadEnvFile(filePath: string, overrideProjectEnv = false): boolean {
  if (!fs.existsSync(filePath)) return false;

  const envContent = fs.readFileSync(filePath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Do not override existing env vars provided by the shell.
    if (!shellEnvKeys.has(key) && (overrideProjectEnv || !process.env[key])) {
      process.env[key] = value;
    }
  }
  console.log(`[ENV] Loaded config from ${filePath}`);
  return true;
}

const loadedBase = loadEnvFile(envPath);
loadEnvFile(localEnvPath, true);

if (!loadedBase && !fs.existsSync(localEnvPath)) {
  console.log(`[ENV] No .env file found at ${envPath}, using defaults`);
} else {
  // no-op
}
