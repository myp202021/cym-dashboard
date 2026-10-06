#!/usr/bin/env python3
"""
CyM — Panel de seguimiento mensual (se actualiza todos los martes).

Entradas (scripts/seguimiento/raw/, NO se commitean):
  cym-meta-<AAAA-MM>.json  export de Meta bajado vía Chrome (adsmanager-graph): anuncios_<mes>, diario_<mes>, anuncios_<mes anterior>
                           (compatibilidad: cym-meta-oct.json con anuncios_oct / diario_oct / anuncios_sep)
  organico-<AAAA-MM>.txt   lista orgánica que manda CyM (mismo formato que scripts/organico/entrada.txt), opcional

Salida (sí se commitea, solo agregados, sin nombres ni teléfonos):
  data/seguimiento-<AAAA-MM>.json  y  data/seguimiento-index.json (meses disponibles)

Uso: python3 scripts/seguimiento/build.py 2026-10
"""
import json, os, re, sys, unicodedata, calendar
from collections import defaultdict, Counter
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'scripts', 'seguimiento', 'raw')
DATA = os.path.join(ROOT, 'data')
MES = sys.argv[1] if len(sys.argv) > 1 else date.today().strftime('%Y-%m')
MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
ABR = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

def key(s): return unicodedata.normalize('NFKD', (s or '').lower()).encode('ascii', 'ignore').decode().replace('.', '').strip()
COMUNAS = {'las condes': 'Las Condes', 'la dehesa': 'La Dehesa', 'vitacura': 'Vitacura', 'sca': 'SCA',
           'san carlos de apoquindo': 'SCA', 'la reina': 'La Reina', 'departamentos': 'Departamentos', 'depto vitacura': 'Vitacura'}

PROPIEDADES = ('WhatsApp propiedades', 'Formulario propiedades')
SIN_COMUNA = 'Otras / sin comuna'

def comuna(txt):
    # "Las Condes / Modificado" → "Las Condes"; si no calza con una comuna conocida, no se inventa
    base = re.split(r'\s*/\s*', (txt or '').strip())[0]
    return COMUNAS.get(key(base), SIN_COMUNA)

def clasifica(campana):
    c = campana or ''
    m = re.match(r'(?i)whatsapp\s*-\s*(.+)', c)
    if m: return comuna(m.group(1)), 'WhatsApp propiedades'
    m = re.match(r'(?i)clientes potenciales\s*-\s*(.+)', c)
    if m: return comuna(m.group(1)), 'Formulario propiedades'
    m = re.match(r'(?i)(?:nuevo director|anuncio director/?a?)\s+(.+)', c)
    if m: return comuna(m.group(1)), 'Captación nuevo director'
    return SIN_COMUNA, 'Marca / otros'

def codigo(anuncio):
    # el nombre del anuncio es el código de propiedad ("5693", "5693 - 2"); si no, "sin código"
    m = re.match(r'\s*(\d{4})\b', anuncio or '')
    return m.group(1) if m else 'sin código'

def leads(a): return int(a.get('conv_wa', 0)) + int(a.get('leads_form', 0))

def cargar_meta():
    y, m = map(int, MES.split('-'))
    # histórico mayo–septiembre bajado de una vez: {meses: {AAAA-MM: {anuncios, diario}}}
    hp = os.path.join(RAW, 'cym-meta-may-sep.json')
    if os.path.exists(hp):
        h = json.load(open(hp, encoding='utf-8'))
        if MES in h.get('meses', {}):
            prev = f'{y if m > 1 else y - 1}-{(m - 2) % 12 + 1:02d}'
            mm = h['meses'][MES]
            return dict(generado=h.get('generado')), mm['anuncios'], mm['diario'], h['meses'].get(prev, {}).get('anuncios', [])
    for nombre in (f'cym-meta-{MES}.json', f'cym-meta-{ABR[m-1]}.json'):
        p = os.path.join(RAW, nombre)
        if os.path.exists(p): break
    else: sys.exit(f'No encuentro el export de Meta para {MES} en {RAW}')
    d = json.load(open(p, encoding='utf-8'))
    prev = ABR[(m - 2) % 12]
    ads = d.get(f'anuncios_{ABR[m-1]}') or d.get('anuncios_mes') or []
    diario = d.get(f'diario_{ABR[m-1]}') or d.get('diario_mes') or []
    ads_prev = d.get(f'anuncios_{prev}') or d.get('anuncios_mes_anterior') or []
    return d, ads, diario, ads_prev

def tot(rows):
    g = sum(r['gasto'] for r in rows); l = sum(leads(r) for r in rows)
    return dict(gasto=round(g), leads=l, conv_wa=sum(int(r.get('conv_wa', 0)) for r in rows),
                leads_form=sum(int(r.get('leads_form', 0)) for r in rows),
                impresiones=sum(r.get('impresiones', 0) for r in rows), clics=sum(r.get('clics', 0) for r in rows),
                cpl=round(g / l) if l else None)

def agrupa(rows, fkey, extra=None):
    grp = defaultdict(list)
    for r in rows: grp[fkey(r)].append(r)
    out = []
    for k, rs in grp.items():
        t = tot(rs); t.update(extra(k, rs) if extra else {}); out.append(t)
    return sorted(out, key=lambda x: -x['gasto'])

def organico():
    p = os.path.join(RAW, f'organico-{MES}.txt')
    if not os.path.exists(p): return None
    def norm(s): return ' '.join((s or '').replace('\xa0', ' ').split()).strip()
    filas = []
    for line in open(p, encoding='utf-8'):
        c = line.rstrip('\n').split('\t') + [''] * 9
        L = [norm(x) for x in c[:5]]; R = [norm(x) for x in c[5:8]]
        if L[0] or L[2]: filas.append(('con', L[2], L[3]))
        if R[0]: filas.append(('sin', R[1], R[2]))
    out = []
    for est, cod, com in filas:
        codes = [x.strip() for x in re.split(r'[|/]', cod) if x.strip() and x.strip() != '-'] or ['']
        coms = [x.strip() for x in com.split('|')]
        for i, cd in enumerate(codes):
            cm = coms[i] if i < len(coms) else coms[0]
            out.append([est, cd, COMUNAS.get(key(cm), '') if cm and cm != '-' else ''])
    c2 = Counter((cd, cm) for _, cd, cm in out if cd and cm); best = {}
    for (cd, cm), n in c2.items():
        if cd not in best or n > c2[(cd, best[cd])]: best[cd] = cm
    for r in out:
        if not r[2] and r[1] in best: r[2] = best[r[1]]
    grp = defaultdict(list)
    for est, cd, cm in out: grp[cm or 'Sin comuna'].append((est, cd))
    res = []
    for cm, rs in grp.items():
        con = sum(1 for e, _ in rs if e == 'con'); total = len(rs)
        top = Counter(cd for _, cd in rs if cd).most_common(3)
        res.append(dict(comuna=cm, total=total, con_contacto=con, sin_contacto=total - con,
                        pct_contacto=round(100 * con / total) if total else 0, top_codigos=[dict(codigo=c, n=n) for c, n in top]))
    res.sort(key=lambda x: (x['comuna'] == 'Sin comuna', -x['total']))
    con = sum(r['con_contacto'] for r in res); total = sum(r['total'] for r in res)
    return dict(estado='cargado', por_comuna=res, total=total, con_contacto=con, sin_contacto=total - con,
                pct_contacto=round(100 * con / total) if total else 0)

def main():
    d, ads, diario, ads_prev = cargar_meta()
    y, m = map(int, MES.split('-'))
    hasta = d.get('periodo', {}).get('hasta') or max(r['fecha'] for r in diario)
    dias = int(hasta[8:10]) if hasta[:7] == MES else calendar.monthrange(y, m)[1]
    # si el export se bajó el mismo día de "hasta", ese día va parcial: no cuenta para comparar el ritmo
    if (d.get('generado') or '')[:10] == hasta and dias > 1: dias -= 1
    completo = dias == calendar.monthrange(y, m)[1]
    for r in ads + ads_prev:
        r['comuna'], r['tipo'] = clasifica(r['campana'])
        r['codigo'] = codigo(r['anuncio'])
    kpi = tot(ads)
    dias_prev = calendar.monthrange(y if m > 1 else y - 1, m - 1 if m > 1 else 12)[1]
    tp = tot(ads_prev)
    f = 1 if completo else dias / dias_prev  # mes cerrado: contra el mes anterior completo; mes en curso: mismo ritmo de días
    ritmo_prev = dict(gasto=round(tp['gasto'] * f), leads=round(tp['leads'] * f), cpl=tp['cpl'],
                      gasto_mes=tp['gasto'], leads_mes=tp['leads'], dias_mes=dias_prev) if ads_prev else None
    por_campana = agrupa(ads, lambda r: r['campana'], lambda k, rs: dict(campana=k, comuna=rs[0]['comuna'], tipo=rs[0]['tipo'], anuncios=len(rs)))
    prev_camp = {c['campana']: c for c in agrupa(ads_prev, lambda r: r['campana'], lambda k, rs: dict(campana=k))}
    for c in por_campana:
        p = prev_camp.get(c['campana']); c['cpl_mes_anterior'] = p['cpl'] if p else None
    por_comuna = agrupa(ads, lambda r: r['comuna'], lambda k, rs: dict(comuna=k, anuncios=len(rs),
                        gasto_whatsapp=round(sum(x['gasto'] for x in rs if x['tipo'] == 'WhatsApp propiedades')),
                        gasto_director=round(sum(x['gasto'] for x in rs if x['tipo'] == 'Captación nuevo director')),
                        gasto_otros=round(sum(x['gasto'] for x in rs if x['tipo'] == 'Marca / otros'))))
    prev_com = {c['comuna']: c for c in agrupa(ads_prev, lambda r: r['comuna'], lambda k, rs: dict(comuna=k))}
    for c in por_comuna:
        p = prev_com.get(c['comuna']); c['cpl_mes_anterior'] = p['cpl'] if p else None
    props = [r for r in ads if r['tipo'] in PROPIEDADES]
    por_codigo = agrupa(props, lambda r: (r['codigo'], r['comuna']), lambda k, rs: dict(codigo=k[0], comuna=k[1]))
    serie = defaultdict(lambda: dict(gasto=0, leads=0))
    for r in diario:
        serie[r['fecha']]['gasto'] += r['gasto']; serie[r['fecha']]['leads'] += leads(r)
    serie = [dict(fecha=f, gasto=round(v['gasto']), leads=v['leads']) for f, v in sorted(serie.items())]
    sin_leads = [c for c in por_codigo if c['leads'] == 0 and c['gasto'] > 0 and c['codigo'] != 'sin código']
    out = dict(mes=MES, titulo=f'{MESES[m-1].capitalize()} {y}', desde=f'{MES}-01', hasta=hasta, dias=dias,
               generado=d.get('generado'), fuente='Meta Ads (cuenta act_2505215759834007), atribución por defecto',
               completo=completo, kpi=kpi,
               mes_anterior=dict(nombre=MESES[(m - 2) % 12], **ritmo_prev) if ritmo_prev else None,
               alertas=dict(codigos_sin_leads=len(sin_leads), gasto_sin_leads=round(sum(c['gasto'] for c in sin_leads)),
                            gasto_whatsapp=round(sum(r['gasto'] for r in props))),
               por_campana=por_campana, por_comuna=por_comuna, por_codigo=por_codigo, serie_diaria=serie,
               organico=organico() or dict(estado='pendiente', nota=f'Pendiente lista orgánica de {MESES[m-1]} (la manda CyM los martes).'))
    os.makedirs(DATA, exist_ok=True)
    json.dump(out, open(os.path.join(DATA, f'seguimiento-{MES}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    idx_p = os.path.join(DATA, 'seguimiento-index.json')
    idx = json.load(open(idx_p)) if os.path.exists(idx_p) else []
    idx = [i for i in idx if i['mes'] != MES] + [dict(mes=MES, titulo=out['titulo'], hasta=hasta, completo=completo,
           gasto=kpi['gasto'], leads=kpi['leads'], conv_wa=kpi['conv_wa'], leads_form=kpi['leads_form'], cpl=kpi['cpl'],
           organico=out['organico'].get('total'), organico_contactados=out['organico'].get('con_contacto'))]
    json.dump(sorted(idx, key=lambda i: i['mes'], reverse=True), open(idx_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    sc = [c for c in por_campana if c['comuna'] == SIN_COMUNA]
    print(f"{out['titulo']}: gasto ${kpi['gasto']:,} · leads {kpi['leads']} · CPL ${kpi['cpl']:,} · orgánico {out['organico']['estado']}"
          f" · sin comuna: {', '.join(c['campana'] for c in sc) or '—'}")

main()
