// Aviso por correo de cada lead orgánico de Instagram y Facebook al director de su comuna (mismos destinos que los leads pagados).
import nodemailer from 'nodemailer';

const CORREOS = {
  'Anita Hernández': 'anamaria@cympropiedades.cl',
  'María Eugenia Olave': 'eolave@cympropiedades.cl',
  'Alejandro Ceballos': 'acy@cympropiedades.cl',
  'Benjamín Ceballos': 'Bcf@cympropiedades.cl',
  'James Robeson': 'jrobeson@cympropiedades.cl',
  'Caro Paoletti': 'Cpaoletti@cympropiedades.cl',
};
const CENTRAL = 'contacto@cympropiedades.cl';
const COPIA = 'contacto@mulleryperez.cl';
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function correoDe(conv, plataforma, prueba = false, correoPrueba = '') {
  const d = conv.datos || {};
  const red = plataforma === 'instagram' ? 'Instagram' : 'Facebook';
  const origen = `${red} · ${d.origen === 'comentario' ? 'comentario' : 'mensaje'} (orgánico)`;
  const quien = d.nombre || 'Sin nombre';
  const filas = [['Origen', origen], ['Nombre', d.nombre], ['Teléfono', d.telefono], ['Tema', d.tema], ['Código', d.codigo], ['Tipo', d.tipo], ['Comuna', d.comuna], ['Precio', d.precio], ['Consulta', d.consulta], ['Comentario', d.comentario], ['Director', d.director]]
    .filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280">${k}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`).join('');
  const nota = conv.estado === 'humano' ? '<p style="color:#b91c1c;font-weight:700">Pidió hablar con una persona: responder por el chat de ' + red + '.</p>'
    : d.telefono ? '' : '<p style="color:#b91c1c;font-weight:700">No dejó teléfono: responder por el chat de ' + red + '.</p>';
  const wa = d.telefono ? `<p><a href="https://wa.me/${d.telefono.replace(/\D/g, '')}" style="background:#25D366;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Contactar por WhatsApp</a></p>` : '';
  const ficha = d.url ? `<p><a href="${esc(d.url)}">Ver ficha de la propiedad</a></p>` : '';
  const destino = CORREOS[d.director] || CENTRAL;
  const prefijo = prueba ? '[PRUEBA] ' : '';
  return {
    to: prueba ? correoPrueba : destino,
    cc: prueba ? undefined : COPIA,
    subject: `${prefijo}Nuevo lead orgánico ${red} — ${d.comuna && d.comuna !== 'Sin definir' ? d.comuna : 'CyM'} — ${quien}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:560px">${prueba ? `<p style="color:#b91c1c;font-weight:700">Prueba de M&amp;P. En real iría a ${esc(destino)}.</p>` : ''}<h2 style="margin:0 0 12px">Nuevo lead de ${red}</h2>${nota}<table style="border-collapse:collapse">${filas}</table>${wa}${ficha}<p style="color:#6b7280;font-size:12px">Datos recogidos por el asistente de CyM Propiedades · M&amp;P</p></div>`,
  };
}

export async function avisaLead(conv, plataforma, prueba) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('faltan GMAIL_USER / GMAIL_APP_PASSWORD');
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  await t.sendMail({ from: `"Leads CyM · M&P" <${process.env.GMAIL_USER}>`, ...correoDe(conv, plataforma, prueba, process.env.GMAIL_USER) });
}
