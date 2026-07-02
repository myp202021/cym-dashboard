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

async function registerEnvio(lead) {
  if (!APPS_SCRIPT_URL) {
    console.log('  [SKIP] No APPS_SCRIPT_WEBHOOK configured — cannot write to sheet');
    return;
  }
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'registrar_envio',
        data: {
          fecha_lead: lead.date,
          nombre: lead.name,
          telefono: lead.phone,
          zona: lead.zona,
          tipo_propiedad: lead.prop,
          corredor: ZONAS[lead.zona] ? ZONAS[lead.zona].corredor : '',
          wa_fecha_envio: new Date().toISOString(),
          wa_estado: 'ENVIADO'
        }
      })
    });
  } catch (e) {
    console.log('  [WARN] Error writing to sheet:', e.message);
  }
}

(async function () {
  console.log('=== Fiscalización de Leads CyM ===');
  console.log('Fecha:', new Date().toISOString());

  if (!TWILIO_SID || !TWILIO_TOKEN) {
    console.log('ERROR: TWILIO_SID and TWILIO_TOKEN required');
    process.exit(1);
  }

  // Calculate yesterday's date range (24h ago)
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toISOString().substring(0, 10);
  // Also check day before (in case of timezone offset — leads use UTC-5)
  const dayBefore = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const dayBeforeStr = dayBefore.toISOString().substring(0, 10);

  console.log(`Looking for leads from ${dayBeforeStr} to ${yesterdayStr}\n`);

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

      const leadDate = row[dateCol].substring(0, 10);
      // Only leads from yesterday (24h window)
      if (leadDate !== yesterdayStr && leadDate !== dayBeforeStr) continue;

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

  console.log(`\nTotal leads to send WA: ${allLeads.length}\n`);

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
      await registerEnvio(lead);
      sent++;
    } else {
      console.log(`  ❌ Failed: ${result.error}`);
      failed++;
    }

    // Rate limit: 1 message per second
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n=== Done ===`);
  console.log(`Sent: ${sent} | Failed: ${failed} | Total: ${allLeads.length}`);
})();
