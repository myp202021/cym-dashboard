/**
 * FISCALIZACIÓN DE LEADS — CyM Propiedades
 *
 * Corre diario vía GitHub Actions.
 * 1. Lee leads de ayer (24h) de Google Sheets
 * 2. Filtra los que no han recibido WA de fiscalización
 * 3. Envía WhatsApp via Twilio preguntando si fueron contactados
 * 4. Registra el envío en la pestaña FISCALIZACION via Apps Script web app
 */

const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM || 'whatsapp:+14155238886';

const SHEET_ID = '11lsrC9TrlAlKNJ4qIiBzsiEY1gTe_tomENTjmW0duwE';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_WEBHOOK; // Web app URL for writing to sheet

const LEAD_SHEETS = ['LAS CONDES', 'LA DEHESA', 'VITACURA', 'SCA', 'LA REINA', 'DEPARTAMENTOS'];

const ZONAS = {
  'LAS CONDES': { corredor: 'Anita Hernández', display: 'Las Condes' },
  'LA DEHESA': { corredor: 'Eugenia Olave', display: 'La Dehesa' },
  'VITACURA': { corredor: 'Daniela Peñafiel', display: 'Vitacura' },
  'SCA': { corredor: 'Benjamín Ceballos', display: 'San Carlos de Apoquindo' },
  'LA REINA': { corredor: 'James Robeson', display: 'La Reina' },
  'DEPARTAMENTOS': { corredor: 'Caro Paoletti', display: 'sector oriente' },
};

function parseCSV(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const row = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { row.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    row.push(cur.trim());
    rows.push(row);
  }
  return rows;
}

function normalizePhone(phone) {
  let digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('56') && digits.length >= 11) return '+' + digits;
  if (digits.startsWith('9') && digits.length === 9) return '+56' + digits;
  if (digits.length === 8) return '+569' + digits;
  return '+56' + digits;
}

function buildMessage(name, zona, prop) {
  const firstName = name.split(' ')[0];
  const zonaDisplay = ZONAS[zona] ? ZONAS[zona].display : zona;
  const propText = prop === 'departamento' ? 'un departamento' : (prop === 'cualquiera_de_las_dos' ? 'una propiedad' : 'una casa');

  return `Hola ${firstName}, te escribimos del equipo de calidad de CyM Propiedades. Hace un día completaste un formulario buscando ${propText} en ${zonaDisplay}. ¿Alguien de nuestro equipo te contactó?\n\n1️⃣ Sí, me contactaron\n2️⃣ No, nadie me contactó\n3️⃣ Me llamaron pero no pude contestar\n\nResponde con el número. Gracias 🙏`;
}

async function fetchSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_=${Date.now()}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return null;
  return await res.text();
}

async function sendWhatsApp(to, body) {
  const auth = Buffer.from(TWILIO_SID + ':' + TWILIO_TOKEN).toString('base64');
  const params = new URLSearchParams({
    To: 'whatsapp:' + to,
    From: TWILIO_FROM,
    Body: body
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json();
  return { ok: !!data.sid, sid: data.sid, error: data.message };
}

const GH_TOKEN = process.env.GH_TOKEN;
const REPO = 'myp202021/cym-dashboard';
const FISC_FILE = 'fiscalizacion.json';

async function loadFiscData() {
  if (!GH_TOKEN) return { leads: [] };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FISC_FILE}`, {
      headers: { 'Authorization': 'Bearer ' + GH_TOKEN, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) return { leads: [], sha: null };
    const file = await res.json();
    const content = Buffer.from(file.content, 'base64').toString('utf8');
    return { ...JSON.parse(content), sha: file.sha };
  } catch (e) { return { leads: [], sha: null }; }
}

async function saveFiscData(data, sha) {
  if (!GH_TOKEN) { console.log('  [SKIP] No GH_TOKEN — cannot save'); return; }
  const content = Buffer.from(JSON.stringify({ updated: new Date().toISOString(), leads: data.leads }, null, 2)).toString('base64');
  await fetch(`https://api.github.com/repos/${REPO}/contents/${FISC_FILE}`, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + GH_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '📱 Fiscalización: ' + data.leads.length + ' leads', content, sha })
  });
}

// Global fiscalizacion data — loaded once, saved at end
let fiscData = null;
let fiscSha = null;

(async function () {
  console.log('=== Fiscalización de Leads CyM ===');
  console.log('Fecha:', new Date().toISOString());

  if (!TWILIO_SID || !TWILIO_TOKEN) {
    console.log('ERROR: TWILIO_SID and TWILIO_TOKEN required');
    process.exit(1);
  }

  // Window: leads between 23 and 25 hours ago (exact 24h targeting)
  const now = new Date();
  const windowStart = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25h ago
  const windowEnd = new Date(now.getTime() - 23 * 60 * 60 * 1000);   // 23h ago

  console.log(`Window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}\n`);

  // Collect leads from all sheets
  let allLeads = [];
  for (const sheetName of LEAD_SHEETS) {
    const text = await fetchSheet(sheetName);
    if (!text) { console.log(`  ${sheetName}: no data`); continue; }

    const rows = parseCSV(text);
    const headers = rows[0];
    const dateCol = headers.indexOf('created_time');
    const nameCol = headers.indexOf('full_name');
    const phoneCol = headers.indexOf('phone_number');
    const propCol = headers.indexOf('¿qué_tipo_de_propiedad_busca?');
    const waCol = headers.indexOf('wa_fiscalizacion');

    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[dateCol]) continue;

      // Parse lead datetime (Meta uses UTC-5 offset in created_time)
      const leadDateStr = row[dateCol];
      const leadDate = new Date(leadDateStr);
      if (isNaN(leadDate.getTime())) continue;

      // Only leads in the 24h window (23-25 hours ago)
      if (leadDate < windowStart || leadDate > windowEnd) continue;

      const phone = row[phoneCol] || '';
      if (phone.replace(/[^0-9]/g, '').length < 8) continue;

      // Skip if already sent WA
      if (waCol >= 0 && row[waCol] && row[waCol].trim()) continue;

      allLeads.push({
        name: row[nameCol] || '?',
        phone: normalizePhone(phone),
        date: leadDate,
        zona: sheetName,
        prop: row[propCol] || 'casa',
        sheet: sheetName
      });
      count++;
    }
    console.log(`  ${sheetName}: ${count} leads to contact`);
  }

  // Load fiscalizacion data
  const loaded = await loadFiscData();
  fiscData = { leads: loaded.leads || [] };
  fiscSha = loaded.sha;

  // Deduplicate: remove leads that already received WA (by phone)
  const alreadySent = new Set(fiscData.leads.map(l => (l.telefono || '').replace(/[^0-9]/g, '').slice(-8)));
  allLeads = allLeads.filter(l => {
    const digits = l.phone.replace(/[^0-9]/g, '').slice(-8);
    return !alreadySent.has(digits);
  });

  console.log(`\nTotal leads to send WA (after dedup): ${allLeads.length}\n`);

  if (allLeads.length === 0) {
    console.log('No leads to process. Done.');
    process.exit(0);
  }

  // Send WhatsApp messages
  let sent = 0, failed = 0;
  for (const lead of allLeads) {
    const msg = buildMessage(lead.name, lead.zona, lead.prop);
    console.log(`Sending to ${lead.name} (${lead.phone}) — ${lead.zona}...`);

    const result = await sendWhatsApp(lead.phone, msg);
    if (result.ok) {
      console.log(`  ✅ Sent: ${result.sid}`);
      // Register in fiscalizacion.json
      fiscData.leads.push({
        fecha_lead: lead.date,
        nombre: lead.name,
        telefono: lead.phone,
        zona: lead.zona,
        tipo_propiedad: lead.prop,
        corredor: ZONAS[lead.zona] ? ZONAS[lead.zona].corredor : '',
        wa_fecha_envio: new Date().toISOString(),
        wa_estado: 'ENVIADO',
        wa_respuesta: '',
        wa_respuesta_raw: '',
        wa_fecha_respuesta: ''
      });
      sent++;
    } else {
      console.log(`  ❌ Failed: ${result.error}`);
      failed++;
    }

    // Rate limit: 1 message per second
    await new Promise(r => setTimeout(r, 1500));
  }

  // Save fiscalizacion data
  if (sent > 0) {
    console.log('\nSaving fiscalizacion.json...');
    await saveFiscData(fiscData, fiscSha);
  }

  console.log(`\n=== Done ===`);
  console.log(`Sent: ${sent} | Failed: ${failed} | Total: ${allLeads.length}`);
})();
