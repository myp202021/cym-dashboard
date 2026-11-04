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
  // Planilla de Drive: =IMPORTDATA(.../api/mensajes?csv=1&k=...) trae todo desde noviembre 2026, con datos completos.
  const claveCsv = process.env.CYM_COOKIE_SECRET ? createHmac('sha256', process.env.CYM_COOKIE_SECRET).update('cym-planilla-organico').digest('hex') : null;
  const esCsv = req.query.csv === '1' && !!claveCsv && iguales(req.query.k || '', claveCsv);
  if (req.query.csv === '1' && !esCsv) return res.status(403).send('Sin acceso');
  const desde = esCsv ? '2026-11-01' : /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes + '-01' : '2026-10-01';
  const hasta = esCsv ? '2099-01-01T00:00:00Z' : new Date(new Date(desde + 'T00:00:00Z').setUTCMonth(new Date(desde + 'T00:00:00Z').getUTCMonth() + 1)).toISOString();
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
  // Sin clave no salen datos personales: el enlace del panel es público (lo revisa Meta). Con ?k=CYM_PANEL_DATOS se ven completos.
  const conDatos = esCsv || (!!process.env.CYM_PANEL_DATOS && iguales(req.query.k || '', process.env.CYM_PANEL_DATOS));
  if (!conDatos) lista.forEach((c, i) => {
    c.contacto = 'c' + (i + 1);
    c.telefono = null;
    if (c.nombre && /\s/.test(c.nombre.trim())) c.nombre = c.nombre.trim().split(/\s+/).map(w => w[0].toUpperCase() + '.').join(' ');
    if (c.texto) c.texto = c.texto.replace(/\+?\d[\d\s.-]{7,}\d/g, '•••');
    if (c.consulta) c.consulta = String(c.consulta).replace(/\+?\d[\d\s.-]{7,}\d/g, '•••');
  });
  const reales = lista.filter(c => !c.prueba);
  if (esCsv) {
    // Texto de terceros: se neutraliza lo que una planilla podría leer como fórmula.
    const celda = v => { let t = String(v ?? '').replace(/\s+/g, ' ').trim(); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const hora = f => f ? new Date(f).toLocaleString('sv-SE', { timeZone: 'America/Santiago' }).slice(0, 16) : '';
    const filas = [...reales].sort((a, b) => String(b.primer_mensaje).localeCompare(String(a.primer_mensaje))).map(c => {
      const comentario = (c.texto || '').startsWith('[comentario] ');
      const red = c.plataforma === 'instagram' ? 'Instagram' : 'Facebook';
      return [hora(c.primer_mensaje), red, comentario ? 'Comentario' : c.plataforma === 'instagram' ? 'Formulario' : 'Mensaje', c.nombre, String(c.telefono || '').replace(/^\+/, ''), c.codigo, c.comuna, c.director, c.tema, (c.consulta || c.texto || '').replace(/^\[comentario\] /, ''), c.respondida ? 'Sí' : 'No'].map(celda).join(',');
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.status(200).send(['Fecha,Red,Tipo,Nombre,Teléfono,Código,Comuna,Director,Tema,Consulta,Respondida', ...filas].join('\n'));
  }
  res.status(200).json({ desde, total: reales.length, con_datos: reales.filter(c => c.tiene_telefono).length, respondidas: reales.filter(c => c.respondida).length, conversaciones: lista });
}
