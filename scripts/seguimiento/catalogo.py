#!/usr/bin/env python3
"""
Catálogo de propiedades CyM: código → tipo y comuna (datos públicos de la ficha en cympropiedades.cl).
Fuentes, en orden: 1) ficha pública property.asp?Origen=CODIGO&idpro=<código>; 2) nombre de campaña Meta
("WhatsApp - Departamentos" → Depto; "WhatsApp - <comuna>" → Casa en esa zona). Lo que no se resuelve queda "Sin dato".
Códigos: los de la lista orgánica (raw/organico-detalle-*.json) + los anuncios de Meta (raw/cym-meta-*.json).
Salida: data/propiedades-catalogo.json (se commitea: solo datos públicos de propiedades, sin datos personales).
Uso (los martes, antes de build.py): python3 scripts/seguimiento/catalogo.py   (--todo para re-consultar todos)
"""
import json, os, re, sys, glob, html, time, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'scripts', 'seguimiento', 'raw')
OUT = os.path.join(ROOT, 'data', 'propiedades-catalogo.json')
TIPOS = {'departamento': 'Depto', 'casa': 'Casa', 'terreno': 'Terreno', 'sitio': 'Terreno', 'parcela': 'Parcela',
         'oficina': 'Oficina', 'local': 'Local', 'local comercial': 'Local', 'bodega': 'Bodega'}

def codigos():
    cs = {}
    for f in glob.glob(os.path.join(RAW, 'organico-detalle-*.json')):
        for r in json.load(open(f, encoding='utf-8'))['filas']:
            for c in re.findall(r'\b\d{4}\b', r.get('codigo') or ''): cs.setdefault(c, set())
    for f in glob.glob(os.path.join(RAW, 'cym-meta-*.json')):
        d = json.load(open(f, encoding='utf-8'))
        ads = [a for v in d.get('meses', {}).values() for a in v.get('anuncios', [])]
        ads += [a for k, v in d.items() if k.startswith('anuncios_') for a in v]
        for a in ads:
            m = re.match(r'\s*(\d{4})\b', a.get('anuncio') or '')
            if m: cs.setdefault(m.group(1), set()).add(a.get('campana') or '')
    return cs

def ficha(cod):
    url = f'https://www.cympropiedades.cl/property.asp?Origen=CODIGO&idpro={cod}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (M&P panel CyM)'})
    t = urllib.request.urlopen(req, timeout=25).read().decode('latin-1')
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', t, flags=re.S)
    L = [l.strip() for l in html.unescape(re.sub(r'<[^>]+>', '\n', t)).split('\n') if l.strip()]
    if 'Cód.:' not in L: return None
    i = L.index('Cód.:')
    if i + 1 >= len(L) or L[i + 1] != cod: return None
    tipo = L[L.index('Tipo:') + 1] if 'Tipo:' in L else ''
    com = next((l.split(',')[0].strip() for l in L[i:i + 30] if re.match(r'^[^,|]{3,40},\s*[A-ZÁÉÍÓÚÑ ]{4,}$', l)), '')
    op = next((l for l in L[:L.index('Cód.:')] if l in ('Venta', 'Arriendo')), '')
    precio = next((l for l in L[:L.index('Cód.:')] if l.startswith('UF ') or l.startswith('$')), '')
    return dict(tipo=TIPOS.get(tipo.lower(), tipo or 'Sin dato'), comuna=com or 'Sin dato', operacion=op, precio=precio,
                fuente='ficha cympropiedades.cl', url=url)

def por_campana(camps):
    for c in camps:
        m = re.match(r'(?i)(?:whatsapp|clientes potenciales)\s*-\s*([^/]+)', c)
        if not m: continue
        z = m.group(1).strip()
        if re.match(r'(?i)departamentos?', z): return dict(tipo='Depto', comuna='Sin dato', fuente=f'campaña Meta "{c}"')
        return dict(tipo='Casa', comuna=z, fuente=f'campaña Meta "{c}"')
    return None

def main():
    prev = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    cat = prev.get('codigos', {}); todo = '--todo' in sys.argv
    cs = codigos(); nuevos = 0
    for cod, camps in sorted(cs.items()):
        if cod in cat and cat[cod].get('fuente', '').startswith('ficha') and not todo: continue
        try: r = ficha(cod)
        except Exception as e: r = None; print(f'  {cod}: error ficha {e}')
        if r is None: r = por_campana(camps) or dict(tipo='Sin dato', comuna='Sin dato', fuente='sin fuente')
        cat[cod] = r; nuevos += 1; time.sleep(0.4)
    ok = sum(1 for v in cat.values() if v['tipo'] != 'Sin dato')
    json.dump(dict(actualizado=time.strftime('%Y-%m-%d'), codigos=dict(sorted(cat.items()))), open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'catálogo: {len(cat)} códigos ({nuevos} consultados), con tipo {ok}, sin dato {len(cat) - ok}')

if __name__ == '__main__': main()
