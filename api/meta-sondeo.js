// Revisa cada 15 min mensajes de Messenger y comentarios de Facebook e Instagram de CyM de CUALQUIER persona, por lectura de la API.
// Meta no entrega por webhook a personas sin rol mientras la app no esté aprobada; leer sí se puede. Las respuestas salen de las automatizaciones de Business Suite.
// Idempotente: cada lead se avisa una vez con teléfono y, si no lo deja en 60 min, una vez sin teléfono.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buscaTelefono, buscaCodigo, buscaComuna, directorDe, fichaEn, tema, comentarioVale } from './_bot-cym.js';
import { avisaLead } from './_aviso-cym.js';

const INICIO = '2026-11-03T18:48:00Z'; // nada anterior a esta fecha se avisa
const ESPERA_MS = 60 * 60 * 1000;
const G = 'https://graph.facebook.com/v25.0/';
const SB = () => ({ apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' });
const normal = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function api(ruta, q = {}) {
  const u = new URL(G + ruta);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + process.env.META_PAGE_TOKEN } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(ruta.split('/').pop() + ' ' + r.status + ' ' + (d.error?.message || ''));
  return d;
}

// Devuelve [{ plataforma, contacto_id, nombre, origen, mensajes:[{mid,fecha,texto,saliente}], contexto }]
async function leeMessenger(desde, errores) {
  const pag = process.env.META_PAGE_ID, out = [];
  const { data = [] } = await api(pag + '/conversations', { fields: 'updated_time,participants', limit: 25 });
  for (const c of data.filter(c => new Date(c.updated_time) >= desde)) {
    try {
      const { data: ms = [] } = await api(c.id + '/messages', { fields: 'id,created_time,from{id,name},message', limit: 25 });
      const otro = (c.participants?.data || []).find(p => p.id !== pag);
      if (!otro) continue;
      out.push({ plataforma: 'messenger', contacto_id: otro.id, nombre: otro.name || null, origen: 'mensaje', contexto: '',
        mensajes: ms.filter(m => new Date(m.created_time) >= desde).map(m => ({ mid: m.id, fecha: m.created_time, texto: m.message || '', saliente: m.from?.id === pag })) });
    } catch (e) { errores.push(e.message); }
  }
  return out;
}
async function leeComentariosFb(desde) {
  const pag = process.env.META_PAGE_ID, out = [];
  const { data = [] } = await api(pag + '/feed', { fields: 'message,comments.limit(50){id,from{id,name},message,created_time}', limit: 15 });
  for (const p of data) for (const c of p.comments?.data || []) {
    if (c.from?.id === pag || new Date(c.created_time) < desde || !comentarioVale(c.message)) continue;
    out.push({ plataforma: 'messenger', contacto_id: c.from?.id || 'fb_' + c.id, nombre: c.from?.name || null, origen: 'comentario', contexto: p.message || '',
      mensajes: [{ mid: 'c_' + c.id, fecha: c.created_time, texto: c.message, comentario: true }] });
  }
  return out;
}
async function leeComentariosIg(desde) {
  const out = [];
  const { data = [] } = await api(process.env.META_IG_ID + '/media', { fields: 'caption,comments.limit(50){id,from{id,username},text,timestamp}', limit: 15 });
  for (const p of data) for (const c of p.comments?.data || []) {
    if (c.from?.id === process.env.META_IG_ID || new Date(c.timestamp) < desde || !comentarioVale(c.text)) continue;
    out.push({ plataforma: 'instagram', contacto_id: c.from?.id || 'ig_' + c.id, nombre: c.from?.username || null, origen: 'comentario', contexto: p.caption || '',
      mensajes: [{ mid: 'c_' + c.id, fecha: c.timestamp, texto: c.text, comentario: true }] });
  }
  return out;
}

// Junta por persona lo que dijo y arma los datos del lead.
export function armaLead(l, previos, catalogo) {
  const entrantes = l.mensajes.filter(m => !m.saliente && m.texto);
  const texto = entrantes.map(m => m.texto).join(' \n ');
  const n = normal(texto);
  let d = { ...previos, origen: previos.origen || l.origen };
  d.nombre = d.nombre || l.nombre;
  d.telefono = buscaTelefono(texto) || d.telefono || null;
  const cod = buscaCodigo(texto, catalogo) || buscaCodigo(l.contexto, catalogo) || d.codigo;
  if (cod) d = fichaEn(d, cod, catalogo);
  d.comuna = d.comuna || buscaComuna(texto) || buscaComuna(l.contexto) || null;
  const tipoEn = x => /\b(depto|departamento)\b/.test(x) ? 'Departamento' : /\bcasa\b/.test(x) ? 'Casa' : null;
  if (!d.tipo) d.tipo = tipoEn(n) || tipoEn(normal(l.contexto));
  if (!d.operacion) d.operacion = /arriend|alquil/.test(n) ? 'Arriendo' : /vender|tasar|tasacion/.test(n) ? 'Venta' : /compr/.test(n) ? 'Compra' : null;
  const c = entrantes.find(m => m.comentario);
  if (c) d.comentario = c.texto.slice(0, 300);
  d.consulta = texto.slice(0, 500);
  d.director = directorDe(d);
  d.tema = tema(d);
  return d;
}
export function decideAviso(d, primerMs, ahora) {
  if (d.telefono && !d.avisado_tel) return 'telefono';
  if (!d.telefono && !d.avisado && ahora - primerMs >= ESPERA_MS) return 'sin_telefono';
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex');
  // Sin clave: solo dispara una revisión idempotente y responde conteos, nunca datos de personas.
  const seco = req.query.seco === '1'; // solo cuenta: no guarda ni envía
  const prueba_ = req.query.prueba === '1'; // revisa UN lead real con teléfono: correo solo a Christopher y luego borra lo guardado
  const desde = new Date((seco || prueba_) && req.query.desde ? req.query.desde : INICIO);
  const catalogo = (() => { try { return JSON.parse(readFileSync(join(process.cwd(), 'data', 'propiedades-catalogo.json'), 'utf8')).codigos || {}; } catch { return {}; } })();
  const errores = [], fuentes = {};
  const lee = async (nombre, fn) => { try { const x = await fn(); fuentes[nombre] = x.length; return x; } catch (e) { errores.push(nombre + ': ' + e.message); fuentes[nombre] = 'error'; return []; } };
  const leidos = [...await lee('messenger', () => leeMessenger(desde, errores)), ...await lee('comentarios_fb', () => leeComentariosFb(desde)), ...await lee('comentarios_ig', () => leeComentariosIg(desde))];

  const porPersona = {};
  for (const l of leidos) {
    const k = l.plataforma + '|' + l.contacto_id;
    const p = porPersona[k] ||= { ...l, mensajes: [] };
    p.mensajes.push(...l.mensajes);
    if (l.origen === 'mensaje') p.origen = 'mensaje';
    p.contexto = [p.contexto, l.contexto].filter(Boolean).join(' ');
  }
  const prueba = (process.env.META_BOT_PRUEBA || '').split(',').map(x => x.trim());
  const resumen = { fuentes, personas: 0, guardados: 0, avisos: 0, con_telefono: 0, errores };
  const ahora = Date.now();
  let personas = Object.values(porPersona);
  if (prueba_) personas = personas.filter(l => armaLead(l, {}, catalogo).telefono).slice(0, 1);
  for (const l of personas) {
    if (!l.mensajes.some(m => !m.saliente && m.texto)) continue;
    resumen.personas++;
    const primer = Math.min(...l.mensajes.filter(m => !m.saliente).map(m => new Date(m.fecha).getTime()));
    const q = `?cliente=eq.cym&plataforma=eq.${l.plataforma}&contacto_id=eq.${encodeURIComponent(l.contacto_id)}&select=*`;
    if (seco) { if (armaLead(l, {}, catalogo).telefono) resumen.con_telefono++; continue; }
    if (!prueba_ && prueba.includes(l.contacto_id)) continue; // cuentas de prueba: las atiende el agente por webhook
    try {
      const rc = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones' + q, { headers: SB() });
      const previa = (await rc.json())[0];
      const d = armaLead(l, previa?.datos || {}, catalogo);
      if (d.telefono) resumen.con_telefono++;
      const filas = l.mensajes.map(m => ({ cliente: 'cym', plataforma: l.plataforma, cuenta_id: l.plataforma === 'instagram' ? process.env.META_IG_ID : process.env.META_PAGE_ID, contacto_id: l.contacto_id, direccion: m.saliente ? 'saliente' : 'entrante', enviado_en: new Date(m.fecha).toISOString(), mid: m.mid, texto: (m.comentario ? '[comentario] ' : '') + (m.texto || ''), codigo: m.saliente ? null : buscaCodigo(m.texto, catalogo), raw: {} }));
      const rm = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_mensajes?on_conflict=mid', { method: 'POST', headers: { ...SB(), Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(filas) });
      const nuevasFilas = rm.ok ? await rm.json() : [];
      if (rm.ok) resumen.guardados += nuevasFilas.length; else errores.push('guardar mensajes ' + rm.status);
      const aviso = decideAviso(d, primer, ahora);
      const estado = d.telefono ? 'completo' : (previa?.estado === 'humano' ? 'humano' : 'abierto');
      if (aviso) {
        await avisaLead({ estado, datos: d }, l.plataforma, prueba_);
        resumen.avisos++;
        d.avisado = true;
        if (aviso === 'telefono') d.avisado_tel = true;
      }
      const rg = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones?on_conflict=cliente,plataforma,contacto_id', { method: 'POST', headers: { ...SB(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ cliente: 'cym', plataforma: l.plataforma, contacto_id: l.contacto_id, nodo: 'sondeo', estado, intentos: 0, datos: d, ultimo_bot: previa?.ultimo_bot ?? null, actualizado_en: new Date().toISOString() }) });
      if (!rg.ok) errores.push('guardar lead ' + rg.status);
      if (prueba_) {
        const rl = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones' + q, { headers: SB() });
        const g = (await rl.json())[0]?.datos || {};
        resumen.prueba = { lead_guardado: !!g.telefono, director: g.director, comuna: g.comuna || null, tema: g.tema, plataforma: l.plataforma, avisado: !!g.avisado_tel };
        if (nuevasFilas.length) await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_mensajes?mid=in.(' + nuevasFilas.map(f => '"' + f.mid + '"').join(',') + ')', { method: 'DELETE', headers: SB() });
        if (!previa) await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones' + q, { method: 'DELETE', headers: SB() });
      }
    } catch (e) { errores.push('lead: ' + e.message); }
  }
  console.log('sondeo', JSON.stringify(resumen));
  res.status(200).json(resumen);
}
