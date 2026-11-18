// Piloto Reel Ale (18–28 nov 2026): leads de los 2 formularios de Meta (uno por reel).
// GET /api/piloto-reel                     → JSON para el panel (#reel-ale)
// GET /api/piloto-reel?formato=csv&reel=regularizacion|terreno&comuna=vitacura|lo_barnechea|las_condes|sca|la_reina|otra|todas
//                                          → CSV para las planillas de Drive (IMPORTDATA)
const FORMS = {
  regularizacion: { id: '1837022160832128', nombre: 'Lo no regularizado baja el precio' },
  terreno: { id: '2416991735374420', nombre: 'Terreno y casa' },
}
const COMUNAS = {
  vitacura: 'Vitacura', lo_barnechea: 'Lo Barnechea / La Dehesa', las_condes: 'Las Condes',
  sca: 'San Carlos de Apoquindo', la_reina: 'La Reina', otra: 'Otra comuna',
}
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
function comunaKey(v) {
  const n = norm(v)
  if (COMUNAS[n]) return n
  for (const [k, l] of Object.entries(COMUNAS)) if (norm(l) === n) return k
  if (n.includes('barnechea') || n.includes('dehesa')) return 'lo_barnechea'
  if (n.includes('san_carlos')) return 'sca'
  return n ? 'otra' : 'sin_dato'
}
const ETIQ = {
  casa: 'Casa', depto: 'Departamento', terreno: 'Terreno', si: 'Sí', no: 'No', no_se: 'No sé',
  ya: 'Lo antes posible', '3_6': 'En 3 a 6 meses', despues: 'Más adelante, solo quiere saber cuánto vale',
}
const lindo = v => ETIQ[norm(v)] || v || ''

async function leads(token, reel) {
  const out = []
  let url = `https://graph.facebook.com/v21.0/${FORMS[reel].id}/leads?fields=created_time,field_data,ad_name,is_organic&limit=500&access_token=${encodeURIComponent(token)}`
  while (url) {
    const r = await fetch(url).then(x => x.json())
    if (r.error) throw new Error(r.error.message)
    for (const l of r.data || []) {
      const f = Object.fromEntries((l.field_data || []).map(d => [d.name, (d.values || [])[0]]))
      const ck = comunaKey(f.comuna_propiedad)
      out.push({
        id: l.id,
        fecha: new Date(l.created_time).toLocaleString('sv-SE', { timeZone: 'America/Santiago' }).slice(0, 16),
        reel, reel_nombre: FORMS[reel].nombre, comuna_key: ck, comuna: COMUNAS[ck] || 'Sin dato',
        nombre: f.full_name || '', telefono: f.phone_number || '', email: f.email || '',
        tipo: lindo(f.tipo_propiedad), ampliacion: lindo(f.ampliacion), plazo: lindo(f.plazo_venta),
      })
    }
    url = r.paging && r.paging.next
  }
  return out
}

// Aviso por correo (pedido Christopher 18 nov): reel Regularización (Vitacura) → siempre Alejandro;
// reel Terreno y casa → director de la comuna que marcó el dueño; otra comuna → central CyM. Copia a M&P.
const DIRECTOR = {
  vitacura: ['Alejandro Ceballos', 'acy@cympropiedades.cl'], lo_barnechea: ['María Eugenia Olave', 'eolave@cympropiedades.cl'],
  las_condes: ['Anita Hernández', 'anamaria@cympropiedades.cl'], sca: ['Benjamín Ceballos', 'Bcf@cympropiedades.cl'],
  la_reina: ['James Robeson', 'jrobeson@cympropiedades.cl'],
}
const destino = l => l.reel === 'regularizacion' ? DIRECTOR.vitacura : (DIRECTOR[l.comuna_key] || ['Equipo CyM', 'contacto@cympropiedades.cl'])
const escH = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
function correo(l, prueba) {
  const [quien, para] = destino(l)
  const filas = [['Origen', `Anuncio Instagram · reel "${l.reel_nombre}" (formulario)`], ['Nombre', l.nombre], ['Teléfono', l.telefono], ['Correo', l.email],
    ['Comuna de la propiedad', l.comuna], ['Tipo de propiedad', l.tipo], ['Ampliación sin regularizar', l.reel === 'regularizacion' ? l.ampliacion : ''], ['Cuándo piensa vender', l.plazo], ['Fecha', l.fecha]]
    .filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280">${k}</td><td style="padding:6px 0;font-weight:600">${escH(v)}</td></tr>`).join('')
  const wa = l.telefono ? `<p><a href="https://wa.me/${l.telefono.replace(/\D/g, '')}" style="background:#25D366;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Escribirle por WhatsApp</a></p>` : ''
  return {
    to: prueba ? prueba : para, cc: prueba ? undefined : 'contacto@mulleryperez.cl',
    subject: `${prueba ? '[PRUEBA] ' : ''}Nuevo dueño para tasar — ${l.comuna} — ${l.nombre || 'Sin nombre'}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:560px">${prueba ? `<p style="color:#b91c1c;font-weight:700">Prueba de M&amp;P. En real iría a ${escH(quien)} (${escH(para)}).</p>` : ''}<p>Hola ${escH(quien.split(' ')[0])}:</p><p>Un dueño dejó sus datos para <b>tasar su propiedad sin costo</b> desde el piloto de reels de CyM en Instagram.</p><table style="border-collapse:collapse">${filas}</table>${wa}<p style="color:#6b7280;font-size:12px">Aviso automático de M&amp;P · Piloto Reel Ale (18–28 nov). Todos los leads: https://cym-dashboard-liart.vercel.app/seguimiento#reel-ale</p></div>`,
  }
}
async function avisar(token, prueba) {
  const nodemailer = (await import('nodemailer')).default
  const SB = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + (process.env.SUPABASE_SERVICE_ROLE_KEY), 'Content-Type': 'application/json' }
  const todos = (await Promise.all(Object.keys(FORMS).map(r => leads(token, r)))).flat()
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
  const enviados = []
  for (const l of todos) {
    if (prueba) { if (l.id !== prueba.id) continue } else {
      const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/meta_conversaciones?on_conflict=cliente,plataforma,contacto_id', { method: 'POST', headers: { ...SB, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([{ cliente: 'cym', plataforma: 'piloto_reel', contacto_id: l.id, estado: 'completo', datos: { reel: l.reel, comuna: l.comuna, director: destino(l)[0] } }]) })
      if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (await r.text()).slice(0, 200))
      if (!(await r.json()).length) continue
    }
    await t.sendMail({ from: `"Leads CyM · M&P" <${process.env.GMAIL_USER}>`, ...correo(l, prueba && prueba.para) })
    enviados.push({ id: l.id, a: prueba ? prueba.para : destino(l)[1] })
  }
  return { revisados: todos.length, enviados }
}

export default async function handler(req, res) {
  const token = process.env.META_TOKEN_MYP
  if (!token) return res.status(500).json({ error: 'Falta META_TOKEN_MYP' })
  try {
    const { formato, reel, comuna, accion } = req.query
    if (accion === 'avisar') return res.status(200).json(await avisar(token, req.query.prueba_id ? { id: req.query.prueba_id, para: 'christopher@mulleryperez.cl' } : null))
    const reels = reel && FORMS[reel] ? [reel] : Object.keys(FORMS)
    let todos = (await Promise.all(reels.map(r => leads(token, r)))).flat().sort((a, b) => b.fecha.localeCompare(a.fecha))
    if (comuna && comuna !== 'todas') todos = todos.filter(l => l.comuna_key === comuna)
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    if (formato === 'csv') {
      const cols = ['fecha', 'reel_nombre', 'comuna', 'nombre', 'telefono', 'email', 'tipo', 'ampliacion', 'plazo']
      const head = ['Fecha', 'Reel', 'Comuna de la propiedad', 'Nombre', 'Teléfono', 'Correo', 'Tipo de propiedad', 'Ampliación sin regularizar', 'Cuándo piensa vender']
      const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'
      const filas = todos.map(l => cols.map(c => q(c === 'ampliacion' && l.reel !== 'regularizacion' ? '—' : l[c])).join(','))
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      return res.status(200).send([head.map(q).join(','), ...(filas.length ? filas : [q('Aún no hay leads')])].join('\n'))
    }
    return res.status(200).json({ generado: new Date().toISOString(), forms: FORMS, comunas: COMUNAS, leads: todos })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
