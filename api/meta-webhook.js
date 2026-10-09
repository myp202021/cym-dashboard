// Webhook de Meta (app "M&P Seguimiento de Leads"): mensajes de Instagram y Messenger de CyM.
// Guarda cada mensaje (entrante del contacto o saliente de CyM) en Supabase public.meta_mensajes.
// Env (Vercel production): META_VERIFY_TOKEN, META_WEBHOOK_KEY (?k= en la URL de callback),
//   META_APP_SECRET (opcional: si existe se valida X-Hub-Signature-256), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const config = { api: { bodyParser: false } };

let CODIGOS = null;
function codigos() {
  if (!CODIGOS) {
    try { CODIGOS = new Set(Object.keys(JSON.parse(readFileSync(join(process.cwd(), 'data', 'propiedades-catalogo.json'), 'utf8')).codigos || {})); }
    catch { CODIGOS = new Set(); }
  }
  return CODIGOS;
}
function detectaCodigo(texto) {
  const m = String(texto || '').match(/\b\d{4}\b/g) || [];
  return m.find(c => codigos().has(c)) || null;
}
function iguales(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
async function leerCuerpo(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  return Buffer.concat(partes);
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method === 'GET') {
    const { 'hub.mode': modo, 'hub.verify_token': token, 'hub.challenge': desafio } = req.query;
    if (modo === 'subscribe' && process.env.META_VERIFY_TOKEN && iguales(token || '', process.env.META_VERIFY_TOKEN)) {
      return res.status(200).send(desafio);
    }
    return res.status(403).send('Forbidden');
  }
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.META_WEBHOOK_KEY || !iguales(req.query.k || '', process.env.META_WEBHOOK_KEY)) return res.status(403).end();

  const raw = await leerCuerpo(req);
  if (process.env.META_APP_SECRET) {
    const esperada = 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex');
    if (!iguales(req.headers['x-hub-signature-256'] || '', esperada)) return res.status(403).end();
  }
  let body = {};
  try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(200).send('EVENT_RECEIVED'); }

  const plataforma = body.object === 'instagram' ? 'instagram' : 'messenger';
  const filas = [];
  for (const entry of body.entry || []) {
    const eventos = [...(entry.messaging || []), ...(entry.changes || []).filter(c => c.field === 'messages' && c.value).map(c => c.value)];
    for (const ev of eventos) {
      const msg = ev.message;
      if (!msg || !msg.mid) continue;
      const saliente = !!msg.is_echo;
      const texto = msg.text || (msg.attachments ? '[' + msg.attachments.map(a => a.type).join(', ') + ']' : null);
      filas.push({
        cliente: 'cym', plataforma, cuenta_id: String(entry.id),
        contacto_id: String(saliente ? ev.recipient?.id : ev.sender?.id),
        direccion: saliente ? 'saliente' : 'entrante',
        enviado_en: new Date(Number(ev.timestamp) || Date.now()).toISOString(),
        mid: msg.mid, texto, codigo: saliente ? null : detectaCodigo(texto), raw: ev,
      });
    }
  }
  if (filas.length && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_mensajes?on_conflict=mid', {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(filas),
    });
    if (!r.ok) console.error('supabase', r.status, await r.text());
  }
  return res.status(200).send('EVENT_RECEIVED');
}
