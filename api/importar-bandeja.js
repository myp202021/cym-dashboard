// Importa al panel (/mensajes) los DMs de Instagram leídos desde la bandeja de Business Suite (la API de Meta no los entrega
// sin App Review). Exige ?k=META_WEBHOOK_KEY. No responde a nadie. Desde el 9 nov avisa por correo al director (una vez por
// contacto) los DMs NUEVOS con teléfono; los ya guardados no se reavisan. ?historico=1 guarda sin avisar. ?prueba=1 avisa solo a Christopher.
// Body: { personas: [{ contacto_id, nombre, fecha, texto, respondida, posts: ['/p/SHORTCODE/'] }] }
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { armaLead } from './meta-sondeo.js';
import { avisaLead } from './_aviso-cym.js';

const SB = () => ({ apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' });
const iguales = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const CYM_TEL = '934018822'; // WhatsApp de CyM: no es teléfono del lead

async function captions(shortcodes) {
  const faltan = new Set(shortcodes), out = {};
  let url = `https://graph.facebook.com/v25.0/${process.env.META_IG_ID}/media?fields=shortcode,caption&limit=100`;
  for (let i = 0; url && faltan.size && i < 10; i++) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.META_PAGE_TOKEN } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) break;
    for (const m of d.data || []) if (faltan.has(m.shortcode)) { out[m.shortcode] = m.caption || ''; faltan.delete(m.shortcode); }
    url = d.paging?.next;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST' || !process.env.META_WEBHOOK_KEY || !iguales(req.query.k || '', process.env.META_WEBHOOK_KEY)) return res.status(401).json({ error: 'no autorizado' });
  const personas = (req.body?.personas || []).slice(0, 300);
  const catalogo = (() => { try { return JSON.parse(readFileSync(join(process.cwd(), 'data', 'propiedades-catalogo.json'), 'utf8')).codigos || {}; } catch { return {}; } })();
  const cods = [...new Set(personas.flatMap(p => (p.posts || []).map(x => (x.match(/\/(?:p|reel)\/([^/]+)/) || [])[1]).filter(Boolean)))];
  const cap = cods.length ? await captions(cods) : {};
  const historico = req.query.historico === '1', prueba = req.query.prueba === '1';
  const resumen = { recibidas: personas.length, guardadas: 0, con_telefono: 0, con_codigo: 0, avisos: 0, errores: [] };
  for (const p of personas) {
    try {
      const contexto = (p.posts || []).map(x => cap[(x.match(/\/(?:p|reel)\/([^/]+)/) || [])[1]] || '').join(' ');
      const texto = String(p.texto || '').replace(/\+?56\s?9\s?3401\s?8822/g, '').slice(0, 2000);
      const mid = 'b_' + createHash('sha1').update(p.contacto_id + '|' + p.fecha).digest('hex').slice(0, 24);
      const l = { plataforma: 'instagram', contacto_id: p.contacto_id, nombre: p.nombre, origen: 'mensaje', contexto, mensajes: [{ mid, fecha: p.fecha, texto, saliente: false }] };
      const q = `?cliente=eq.cym&plataforma=eq.instagram&contacto_id=eq.${encodeURIComponent(p.contacto_id)}&select=datos`;
      const previa = (await (await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones' + q, { headers: SB() })).json())[0];
      const d = armaLead(l, previa?.datos || {}, catalogo);
      if (d.telefono && d.telefono.replace(/\D/g, '').endsWith(CYM_TEL)) d.telefono = null;
      d.origen = 'bandeja';
      if (historico || previa) { if (!previa?.datos || previa.datos.avisado_tel !== false) { d.avisado = true; d.avisado_tel = true; } } // histórico o ya guardado: no se reavisa
      else if (d.telefono && !d.avisado_tel) {
        await avisaLead({ estado: 'completo', datos: d }, 'instagram', prueba);
        resumen.avisos++;
        if (!prueba) { d.avisado = true; d.avisado_tel = true; d.avisado_correo = new Date().toISOString(); }
      }
      if (d.telefono) resumen.con_telefono++;
      if (d.codigo) resumen.con_codigo++;
      const filas = [{ cliente: 'cym', plataforma: 'instagram', cuenta_id: process.env.META_IG_ID, contacto_id: p.contacto_id, direccion: 'entrante', enviado_en: new Date(p.fecha).toISOString(), mid, texto: '[DM] ' + texto.slice(0, 1000), codigo: d.codigo || null, raw: {} }];
      if (p.respondida) filas.push({ ...filas[0], direccion: 'saliente', mid: mid + 'r', texto: '[respuesta de CyM en la bandeja]', codigo: null, enviado_en: new Date(new Date(p.fecha).getTime() + 60000).toISOString() });
      const rm = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_mensajes?on_conflict=mid', { method: 'POST', headers: { ...SB(), Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(filas) });
      if (!rm.ok) { resumen.errores.push('mensajes ' + rm.status); continue; }
      const rg = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones?on_conflict=cliente,plataforma,contacto_id', { method: 'POST', headers: { ...SB(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ cliente: 'cym', plataforma: 'instagram', contacto_id: p.contacto_id, nodo: 'bandeja', estado: d.telefono ? 'completo' : 'humano', intentos: 0, datos: d, ultimo_bot: null, actualizado_en: new Date().toISOString() }) });
      if (!rg.ok) resumen.errores.push('lead ' + rg.status); else resumen.guardadas++;
      if (prueba) { // prueba: no deja rastro en el panel
        const qb = `?cliente=eq.cym&plataforma=eq.instagram&contacto_id=eq.${encodeURIComponent(p.contacto_id)}`;
        await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_mensajes' + qb, { method: 'DELETE', headers: SB() });
        await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones' + qb, { method: 'DELETE', headers: SB() });
        resumen.prueba_borrada = true;
      }
    } catch (e) { resumen.errores.push(e.message); }
  }
  res.status(200).json(resumen);
}
