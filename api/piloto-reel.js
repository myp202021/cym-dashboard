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

export default async function handler(req, res) {
  const token = process.env.META_TOKEN_MYP
  if (!token) return res.status(500).json({ error: 'Falta META_TOKEN_MYP' })
  try {
    const { formato, reel, comuna } = req.query
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
