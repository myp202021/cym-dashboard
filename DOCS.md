# Dashboard CyM Propiedades — Documentación

## URL Live
https://cym-dashboard-liart.vercel.app

## Qué es
Dashboard de performance Meta Ads para CyM Propiedades. Muestra inversión, leads, CPC, CPA y CTR por comuna de Santiago zona oriente. Auto-refresh cada 5 minutos.

## Arquitectura

```
Google Sheets (fuente única de verdad)
    │
    ├── Hoja "Gasto consolidado"  →  Inversión, impresiones, clics, CPC, CPA por comuna
    ├── Hoja "LAS CONDES"         →  Leads individuales (formularios Meta)
    ├── Hoja "LA DEHESA"          →  Leads individuales
    ├── Hoja "VITACURA"           →  Leads individuales
    ├── Hoja "SCA"                →  Leads individuales
    ├── Hoja "LA REINA"           →  Leads individuales
    └── Hoja "DEPARTAMENTOS"      →  Leads individuales
         │
         ▼
   Vercel Proxy API (/api/sheets?sheet=NOMBRE)
   - Agrega cache-busting timestamp a Google
   - Cache CDN: 30 segundos
         │
         ▼
   index.html (vanilla JS, sin framework)
   - Fetch leads por comuna → cuenta filas con id "l:*"
   - Fetch "Gasto consolidado" → inversión/impresiones/clics por comuna
   - Sobreescribe Conv con conteo real de leads
   - Recalcula CPA = inversión / leads reales
   - Render tabla + KPIs + ranking + funnel
   - Auto-refresh: setInterval(fetchData, 5 * 60 * 1000)
```

## Google Sheets

**Spreadsheet ID:** `11lsrC9TrlAlKNJ4qIiBzsiEY1gTe_tomENTjmW0duwE`
**URL:** https://docs.google.com/spreadsheets/d/11lsrC9TrlAlKNJ4qIiBzsiEY1gTe_tomENTjmW0duwE

### Hoja "Gasto consolidado" (gid=524458128)
Columnas: (vacía), Comuna, Impresiones, Clics, Conv, CTR, CPC, CPA, Inversión total, notificado
- **ESTA HOJA SE ACTUALIZA MANUALMENTE** con datos de Meta Ads Manager
- Cada fila = una comuna: La Reina, SCA, Vitacura, La Dehesa, Deptos, Las Condes
- Última fila = Total
- Formato: números con punto de miles ($105.000), porcentajes con coma (5,22%)

### Hojas de leads (una por comuna)
- Nombres exactos: `LAS CONDES`, `LA DEHESA`, `VITACURA`, `SCA`, `LA REINA`, `DEPARTAMENTOS`
- Cada fila = un lead de Meta Lead Ads
- Columnas: id, created_time, ad_id, ad_name, ..., full_name, phone_number, email, lead_status, notificado
- El dashboard cuenta leads donde `id` empieza con `l:` (excluye header y vacías)

## Archivos del proyecto

```
CyM_Dashboard/
├── index.html          ← Dashboard completo (HTML + CSS + JS, todo en uno)
├── api/
│   └── sheets.js       ← Proxy Vercel: lee Google Sheets, evita CORS, cache-bust
├── logo-cym.png        ← Logo C&M Propiedades
├── .vercel/
│   └── project.json    ← Vinculación proyecto Vercel (prj_u4ma4ZK3A2pjvOtXdYT08md56eej)
└── DOCS.md             ← Este archivo
```

## API Proxy (`/api/sheets`)

**Endpoint:** `GET /api/sheets?sheet=NOMBRE_HOJA`

- Lee CSV desde Google Sheets gviz endpoint
- Agrega `_=timestamp` para evitar cache de Google
- Responde con CSV raw
- Cache CDN: `s-maxage=30, must-revalidate`
- CORS: `Access-Control-Allow-Origin: *`

## Cómo se calcula cada métrica

| Métrica | Fuente | Cálculo |
|---------|--------|---------|
| Inversión | Gasto consolidado → columna "Inversión total" | Directo del sheet |
| Impresiones | Gasto consolidado → columna "Impresiones" | Directo del sheet |
| Clics | Gasto consolidado → columna "Clics" | Directo del sheet |
| Leads | Hojas por comuna | Conteo de filas con id `l:*` |
| CTR | Calculado | clics / impresiones × 100 |
| CPC | Gasto consolidado → columna "CPC" | Directo del sheet |
| CPA | Calculado | inversión / leads (usa conteo real, no el Conv del sheet) |
| % gasto | Calculado | inversión comuna / inversión total × 100 |

## Prioridad comercial de comunas

| Prioridad | Comunas | Categoría |
|-----------|---------|-----------|
| 1 | Vitacura | Zona Premium |
| 2 | La Dehesa | Zona Premium |
| 3 | SCA (San Carlos de Apoquindo) | Zona Alta |
| 4 | Las Condes | Zona Alta |
| 5 | La Reina | Zona Volumen |
| 6 | Departamentos | Zona Volumen |

## Benchmarks de referencia

- CTR: 1,0 — 2,5%
- % Conversión: 2,0 — 5,0%
- CPC: $80 — $250
- CPA: $2.000 — $8.000
(Meta Ads, sector inmobiliario, zona oriente Santiago)

## Deploy

- **Repo GitHub:** https://github.com/myp202021/cym-dashboard
- **Vercel project:** cym-dashboard
- **Deploy automático:** push a main → Vercel deploya
- **No hay build step** — es HTML estático + Vercel Serverless Function (api/sheets.js)

## Troubleshooting

### Dashboard no muestra datos / se queda en "Cargando"
1. Verificar que el Google Sheet es público (Compartir → Cualquier persona con enlace → Lector)
2. Probar API directamente: `https://cym-dashboard-liart.vercel.app/api/sheets?sheet=Gasto%20consolidado`
3. Si la API da error, revisar que el Sheet ID no cambió

### Inversión no se actualiza
1. Verificar hoja "Gasto consolidado" en Google Sheets — los datos se actualizan MANUALMENTE
2. Si el sheet tiene datos nuevos pero el dashboard muestra viejos, el proxy tiene cache-busting automático (timestamp) — esperar max 30 segundos o hacer hard-refresh (Ctrl+Shift+R)

### Leads no coinciden
- El dashboard cuenta leads reales desde cada hoja de comuna
- Si hay discrepancia con "Gasto consolidado", el conteo real de la hoja gana (sobreescribe Conv)
- CPA se recalcula con los leads reales

## Mantenimiento requerido

**Mensual o cuando cambie la inversión en Meta:**
1. Abrir Google Sheets → hoja "Gasto consolidado"
2. Actualizar Impresiones, Clics, CPC, Inversión total por comuna
3. El dashboard se actualiza solo al refrescar

**Cuando se agregue una comuna nueva:**
1. Crear hoja de leads en Google Sheets con nombre en MAYÚSCULAS
2. Agregar entrada en `LEAD_SHEETS` array en index.html
3. Agregar fila en "Gasto consolidado"
4. Agregar en `PRIORIDAD` map en index.html
5. Push a main → deploy automático
