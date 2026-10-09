// Conversaciones de Instagram y Messenger de CyM (desde el webhook), agrupadas por contacto. PRIVADO: misma clave del panel.
import { createHmac, timingSafeEqual } from 'node:crypto';
const COOKIE = 'cym_panel';
const iguales = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
function autenticado(req) {
  const m = (req.headers.cookie || '').match(new RegExp(COOKIE + '=([^;]+)'));
  if (!m || !process.env.CYM_COOKIE_SECRET) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  const f = createHmac('sha256', process.env.CYM_COOKIE_SECRET).update('cym-panel:' + exp).digest('hex');
  return Number(exp) > Date.now() && iguales(sig || '', f);
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex');
  if (!autenticado(req)) return res.status(401).json({ error: 'Sin sesión' });
  const desde = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes + '-01' : '2026-10-01';
  const hasta = new Date(new Date(desde + 'T00:00:00Z').setUTCMonth(new Date(desde + 'T00:00:00Z').getUTCMonth() + 1)).toISOString();
  const url = `${process.env.SUPABASE_URL}/rest/v1/meta_mensajes?cliente=eq.cym&enviado_en=gte.${desde}T00:00:00Z&enviado_en=lt.${hasta}&select=plataforma,contacto_id,direccion,enviado_en,texto,codigo&order=enviado_en.asc&limit=5000`;
  const r = await fetch(url, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY } });
  if (!r.ok) return res.status(500).json({ error: 'No se pudo leer' });
  const conv = {};
  for (const m of await r.json()) {
    const c = conv[m.contacto_id] ||= { contacto: m.contacto_id, plataforma: m.plataforma, primer_mensaje: null, texto: null, codigo: null, respondida: false, primera_respuesta: null, minutos: null, mensajes: 0 };
    c.mensajes++;
    if (m.direccion === 'entrante') { if (!c.primer_mensaje) { c.primer_mensaje = m.enviado_en; c.texto = (m.texto || '').slice(0, 160); } if (!c.codigo && m.codigo) c.codigo = m.codigo; }
    else if (c.primer_mensaje && !c.respondida) { c.respondida = true; c.primera_respuesta = m.enviado_en; c.minutos = Math.round((new Date(m.enviado_en) - new Date(c.primer_mensaje)) / 60000); }
  }
  const lista = Object.values(conv).filter(c => c.primer_mensaje).sort((a, b) => b.primer_mensaje.localeCompare(a.primer_mensaje));
  res.status(200).json({ desde, total: lista.length, respondidas: lista.filter(c => c.respondida).length, conversaciones: lista });
}
