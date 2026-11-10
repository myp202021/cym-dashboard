// CyM — avisa por correo al director de su comuna los leads orgánicos CON TELÉFONO de la lista de CyM (comentarios y DMs
// que CyM junta en CONTACTOS CYM-<MES>.xlsx). Mismo correo que los formularios (api/_aviso-cym.js), cc contacto@ M&P.
// Corre después de build.py <MES>, que deja raw/organico-detalle-<MES>.json. Un aviso por teléfono, para siempre:
// el registro raw/organico-avisados.json (local, fuera de git: trae solo un hash del teléfono) evita repetir.
//
//   node scripts/seguimiento/avisar-organico.mjs AAAA-MM            → avisa los nuevos
//   node scripts/seguimiento/avisar-organico.mjs AAAA-MM --prueba   → todos los nuevos, solo a christopher@ (no marca)
//   node scripts/seguimiento/avisar-organico.mjs AAAA-MM --marcar   → marca los actuales como avisados sin enviar
//   node scripts/seguimiento/avisar-organico.mjs AAAA-MM --seco     → solo muestra qué haría
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { correoDe } from '../../api/_aviso-cym.js';
import { directorDe, tema } from '../../api/_bot-cym.js';

// APAGADO 10 nov 2026 (Christopher): el orgánico lo envían Nicole y Greta por WhatsApp al director. Reactivar con AVISO_ORGANICO_CORREO=1.
if (process.env.AVISO_ORGANICO_CORREO !== '1') { console.log('Apagado: el orgánico lo envían Nicole y Greta por WhatsApp (ver protocolo).'); process.exit(0); }

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAW = join(AQUI, 'raw');
const REG = join(RAW, 'organico-avisados.json');
const [MES, modo = ''] = process.argv.slice(2);
if (!/^\d{4}-\d{2}$/.test(MES || '')) { console.error('Uso: avisar-organico.mjs AAAA-MM [--prueba|--marcar|--seco]'); process.exit(1); }

const det = JSON.parse(readFileSync(join(RAW, `organico-detalle-${MES}.json`), 'utf8'));
const cat = JSON.parse(readFileSync(join(AQUI, '../../data/propiedades-catalogo.json'), 'utf8')).codigos || {};
const reg = existsSync(REG) ? JSON.parse(readFileSync(REG, 'utf8')) : {};
const clave = tel => createHash('sha256').update(String(tel).replace(/\D/g, '').slice(-9)).digest('hex').slice(0, 20);
const tel = t => { const d = String(t || '').replace(/\D/g, ''); return d.length === 9 ? '+56' + d : d.length === 11 && d.startsWith('56') ? '+' + d : d.length === 8 ? '+569' + d : d ? '+' + d : ''; };
const COMUNAS = { 'San Carlos de Apoquindo': 'San Carlos de Apoquindo', SCA: 'San Carlos de Apoquindo', 'Las Condes': 'Las Condes', Vitacura: 'Vitacura', 'La Dehesa': 'La Dehesa', 'Lo Barnechea': 'La Dehesa', 'La Reina': 'La Reina' };

const nuevos = det.filas.filter(f => f.estado === 'Con contacto' && f.celular && !reg[clave(f.celular)]);
console.log(`${MES}: ${det.filas.filter(f => f.celular).length} con teléfono, ${nuevos.length} sin aviso previo (modo ${modo || 'real'})`);
let enviados = 0;
for (const f of modo === '--prueba' ? nuevos.slice(0, 1) : nuevos) { // en prueba, uno solo
  const ficha = f.codigo && cat[f.codigo] ? cat[f.codigo] : {};
  const d = { origen: 'lista', nombre: f.nombre, telefono: tel(f.celular), codigo: f.codigo || null, comuna: COMUNAS[f.comuna] || COMUNAS[f.lista_comuna] || null,
    tipo: ficha.tipo || (/^depto/i.test(f.lista_comuna || '') ? 'Depto' : f.tipo !== 'Sin dato' ? f.tipo : null), precio: ficha.precio, url: ficha.url };
  d.director = directorDe(d); d.tema = tema(d);
  const c = correoDe({ estado: 'completo', datos: d }, 'instagram', modo === '--prueba', 'christopher@mulleryperez.cl');
  c.subject = c.subject.replace('Nuevo lead orgánico Instagram', 'Nuevo lead orgánico (lista CyM) Instagram');
  console.log(`  ${f.fecha} ${d.director} → ${c.to} · ${c.subject}`);
  if (modo === '--seco') continue;
  if (modo !== '--marcar') {
    const dir = mkdtempSync(join(tmpdir(), 'cym-aviso-')), html = join(dir, 'a.html');
    writeFileSync(html, c.html);
    const args = [join(homedir(), 'bin/google.js'), 'enviar', 'christopher', '--para', c.to, '--asunto', c.subject, '--html', html];
    if (c.cc) args.push('--cc', c.cc);
    execFileSync('node', args, { stdio: 'inherit' });
    enviados++;
  }
  if (modo !== '--prueba') { reg[clave(f.celular)] = { mes: MES, fecha: f.fecha, avisado: new Date().toISOString(), modo: modo || 'real' }; writeFileSync(REG, JSON.stringify(reg, null, 1)); }
}
console.log(`listo: ${enviados} correos${modo === '--marcar' ? ', ' + nuevos.length + ' marcados sin enviar' : ''}`);
