import { esConsulta } from './_bot-cym.js';
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
  // sin clave por pedido de Christopher
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
    else if (!c.respondida) {
      // La hora de un comentario por webhook es la de llegada: la respuesta automática puede quedar segundos antes.
      c.respondida = true; c.primera_respuesta = m.enviado_en;
      if (c.primer_mensaje) c.minutos = Math.round((new Date(m.enviado_en) - new Date(c.primer_mensaje)) / 60000);
    }
  }
  // Datos recogidos por el agente. Sin clave por pedido de Christopher (3 nov 2026).
  const rc = await fetch(`${process.env.SUPABASE_URL}/rest/v1/meta_conversaciones?cliente=eq.cym&select=contacto_id,estado,datos`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY } });
  if (rc.ok) for (const l of await rc.json()) {
    if (l.estado === 'alias') continue;
    const c = conv[l.contacto_id]; if (!c) continue;
    const d = l.datos || {};
    Object.assign(c, { estado_agente: l.estado, tema: d.tema || null, comuna: d.comuna || null, director: d.director || null, consulta: d.consulta || null, codigo: c.codigo || d.codigo || null, tiene_telefono: !!d.telefono, nombre: d.nombre || null, telefono: d.telefono || null });
  }
  for (const c of Object.values(conv)) if (c.respondida && c.primer_mensaje && c.minutos == null) c.minutos = 0;
  // Fuera lo que no es consulta ("Precioso", quejas). Las cuentas de prueba siguen en la lista, marcadas, pero no suman.
  const pruebas = (process.env.META_BOT_PRUEBA || '').split(',').map(x => x.trim());
  const lista = Object.values(conv).filter(c => c.primer_mensaje && (!c.texto?.startsWith('[comentario] ') || esConsulta(c.texto.slice(13)))).map(c => ({ ...c, prueba: pruebas.includes(c.contacto) })).sort((a, b) => b.primer_mensaje.localeCompare(a.primer_mensaje));
  const reales = lista.filter(c => !c.prueba);
  res.status(200).json({ desde, total: reales.length, con_datos: reales.filter(c => c.tiene_telefono).length, respondidas: reales.filter(c => c.respondida).length, conversaciones: lista });
}
