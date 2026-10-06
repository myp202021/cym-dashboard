// Cifra el detalle orgánico (nombres/teléfonos) para publicarlo sin exponerlo.
// Lee scripts/seguimiento/raw/organico-detalle-*.json (gitignored) y escribe privado/organico-detalle.enc (AES-256-GCM).
// La clave va en .detalle-key.local (local, gitignored) y en la variable CYM_DETALLE_KEY de Vercel (production).
// Uso: node scripts/seguimiento/cifrar-detalle.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createCipheriv, randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'scripts', 'seguimiento', 'raw');
const meses = {};
for (const f of readdirSync(RAW).filter(f => /^organico-detalle-\d{4}-\d{2}\.json$/.test(f)).sort()) {
  const d = JSON.parse(readFileSync(join(RAW, f), 'utf8'));
  meses[d.mes] = d.filas;
}
const key = Buffer.from((process.env.CYM_DETALLE_KEY || readFileSync(join(ROOT, '.detalle-key.local'), 'utf8')).trim(), 'hex');
const iv = randomBytes(12);
const c = createCipheriv('aes-256-gcm', key, iv);
const data = Buffer.concat([c.update(JSON.stringify({ generado: new Date().toISOString(), meses })), c.final()]);
writeFileSync(join(ROOT, 'privado', 'organico-detalle.enc'),
  JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }));
console.log('cifrado:', Object.entries(meses).map(([m, f]) => `${m}: ${f.length}`).join(' · '));
