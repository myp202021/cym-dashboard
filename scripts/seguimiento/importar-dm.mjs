// Convierte la extracción de la bandeja de IG (raw/ig-dm/<fecha>.json, privado) y la sube a /api/importar-bandeja.
// Uso: node scripts/seguimiento/importar-dm.mjs raw/ig-dm/2026-11-09.json [--seco]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [archivo, modo] = process.argv.slice(2);
const { generado, items } = JSON.parse(readFileSync(new URL('./' + archivo, import.meta.url)));
const base = new Date(generado);
const DIAS = { Dom: 0, Lun: 1, Mar: 2, 'Mié': 3, Jue: 4, Vie: 5, 'Sáb': 6 };
const MESES = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
function fechaDe(x) {
  const m = x.preview.match(/(\d{1,2}) de ([a-z]+)/);
  if (m && MESES[m[2]] != null) return new Date(Date.UTC(base.getUTCFullYear(), MESES[m[2]], +m[1], 15));
  const etiqueta = DIAS[x.fecha] != null ? x.fecha : x.preview.split(' | ').find(t => DIAS[t.trim()] != null)?.trim();
  if (etiqueta) { const d = new Date(base); const atras = (d.getDay() - DIAS[etiqueta] + 7) % 7 || 7; d.setDate(d.getDate() - atras); d.setUTCHours(15, 0, 0, 0); return d; }
  return new Date(base);
}
const personas = items.map(x => ({
  contacto_id: 'igb_' + createHash('sha1').update(x.nombre).digest('hex').slice(0, 16),
  nombre: x.nombre, fecha: fechaDe(x).toISOString(),
  texto: [x.preview, x.reciente].join(' \n ').replace(/\b(Prioridad|ad_id\.*|Tú:)\b/g, ' '),
  respondida: /^Tú:/.test(x.preview) || /Gracias por (tu interés|escribir)/i.test(x.reciente),
  posts: x.posts,
}));
const porDia = {}; for (const p of personas) porDia[p.fecha.slice(0, 10)] = (porDia[p.fecha.slice(0, 10)] || 0) + 1;
console.log('personas', personas.length, 'por día', JSON.stringify(porDia));
if (modo === '--seco') process.exit(0);
const k = readFileSync(new URL('../../.meta-webhook.local', import.meta.url), 'utf8').match(/^META_WEBHOOK_KEY=(.*)$/m)[1].trim();
const r = await fetch('https://cym-dashboard-liart.vercel.app/api/importar-bandeja?k=' + encodeURIComponent(k), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personas }) });
console.log(r.status, await r.text());
