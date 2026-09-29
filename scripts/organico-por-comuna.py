#!/usr/bin/env python3
"""
CyM — Leads orgánicos por comuna (se corre todos los martes).

Entrada: la lista que manda CyM (dos bloques lado a lado: CON CONTACTO | SIN CONTACTO),
copiada tal cual desde la planilla/Excel y guardada como texto con tabs en organico/entrada.txt
(columnas: Nombre, Celular, Código, Comuna, [nota] | vacía | Nombre, Código, Comuna).

Salida:
  organico/salida.tsv  -> se pega en A1 de la pestaña "Orgánico por comuna" de la planilla semanal
  (también queda copiado al portapapeles con pbcopy).

Reglas: comunas normalizadas (SCA = San Carlos de Apoquindo, "Depto Vitacura" = Vitacura + obs "Departamento");
filas con varios códigos (5675 | 5972, 5944/ 4876) se separan en una fila por código; si falta comuna se deduce
del código; teléfonos a "56 9 XXXX XXXX" (sin "+" para que Sheets no lo tome como fórmula), emails a su columna;
duplicados exactos (nombre+código+teléfono) se unen; números con dígitos malos / EE.UU. quedan marcados en Observación.
Orden: comuna (Las Condes, La Dehesa, Vitacura, SCA, La Reina, sin comuna) > Con contacto primero > código > nombre.
"""
import os, subprocess
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'organico'))
import csv, re, unicodedata
from collections import OrderedDict, Counter
def norm(s): return ' '.join((s or '').replace(' ',' ').split()).strip()
def key(s): return unicodedata.normalize('NFKD',s.lower()).encode('ascii','ignore').decode().replace('.','').strip()
COM={'las condes':'Las Condes','la dehesa':'La Dehesa','vitacura':'Vitacura','sca':'San Carlos de Apoquindo','la reina':'La Reina','depto vitacura':'Vitacura'}
rows=[]
for line in open('entrada.txt',encoding='utf-8'):
    c=line.rstrip('\n').split('\t')+['']*9
    L=[norm(x) for x in c[:5]]; R=[norm(x) for x in c[5:8]]
    if L[0] or L[2]: rows.append(dict(estado='Con contacto',nombre=L[0],contacto=L[1],cod=L[2],com=L[3],obs=L[4]))
    if R[0]: rows.append(dict(estado='Sin contacto',nombre=R[0],contacto='',cod=R[1],com=R[2],obs=''))
out=[]
for r in rows:
    codes=[x.strip() for x in re.split(r'[|/]',r['cod']) if x.strip() and x.strip()!='-']
    coms=[x.strip() for x in r['com'].split('|')]
    if not codes: codes=['']
    for i,cd in enumerate(codes):
        cm=coms[i] if i<len(coms) else coms[0]
        obs=[r['obs']] if r['obs'] else []
        if key(cm)=='depto vitacura': obs.append('Departamento')
        cm=COM.get(key(cm),'') if cm and cm!='-' else ''
        out.append(dict(r,cod=cd,com=cm,obs=obs))
code2com=Counter()
for r in out:
    if r['cod'] and r['com']: code2com[(r['cod'],r['com'])]+=1
best={}
for (cd,cm),n in code2com.items():
    if cd not in best or n>code2com[(cd,best[cd])]: best[cd]=cm
for r in out:
    if not r['com'] and r['cod'] in best: r['com']=best[r['cod']]; r['obs'].append('Comuna deducida por código')
def phone(s):
    email=''; tel=''; o=[]
    if '@' in s: return '', s, o
    if not s or s=='-': return '','',o
    d=re.sub(r'\D','',s)
    if not d: o.append(s); return '','',o
    if len(d)==11 and d.startswith('569'): tel=f'+56 9 {d[3:7]} {d[7:]}'
    elif len(d)==9 and d.startswith('9'): tel=f'+56 9 {d[1:5]} {d[5:]}'
    elif len(d)==11 and d.startswith('1'): tel=f'+1 {d[1:4]} {d[4:7]} {d[7:]}'; o.append('Número de EE.UU.')
    else: tel=s; o.append('Revisar número (dígitos incorrectos)')
    return tel,email,o
for r in out:
    t,e,o=phone(r['contacto']); r['tel']=t; r['email']=e; r['obs']+=o
    r['nombre']=r['nombre'].rstrip(' -').strip() or '(sin nombre)'
# duplicados
seen={}
final=[]
for r in out:
    k=(key(r['nombre']), r['cod'], r['tel'] or r['email'])
    if k in seen: seen[k]['obs'].append('Aparecía repetido en la lista'); continue
    seen[k]=r; final.append(r)
telc=Counter(r['tel'] for r in final if r['tel'])
for r in final:
    if r['tel'] and telc[r['tel']]>1: r['obs'].append('Mismo teléfono en otra fila (varias propiedades)')
ORDER=['Las Condes','La Dehesa','Vitacura','San Carlos de Apoquindo','La Reina','']
final.sort(key=lambda r:(ORDER.index(r['com']),0 if r['estado']=='Con contacto' else 1,r['cod'] or 'zzzz',key(r['nombre'])))
with open('CyM - Leads orgánicos por comuna.csv','w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['Comuna','Estado','Nombre','Teléfono','Email','Código propiedad','Observación'])
    for r in final: w.writerow([r['com'] or 'Sin comuna',r['estado'],r['nombre'],r['tel'],r['email'],r['cod'],'; '.join(OrderedDict.fromkeys(x for x in r['obs'] if x))])
with open('CyM - Resumen orgánico.csv','w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['Comuna','Con contacto','Sin contacto','Total','Propiedades (códigos) más consultadas'])
    T=[0,0]
    for cm in ORDER:
        rs=[r for r in final if r['com']==cm]
        if not rs: continue
        a=sum(r['estado']=='Con contacto' for r in rs); b=len(rs)-a; T[0]+=a; T[1]+=b
        top=Counter(r['cod'] for r in rs if r['cod']).most_common(3)
        w.writerow([cm or 'Sin comuna',a,b,a+b,', '.join(f'{c} ({n})' for c,n in top)])
    w.writerow(['TOTAL',T[0],T[1],sum(T),''])
print(len(rows),'filas origen ->',len(final),'filas finales')

import csv as _csv
rows_out=[['CyM Propiedades — Leads orgánicos por comuna'],['Ordenado por comuna, estado y código de propiedad. Teléfonos normalizados (56 9 XXXX XXXX). Filas marcadas en "Observación" requieren revisión.'],[],['RESUMEN POR COMUNA']]
rows_out+=list(_csv.reader(open('CyM - Resumen orgánico.csv',encoding='utf-8')))
rows_out+=[[],['DETALLE']]
det=list(_csv.reader(open('CyM - Leads orgánicos por comuna.csv',encoding='utf-8')))
for r in det[1:]:
    if len(r)>3 and r[3].startswith('+'): r[3]=r[3][1:]
rows_out+=det
tsv='\n'.join('\t'.join(c.replace('\t',' ') for c in r) for r in rows_out)
open('salida.tsv','w',encoding='utf-8').write(tsv)
subprocess.run(['pbcopy'],input=tsv.encode('utf-8'))
print('salida.tsv lista y copiada al portapapeles')
