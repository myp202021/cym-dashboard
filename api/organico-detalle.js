// Detalle orgánico por contacto (nombres y teléfonos) — PRIVADO, detrás de clave.
// El detalle viaja cifrado en privado/organico-detalle.enc (AES-256-GCM) y solo esta función lo descifra.
// Env (Vercel production): CYM_PANEL_PASSWORD (clave del panel), CYM_DETALLE_KEY (hex 32 bytes), CYM_COOKIE_SECRET.
//   POST ?accion=login  {clave}  → cookie firmada 30 días
//   POST ?accion=salir           → borra la cookie
//   GET  ?accion=estado          → {autenticado}
//   GET  ?mes=AAAA-MM[&formato=csv]  → filas del mes (401 sin cookie)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'cym_panel';
const DIAS = 30;

function firma(exp) {
  return createHmac('sha256', process.env.CYM_COOKIE_SECRET || '').update('cym-panel:' + exp).digest('hex');
}
function iguales(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function autenticado(req) {
  const m = (req.headers.cookie || '').match(new RegExp(COOKIE + '=([^;]+)'));
  if (!m || !process.env.CYM_COOKIE_SECRET) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  return Number(exp) > Date.now() && iguales(sig || '', firma(exp));
}
function detalle() {
  const enc = JSON.parse(readFileSync(join(process.cwd(), 'privado', 'organico-detalle.enc'), 'utf8'));
  const d = createDecipheriv('aes-256-gcm', Buffer.from(process.env.CYM_DETALLE_KEY || '', 'hex'), Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(enc.data, 'base64')), d.final()]).toString('utf8'));
}
async function cuerpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}
const csvCelda = v => /[",\n;]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? '');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const accion = req.query.accion;

  if (accion === 'login' && req.method === 'POST') {
    const { clave } = await cuerpo(req);
    if (!process.env.CYM_PANEL_PASSWORD || !iguales(clave || '', process.env.CYM_PANEL_PASSWORD)) {
      await new Promise(r => setTimeout(r, 600));
      return res.status(401).json({ error: 'Clave incorrecta' });
    }
    const exp = String(Date.now() + DIAS * 864e5);
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(exp + '.' + firma(exp))}; Path=/; Max-Age=${DIAS * 86400}; HttpOnly; Secure; SameSite=Lax`);
    return res.status(200).json({ ok: true });
  }
  // Link directo para el equipo CyM (sin escribir clave): GET ?accion=entrar&t=<token> → cookie 1 año y vuelve al panel.
  // token = HMAC(CYM_COOKIE_SECRET, 'cym-acceso-directo'); para invalidar todos los links, cambiar CYM_COOKIE_SECRET.
  if (accion === 'entrar') {
    const ok = process.env.CYM_COOKIE_SECRET &&
      iguales(String(req.query.t || ''), createHmac('sha256', process.env.CYM_COOKIE_SECRET).update('cym-acceso-directo').digest('hex'));
    if (ok) {
      const exp = String(Date.now() + 365 * 864e5);
      res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(exp + '.' + firma(exp))}; Path=/; Max-Age=${365 * 86400}; HttpOnly; Secure; SameSite=Lax`);
    }
    const destino = /^#[a-z]+$/.test(String(req.query.ir || '')) ? req.query.ir : '#vitacura';
    res.setHeader('Location', '/seguimiento' + destino);
    return res.status(302).end();
  }
  if (accion === 'salir') {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    return res.status(200).json({ ok: true });
  }
  if (accion === 'estado') return res.status(200).json({ autenticado: autenticado(req) });

  // 13-oct-2026: sin clave por pedido de Christopher
  const mes = String(req.query.mes || '');
  if (mes !== 'todos' && !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'mes=AAAA-MM o todos' });
  let filas;
  // mes=todos → acumulado de todos los meses (cada fila con su mes)
  try { const m = detalle().meses; filas = mes === 'todos' ? Object.keys(m).sort().flatMap(k => m[k].map(f => ({ ...f, mes: k }))) : (m[mes] || []); } catch (e) { return res.status(500).json({ error: 'No se pudo leer el detalle' }); }

  if (req.query.formato === 'csv') {
    const cols = ['fecha', 'estado', 'nombre', 'celular', 'codigo', 'tipo', 'comuna', 'lista_comuna', 'revisar'];
    const csv = '﻿' + ['Fecha;Estado;Nombre;Celular;Código;Tipo;Comuna;Comuna en lista CyM;Revisar celular', ...filas.map(f => cols.map(c => c === 'revisar' ? (f[c] ? 'sí' : '') : csvCelda(f[c])).join(';'))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cym-organico-${mes}.csv"`);
    return res.status(200).send(csv);
  }
  return res.status(200).json({ mes, filas });
}
