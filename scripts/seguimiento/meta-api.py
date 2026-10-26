#!/usr/bin/env python3
"""
CyM — Baja el pagado de Meta por API (token META_TOKEN_MYP, usuario del sistema "Reportes") y deja
scripts/seguimiento/raw/cym-meta-<AAAA-MM>.json con el mismo formato que el export por Chrome.
Reemplaza la carga a mano desde Ads Manager (26 oct 2026).

Uso: python3 scripts/seguimiento/meta-api.py 2026-11   (sin argumento = mes en curso, hora de Chile)
"""
import json, os, subprocess, sys, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'scripts', 'seguimiento', 'raw')
CUENTA = 'act_2505215759834007'
ABR = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
HOY = (datetime.now(timezone.utc) - timedelta(hours=3)).date()
MES = sys.argv[1] if len(sys.argv) > 1 else HOY.strftime('%Y-%m')

def token():
    t = os.environ.get('META_TOKEN_MYP')
    if t: return t
    return subprocess.check_output(['security', 'find-generic-password', '-s', 'META_TOKEN_MYP', '-w']).decode().strip()

TK = token()

def insights(desde, hasta, level, diario=False):
    q = dict(level=level, time_range=json.dumps(dict(since=desde, until=hasta)), limit=500, access_token=TK,
             fields='campaign_name,adset_name,ad_name,spend,impressions,reach,clicks,actions')
    if diario: q['time_increment'] = 1
    url = f'https://graph.facebook.com/v21.0/{CUENTA}/insights?' + urllib.parse.urlencode(q)
    out = []
    while url:
        d = json.load(urllib.request.urlopen(url, timeout=60))
        out += d.get('data', [])
        url = d.get('paging', {}).get('next')
    return out

def accion(r, tipos):
    return sum(int(float(a['value'])) for a in r.get('actions') or [] if a['action_type'] in tipos)

def fila(r, ad=True):
    return dict(campana=r.get('campaign_name'), conjunto=r.get('adset_name') if ad else None, anuncio=r.get('ad_name') if ad else None,
                gasto=round(float(r.get('spend', 0))), impresiones=int(r.get('impressions', 0)), alcance=int(r.get('reach', 0)),
                clics=int(r.get('clicks', 0)),
                conv_wa=accion(r, ('onsite_conversion.messaging_conversation_started_7d',)),
                leads_form=accion(r, ('onsite_conversion.lead_grouped',)) or accion(r, ('lead',)),
                fecha=r.get('date_start'))

y, m = map(int, MES.split('-'))
ini = date(y, m, 1)
fin_mes = (date(y + m // 12, m % 12 + 1, 1) - timedelta(days=1))
hasta = min(fin_mes, HOY - timedelta(days=1)) if (y, m) == (HOY.year, HOY.month) else fin_mes
prev_fin = ini - timedelta(days=1)
prev_ini = prev_fin.replace(day=1)

if hasta < ini:
    # 1 del mes: aún no hay días cerrados → mes vacío (la pestaña existe igual)
    ads, dia = [], []
else:
    ads = [fila(r) for r in insights(ini.isoformat(), hasta.isoformat(), 'ad')]
    dia = [fila(r, ad=False) for r in insights(ini.isoformat(), hasta.isoformat(), 'campaign', diario=True)]
ads_prev = [fila(r) for r in insights(prev_ini.isoformat(), prev_fin.isoformat(), 'ad')]

out = {'periodo': dict(desde=ini.isoformat(), hasta=max(hasta, ini).isoformat()),
       'generado': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'fuente': 'API Meta (Reportes)',
       f'anuncios_{ABR[m-1]}': ads, f'diario_{ABR[m-1]}': dia, f'anuncios_{ABR[prev_fin.month-1]}': ads_prev}
p = os.path.join(RAW, f'cym-meta-{MES}.json')
json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
print(f'{MES}: {len(ads)} anuncios, {len(dia)} filas diarias, gasto ${sum(a["gasto"] for a in ads):,} hasta {hasta} → {p}')

# Piloto WhatsApp 5328: gasto y conversaciones por día (incluye hoy) → data/piloto-whatsapp.json
PP = os.path.join(ROOT, 'data', 'piloto-whatsapp.json')
pil = json.load(open(PP, encoding='utf-8'))
if pil.get('campana', {}).get('inicio'):
    filas = [fila(r, ad=False) for r in insights(pil['campana']['inicio'], min(HOY, date.fromisoformat(pil['campana']['fin'])).isoformat(), 'campaign', diario=True)]
    pil['gasto'] = sorted([dict(fecha=f['fecha'], gasto=f['gasto'], conversaciones=f['conv_wa']) for f in filas if (f['campana'] or '').upper().startswith('PILOTO M&P')], key=lambda g: g['fecha'])
    json.dump(pil, open(PP, 'w', encoding='utf-8'), ensure_ascii=False, indent=2); open(PP, 'a').write('\n')
    print(f"Piloto: ${sum(g['gasto'] for g in pil['gasto']):,} en {len(pil['gasto'])} días")
