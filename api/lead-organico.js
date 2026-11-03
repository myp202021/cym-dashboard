// Formulario de datos de leads orgánicos de CyM (enlace en las respuestas automáticas de Instagram y Facebook).
// Guarda el lead en el panel y avisa por correo al director de su comuna, igual que los leads pagados.
import { randomUUID } from 'node:crypto';
import { buscaTelefono, directorDe, tema } from './_bot-cym.js';
import { avisaLead } from './_aviso-cym.js';

const SB = () => ({ apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' });
const COMUNAS = ['Las Condes', 'Vitacura', 'La Dehesa', 'La Reina', 'San Carlos de Apoquindo', 'Sin definir'];
const TIPOS = ['Casa', 'Departamento'];
const OPERACIONES = ['Compra', 'Arriendo', 'Venta'];
const limpio = (t, n) => String(t ?? '').trim().slice(0, n);

export function armaFormulario(b) {
  const nombre = limpio(b.nombre, 80), telefono = buscaTelefono(b.telefono);
  if (nombre.length < 2) return { error: 'Escribe tu nombre.' };
  if (!telefono) return { error: 'Revisa el teléfono: son 9 dígitos, por ejemplo 9 1234 5678.' };
  const d = { origen: 'formulario', nombre, telefono,
    comuna: COMUNAS.includes(b.comuna) ? b.comuna : 'Sin definir',
    tipo: TIPOS.includes(b.tipo) ? b.tipo : null,
    operacion: OPERACIONES.includes(b.operacion) ? b.operacion : null,
    codigo: /^\d{4,5}$/.test(limpio(b.codigo, 5)) ? limpio(b.codigo, 5) : null,
    consulta: limpio(b.consulta, 500) || null };
  d.director = directorDe(d);
  d.tema = tema(d);
  return { d };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};
  if (b.web) return res.status(200).json({ ok: true }); // trampa para robots
  const { d, error } = armaFormulario(b);
  if (error) return res.status(400).json({ error });
  const prueba = b.prueba === true;
  const contacto_id = 'form_' + d.telefono;
  const q = `?cliente=eq.cym&plataforma=eq.instagram&contacto_id=eq.${encodeURIComponent(contacto_id)}`;
  try {
    const previa = (await (await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones' + q + '&select=datos,actualizado_en', { headers: SB() })).json())[0];
    const repetido = previa && Date.now() - new Date(previa.actualizado_en).getTime() < 10 * 60 * 1000;
    const rg = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones?on_conflict=cliente,plataforma,contacto_id', { method: 'POST', headers: { ...SB(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ cliente: 'cym', plataforma: 'instagram', contacto_id, nodo: 'formulario', estado: 'completo', intentos: 0, datos: d, ultimo_bot: null, actualizado_en: new Date().toISOString() }) });
    if (!rg.ok) throw new Error('guardar lead ' + rg.status);
    const texto = [`[formulario] ${d.tema}`, d.consulta].filter(Boolean).join(' · ');
    const rm = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_mensajes', { method: 'POST', headers: { ...SB(), Prefer: 'return=minimal' }, body: JSON.stringify({ cliente: 'cym', plataforma: 'instagram', cuenta_id: process.env.META_IG_ID, contacto_id, direccion: 'entrante', enviado_en: new Date().toISOString(), mid: 'f_' + randomUUID(), texto, codigo: d.codigo, raw: {} }) });
    if (!rm.ok) throw new Error('guardar mensaje ' + rm.status);
    if (!repetido) await avisaLead({ estado: 'completo', datos: d }, 'instagram', prueba);
    if (prueba) {
      const lee = await (await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones' + q + '&select=datos', { headers: SB() })).json();
      const guardado = lee[0]?.datos?.telefono === d.telefono;
      await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_mensajes' + q, { method: 'DELETE', headers: SB() });
      await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones' + q, { method: 'DELETE', headers: SB() });
      return res.status(200).json({ ok: true, guardado, director: d.director, correo: !repetido });
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('lead-organico', e.message);
    res.status(500).json({ error: 'No pudimos enviar tus datos. Intenta de nuevo en un momento.' });
  }
}
