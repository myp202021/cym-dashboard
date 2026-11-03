// Webhook de Meta (app MyP Reportes Ads): mensajes y comentarios de Instagram y Facebook de CyM.
// Guarda cada mensaje o comentario en Supabase public.meta_mensajes y los datos del lead en meta_conversaciones.
// Env (Vercel production): META_VERIFY_TOKEN, META_WEBHOOK_KEY (?k= en la URL de callback),
//   META_APP_SECRET (opcional: si existe se valida X-Hub-Signature-256), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { responde, comentarioDe, comentarioVale, respondeComentario } from './_bot-cym.js';
import { avisaLead } from './_aviso-cym.js';

export const config = { api: { bodyParser: false } };

let CATALOGO = null;
function catalogo() {
  if (!CATALOGO) {
    try { CATALOGO = JSON.parse(readFileSync(join(process.cwd(), 'data', 'propiedades-catalogo.json'), 'utf8')).codigos || {}; }
    catch { CATALOGO = {}; }
  }
  return CATALOGO;
}
function detectaCodigo(texto) {
  const m = String(texto || '').match(/\b\d{4}\b/g) || [];
  return m.find(c => catalogo()[c]) || null;
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

const SB = () => ({ apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' });
const CONV = () => process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones';

// META_BOT_ACTIVO: 'prueba' = solo cuentas de META_BOT_PRUEBA (para el video de revisión); 'todos' = todos, tras aprobar Meta.
// A los demás les responden las automatizaciones de Business Suite.
function botAtiende(contacto) {
  const modo = process.env.META_BOT_ACTIVO;
  if (modo === 'todos') return true;
  if (modo === 'prueba') return (process.env.META_BOT_PRUEBA || '').split(',').map(x => x.trim()).includes(contacto);
  return false;
}
async function leeConv(f) {
  const q = `?cliente=eq.cym&plataforma=eq.${f.plataforma}&contacto_id=eq.${encodeURIComponent(f.contacto_id)}&select=*`;
  const r = await fetch(CONV() + q, { headers: SB() });
  if (!r.ok) throw new Error('leer conversación ' + r.status);
  return (await r.json())[0] || null;
}
async function guardaConv(f, c) {
  const r = await fetch(CONV() + '?on_conflict=cliente,plataforma,contacto_id', {
    method: 'POST', headers: { ...SB(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ cliente: 'cym', plataforma: f.plataforma, contacto_id: f.contacto_id, nodo: c.nodo, estado: c.estado, intentos: c.intentos || 0, datos: c.datos || {}, ultimo_bot: c.ultimo_bot ?? null, actualizado_en: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error('guardar conversación ' + r.status);
}
async function enviar(contacto, texto) {
  const r = await fetch(`https://graph.facebook.com/v25.0/${process.env.META_PAGE_ID}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.META_PAGE_TOKEN },
    body: JSON.stringify({ recipient: { id: contacto }, messaging_type: 'RESPONSE', message: { text: texto } }),
  });
  if (!r.ok) throw new Error('enviar ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
// Respuesta privada a un comentario. Meta devuelve el id con que la persona queda en el chat (en Facebook puede diferir del autor).
async function enviarAComentario(comentarioId, texto) {
  const r = await fetch(`https://graph.facebook.com/v25.0/${process.env.META_PAGE_ID}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.META_PAGE_TOKEN },
    body: JSON.stringify({ recipient: { comment_id: comentarioId }, message: { text: texto } }),
  });
  if (!r.ok) throw new Error('responder comentario ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function textoPublicacion(plataforma, id) {
  if (!id) return '';
  const campo = plataforma === 'instagram' ? 'caption' : 'message';
  try {
    const r = await fetch(`https://graph.facebook.com/v25.0/${id}?fields=${campo}`, { headers: { Authorization: 'Bearer ' + process.env.META_PAGE_TOKEN } });
    return r.ok ? (await r.json())[campo] || '' : '';
  } catch { return ''; }
}
async function atiendeComentario(c, plataforma, mid) {
  if (!botAtiende(c.autor) || !process.env.META_PAGE_TOKEN || !process.env.META_PAGE_ID || !comentarioVale(c.texto)) return;
  const fAutor = { plataforma, contacto_id: c.autor };
  if (await leeConv(fAutor)) return; // ya se le escribió: un solo mensaje privado por persona
  const r = respondeComentario(c.texto, await textoPublicacion(plataforma, c.publicacion), catalogo());
  r.datos.publicacion = c.publicacion || null;
  const envio = await enviarAComentario(c.id, r.responder);
  const destino = String(envio.recipient_id || c.autor);
  const fDestino = { plataforma, contacto_id: destino };
  if (destino === c.autor || !(await leeConv(fDestino))) await guardaConv(fDestino, { ...r, ultimo_bot: r.responder });
  if (destino !== c.autor) {
    await guardaConv(fAutor, { nodo: 'fin', estado: 'alias', datos: { destino }, ultimo_bot: null });
    await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_mensajes?mid=eq.' + encodeURIComponent(mid), { method: 'PATCH', headers: { ...SB(), Prefer: 'return=minimal' }, body: JSON.stringify({ contacto_id: destino }) });
  }
}
// Un mensaje entrante avanza la conversación; si alguien de CyM responde a mano, el agente se retira.
async function atiende(f) {
  if (!botAtiende(f.contacto_id) || !process.env.META_PAGE_TOKEN || !process.env.META_PAGE_ID) return;
  const conv = await leeConv(f);
  if (f.direccion === 'saliente') {
    if (conv && conv.estado === 'abierto' && (f.texto || '') !== (conv.ultimo_bot || '')) await guardaConv(f, { ...conv, estado: 'humano' });
    // Alguien de CyM ya atiende este chat: el agente no se mete. El saludo del agente tras un comentario no cuenta.
    if (!conv && !/^¡Hola! 👋 Gracias por/.test(f.texto || '')) await guardaConv(f, { nodo: null, estado: 'humano', datos: {}, ultimo_bot: null });
    return;
  }
  const r = responde(conv, f.texto, catalogo());
  if (!r.responder) { if (conv) await guardaConv(f, { ...conv, ...r, ultimo_bot: conv.ultimo_bot }); return; }
  await guardaConv(f, { ...r, ultimo_bot: r.responder }); // antes de enviar, para reconocer el eco de Meta
  let fallo = null;
  try { await enviar(f.contacto_id, r.responder); } catch (e) { fallo = e; }
  // El lead se avisa aunque falle la respuesta final: sus datos ya están.
  if (r.estado !== 'abierto' && r.datos?.telefono) { // sin teléfono no se avisa al director
    try { await avisaLead(r, f.plataforma, process.env.META_BOT_ACTIVO !== 'todos'); console.log('aviso enviado', r.datos?.director || 'central'); }
    catch (e) { console.error('aviso', e.message); }
  }
  if (fallo) throw fallo;
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
  console.log('webhook POST', 'clave_ok=' + (!!process.env.META_WEBHOOK_KEY && iguales(req.query.k || '', process.env.META_WEBHOOK_KEY)), 'firma=' + (req.headers['x-hub-signature-256'] ? 'si' : 'no'));
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
  const comentarios = {};
  // La prueba del panel de Meta puede venir como {field, value} o {sample:{field, value}} sin "entry".
  const suelto = body.sample || (body.field ? body : null);
  if (suelto && suelto.field === 'messages' && suelto.value) body.entry = [{ id: suelto.value.recipient?.id || 'prueba', changes: [suelto] }];
  const propias = [process.env.META_PAGE_ID, process.env.META_IG_ID].filter(Boolean);
  for (const entry of body.entry || []) {
    for (const cambio of entry.changes || []) {
      const c = comentarioDe(plataforma, entry.id, cambio, propias);
      if (!c) continue;
      const mid = 'c_' + c.id;
      comentarios[mid] = c;
      filas.push({
        cliente: 'cym', plataforma, cuenta_id: String(entry.id), contacto_id: String(c.autor), direccion: 'entrante',
        enviado_en: new Date().toISOString(), mid, texto: '[comentario] ' + (c.texto || ''), codigo: detectaCodigo(c.texto), raw: cambio.value,
      });
    }
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
  if (!filas.length) console.log('webhook sin mensajes', JSON.stringify(Object.keys(body)), JSON.stringify(body).slice(0, 300));
  if (filas.length && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_mensajes?on_conflict=mid', {
      method: 'POST',
      headers: { ...SB(), Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(filas),
    });
    if (!r.ok) console.error('supabase', r.status, await r.text());
    else {
      // Solo las filas nuevas: Meta reintenta entregas y no hay que responder dos veces.
      const nuevas = await r.json();
      for (const f of nuevas) { try { if (comentarios[f.mid]) await atiendeComentario(comentarios[f.mid], plataforma, f.mid); else await atiende(f); } catch (e) { console.error('agente', e.message); } }
    }
  }
  return res.status(200).send('EVENT_RECEIVED');
}
