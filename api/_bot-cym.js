// Motor de conversación de CyM para Instagram y Messenger. Sin red ni base de datos: recibe estado y texto, devuelve estado y respuesta.
const normal = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const COMUNAS = [['san carlos', 'San Carlos de Apoquindo'], ['las condes', 'Las Condes'], ['condes', 'Las Condes'], ['vitacura', 'Vitacura'],
  ['dehesa', 'La Dehesa'], ['barnechea', 'La Dehesa'], ['reina', 'La Reina']];
const MENU = '¿En qué te ayudo?\n\n1. Comprar una propiedad\n2. Arrendar una propiedad\n3. Vender o tasar mi propiedad\n4. Tengo un código de propiedad\n5. Otra consulta';
const P_COMUNA = '¿En qué zona buscas?\n\n1. Las Condes\n2. Vitacura\n3. La Dehesa\n4. La Reina\n5. San Carlos de Apoquindo\n6. Aún no lo sé';
const P_TIPO = '¿Buscas casa o departamento?\n\n1. Casa\n2. Departamento';
const P_NOMBRE = '¿Cómo te llamas?';
const P_TELEFONO = 'Gracias, {nombre}. ¿A qué teléfono te puede llamar el director de CyM? (ej: +56 9 1234 5678)';
const P_TELEFONO_DE_NUEVO = 'No alcancé a entender ese número. ¿Me lo escribes de nuevo con el 9 adelante? (ej: 9 1234 5678)';
const FIN = '¡Listo, {nombre}! El director de CyM a cargo te va a contactar a la brevedad. Gracias por escribir a CyM Propiedades 🏠';
const P_TELEFONO_ULTIMO = 'Sin tu teléfono el director de CyM no te puede llamar. Cuando quieras, escríbelo aquí y te contactamos a la brevedad (ej: 9 1234 5678).';
const HUMANO = 'Perfecto, le paso tu mensaje al equipo de CyM y te responden por aquí mismo.';

const elige = (t, opciones) => {
  const n = normal(t), num = n.match(/^\s*(\d)\b/);
  if (num && opciones[+num[1] - 1]) return opciones[+num[1] - 1].v;
  for (const o of opciones) if (o.k.some(k => n.includes(k))) return o.v;
  return null;
};
const OP = [{ v: 'Compra', k: ['comprar', 'compra'] }, { v: 'Arriendo', k: ['arrendar', 'arriendo', 'alquil'] },
  { v: 'Venta', k: ['vender', 'venta', 'tasar', 'tasacion', 'publicar'] }, { v: 'Código', k: ['codigo'] }, { v: 'Otra consulta', k: ['otra', 'consulta', 'informacion'] }];
const TIPO = [{ v: 'Casa', k: ['casa'] }, { v: 'Departamento', k: ['depto', 'departamento'] }];
const ZONAS = ['Las Condes', 'Vitacura', 'La Dehesa', 'La Reina', 'San Carlos de Apoquindo', 'Sin definir'];

export function buscaCodigo(texto, catalogo) {
  return (String(texto || '').match(/\b\d{4,5}\b/g) || []).find(c => catalogo[c]) || null;
}
export function buscaTelefono(texto) {
  // Celular (9) o fijo (2) de Chile: 9 dígitos exactos, con o sin +56. Un dígito de más no se acepta.
  const m = String(texto || '').match(/(?<![\d])(?:\+?56[\s.-]*)?([29](?:[\s.-]*\d){8})(?![\s.-]*\d)/);
  return m ? '+56' + m[1].replace(/\D/g, '') : null;
}
export const buscaComuna = t => { const n = normal(t); const c = COMUNAS.find(([k]) => n.includes(k)); return c ? c[1] : null; };

export function directorDe(d) {
  if (/^dep/i.test(d.tipo || '')) return 'Caro Paoletti'; // el catálogo trae 'Depto', el bot 'Departamento'
  return { 'Las Condes': 'Anita Hernández', 'La Reina': 'James Robeson', Vitacura: 'Alejandro Ceballos', 'La Dehesa': 'María Eugenia Olave', 'San Carlos de Apoquindo': 'Benjamín Ceballos' }[d.comuna] || 'el equipo de CyM';
}
export const tema = d => d.codigo ? 'Propiedad ' + d.codigo : [d.operacion, d.tipo, d.comuna && d.comuna !== 'Sin definir' ? d.comuna : null].filter(Boolean).join(' · ') || 'Consulta general';
const relleno = (s, d) => s.replace(/\{(\w+)\}/g, (_, k) => d[k] ?? '');

export function fichaEn(datos, codigo, catalogo) {
  const f = catalogo[codigo] || {};
  return { ...datos, codigo, tipo: f.tipo || datos.tipo, comuna: buscaComuna(f.comuna) || f.comuna || datos.comuna, precio: f.precio, url: f.url, operacion: datos.operacion || f.operacion };
}
function presentaFicha(d) {
  const que = [d.tipo ? d.tipo.toLowerCase() : 'propiedad', 'código ' + d.codigo, d.comuna ? 'en ' + d.comuna : null].filter(Boolean).join(' ');
  const precio = d.precio ? ' (' + d.precio.replace(/,00$/, '') + ')' : '';
  return `¡Hola! 👋 Gracias por escribir a CyM Propiedades por la ${que}${precio}.${d.url ? '\nFicha: ' + d.url : ''}\n\nPara que el director te contacte, ${P_NOMBRE.toLowerCase()}`;
}
function cerrar(datos) {
  const d = { ...datos, director: directorDe(datos) };
  d.tema = tema(d);
  return { nodo: 'fin', estado: 'completo', datos: d, responder: relleno(FIN, d) };
}
const seguir = (nodo, datos, responder) => ({ nodo, estado: 'abierto', datos: { ...datos, tema: tema(datos) }, responder });
const pideNombre = d => d.nombre ? (d.telefono ? cerrar(d) : seguir('telefono', d, relleno(P_TELEFONO, d))) : seguir('nombre', d, P_NOMBRE);

// conv: { nodo, estado, datos, intentos }. Devuelve { nodo, estado, datos, responder }; responder null = el bot no contesta.
export function responde(conv, texto, catalogo = {}) {
  if (conv && conv.estado && conv.estado !== 'abierto') return { ...conv, responder: null };
  const datos = { ...(conv?.datos || {}) };
  const tel = buscaTelefono(texto);
  if (tel) datos.telefono = tel;
  if (/\b(humano|persona|ejecutiv|asesor|corredor|hablar con)/.test(normal(texto)) && conv) return { nodo: conv.nodo, estado: 'humano', datos: { ...datos, tema: tema(datos) }, responder: HUMANO };

  if (!conv) {
    const codigo = buscaCodigo(texto, catalogo);
    if (codigo) { const d = fichaEn(datos, codigo, catalogo); return seguir('nombre', d, presentaFicha(d)); }
    if (!/^(hola|buenas|buenos dias|buenas tardes|info|informacion)[\s!.,]*$/.test(normal(texto))) datos.consulta = String(texto || '').slice(0, 300);
    const op = elige(texto, OP.slice(0, 3));
    const comuna = buscaComuna(texto); if (comuna) datos.comuna = comuna;
    const tipo = elige(texto, TIPO); if (tipo) datos.tipo = tipo;
    if (op) return avanzaOp({ ...datos, operacion: op }, '¡Hola! 👋 Gracias por escribir a CyM Propiedades.\n\n');
    return seguir('menu', datos, '¡Hola! 👋 Gracias por escribir a CyM Propiedades.\n\n' + MENU);
  }

  const vacio = !String(texto || '').trim() || /^\[.*\]$/.test(String(texto).trim());
  if (vacio) return seguir(conv.nodo, datos, 'Por ahora solo puedo leer texto. ¿Me lo escribes, por favor?');

  switch (conv.nodo) {
    case 'menu': {
      const codigo = buscaCodigo(texto, catalogo);
      if (codigo) { const d = fichaEn(datos, codigo, catalogo); return pideNombre(d); }
      const op = elige(texto, OP);
      if (!op) { return conv.intentos ? seguir('consulta', { ...datos, operacion: 'Otra consulta' }, 'Cuéntame brevemente tu consulta.') : { ...seguir('menu', datos, 'Disculpa, no te entendí. Respóndeme con el número.\n\n' + MENU), intentos: 1 }; }
      if (op === 'Código') return seguir('codigo', { ...datos, operacion: undefined }, '¿Cuál es el código de la propiedad? (ej: 5721)');
      if (op === 'Otra consulta') return seguir('consulta', { ...datos, operacion: op }, 'Cuéntame brevemente tu consulta.');
      return avanzaOp({ ...datos, operacion: op }, '');
    }
    case 'codigo': {
      const c = buscaCodigo(texto, catalogo) || (String(texto).match(/\b\d{4,5}\b/) || [])[0];
      if (!c) return conv.intentos ? pideNombre({ ...datos, consulta: String(texto).slice(0, 300) }) : { ...seguir('codigo', datos, 'El código son 4 o 5 números, como 5721. ¿Lo tienes a mano?'), intentos: 1 };
      return pideNombre(fichaEn(datos, c, catalogo));
    }
    case 'tipo': {
      const t = elige(texto, TIPO);
      if (!t) return conv.intentos ? seguir('comuna', datos, P_COMUNA) : { ...seguir('tipo', datos, P_TIPO), intentos: 1 };
      const d = { ...datos, tipo: t };
      return d.comuna ? pideNombre(d) : seguir('comuna', d, P_COMUNA);
    }
    case 'comuna': {
      const n = normal(texto).match(/^\s*(\d)\b/);
      const c = n && ZONAS[+n[1] - 1] ? ZONAS[+n[1] - 1] : buscaComuna(texto) || (/no se|no lo se|aun no/.test(normal(texto)) ? 'Sin definir' : null);
      if (!c) return conv.intentos ? pideNombre({ ...datos, comuna: 'Sin definir' }) : { ...seguir('comuna', datos, P_COMUNA), intentos: 1 };
      return pideNombre({ ...datos, comuna: c });
    }
    case 'consulta': return pideNombre({ ...datos, consulta: String(texto).slice(0, 300) });
    case 'nombre': {
      const nombre = String(texto).replace(/[+\d()-]{7,}/g, '').replace(/^(soy|me llamo|mi nombre es)\s+/i, '').trim().slice(0, 60);
      if (!nombre) return seguir('nombre', datos, P_NOMBRE);
      return pideNombre({ ...datos, nombre });
    }
    case 'telefono': {
      if (datos.telefono) return cerrar(datos);
      // Sin teléfono no hay lead: insiste y deja la conversación abierta, por si lo escribe después.
      const n = conv.intentos || 0;
      if (n >= 2) return { ...seguir('telefono', datos, null), intentos: n };
      return { ...seguir('telefono', datos, n === 1 ? P_TELEFONO_ULTIMO : P_TELEFONO_DE_NUEVO), intentos: n + 1 };
    }
    default: return { ...conv, responder: null };
  }
}
function avanzaOp(d, saludo) {
  if (d.operacion === 'Venta') return d.comuna ? pideNombreCon(d, saludo) : seguir('comuna', d, saludo + '¿En qué zona está tu propiedad?\n\n1. Las Condes\n2. Vitacura\n3. La Dehesa\n4. La Reina\n5. San Carlos de Apoquindo\n6. Otra');
  if (!d.tipo) return seguir('tipo', d, saludo + P_TIPO);
  return d.comuna ? pideNombreCon(d, saludo) : seguir('comuna', d, saludo + P_COMUNA);
}
function pideNombreCon(d, saludo) { const r = pideNombre(d); return { ...r, responder: saludo + r.responder }; }

// Comentarios de Instagram (field comments) o Facebook (field feed). null si no corresponde atenderlo.
export function comentarioDe(plataforma, cuentaId, cambio, propias = []) {
  const v = cambio?.value; if (!v) return null;
  let c = null;
  if (plataforma === 'instagram' && cambio.field === 'comments') c = { id: v.id, texto: v.text, autor: v.from?.id, publicacion: v.media?.id };
  if (plataforma === 'messenger' && cambio.field === 'feed' && v.item === 'comment' && v.verb === 'add') c = { id: v.comment_id, texto: v.message, autor: v.from?.id, publicacion: v.post_id };
  if (!c || !c.id || !c.autor) return null;
  if ([String(cuentaId), ...propias.map(String)].includes(String(c.autor))) return null; // comentario de la propia cuenta
  return c;
}
// Solo emojis o menciones a amigos no ameritan un mensaje privado.
// ¿El comentario pide algo? "Precioso", emojis o quejas no son leads.
export function esConsulta(texto) {
  const n = normal(texto);
  if (buscaTelefono(texto) || n.includes('?') || n.includes('¿')) return true;
  return /\b(info|informacion|detalle|detalles|precio|valor|cuanto|cuesta|vale|visita|visitar|verla|verlo|agendar|direccion|ubicacion|donde|sector|interesa|interesada|interesado|disponible|metros|m2|dormitorios|codigo|contacto|contactar|datos|whatsapp|telefono|comprar|vender|tasar|tasacion|dm|interno)\b/.test(n);
}
export function comentarioVale(texto) {
  const limpio = String(texto || '').replace(/@[\w.]+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  return limpio.length >= 2;
}
// Respuesta inicial a un comentario: si la publicación menciona un código del catálogo, la conversación parte con esa propiedad.
export function respondeComentario(texto, textoPublicacion, catalogo = {}) {
  const enComentario = buscaCodigo(texto, catalogo);
  const codigo = enComentario || buscaCodigo(textoPublicacion, catalogo);
  const r = responde(null, codigo && !enComentario ? `${codigo} ${texto}` : texto, catalogo);
  return {
    ...r,
    datos: { ...r.datos, origen: 'comentario', comentario: String(texto || '').slice(0, 300) },
    responder: r.responder.replace('Gracias por escribir a CyM Propiedades', 'Gracias por tu comentario en CyM Propiedades'),
  };
}
