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

function buildReminder(name) {
  const firstName = name.split(' ')[0];
  return `Hola ${firstName}, ayer te enviamos un mensaje desde CyM Propiedades para saber si te contactaron. ¿Podrías responder con 1, 2 o 3?\n\n1️⃣ Sí, me contactaron\n2️⃣ No, nadie me contactó\n3️⃣ Me llamaron pero no pude contestar\n\nTu respuesta nos ayuda a mejorar el servicio. ¡Gracias! 🙏`;
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

async function saveFiscData(data) {
  if (!GH_TOKEN) { console.log('  [SKIP] No GH_TOKEN — cannot save'); return; }

  // Re-leer SHA fresco justo antes de guardar (evita conflicto si hubo otro commit)
  let freshSha = null;
  try {
    const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FISC_FILE}`, {
      headers: { 'Authorization': 'Bearer ' + GH_TOKEN, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (getRes.ok) {
      const file = await getRes.json();
      freshSha = file.sha;
    }
  } catch (e) { console.log('  [WARN] Could not get fresh SHA:', e.message); }

  const content = Buffer.from(JSON.stringify({ updated: new Date().toISOString(), leads: data.leads }, null, 2)).toString('base64');
  const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FISC_FILE}`, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + GH_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '📱 Fiscalización: ' + data.leads.length + ' leads', content, sha: freshSha })
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    console.log('  [ERROR] Save failed:', putRes.status, err);
  } else {
    console.log('  ✅ fiscalizacion.json saved to GitHub');
  }
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

  // Leads con 24+ horas de antigüedad que no han recibido WA
  // El cron solo corre en horario de oficina (9-17 Chile, L-V)
  // Un lead de las 3AM no se manda a las 9AM del mismo día (6h),
  // se manda cuando tenga 24h+ Y sea horario de oficina
  const MAX_MESSAGES_PER_RUN = 40; // Límite por ejecución (trial = 50/día)
  const MIN_AGE_HOURS = 24;       // Mínimo 24h desde que llegó el lead
  const MAX_AGE_HOURS = 72;       // Máximo 72h — no procesar leads históricos

  const now = new Date();
  const minAge = new Date(now.getTime() - MIN_AGE_HOURS * 60 * 60 * 1000);
  const maxAge = new Date(now.getTime() - MAX_AGE_HOURS * 60 * 60 * 1000);

  console.log(`Ventana: leads entre ${maxAge.toISOString()} y ${minAge.toISOString()} (${MIN_AGE_HOURS}-${MAX_AGE_HOURS}h)`);
  console.log(`Máximo ${MAX_MESSAGES_PER_RUN} mensajes por ejecución\n`);

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

      // Parse lead datetime
      const leadDateStr = row[dateCol];
      const leadDate = new Date(leadDateStr);
      if (isNaN(leadDate.getTime())) continue;

      // Solo leads en ventana 24-72h
      if (leadDate > minAge) continue;  // muy reciente
      if (leadDate < maxAge) continue;  // muy antiguo

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

  // Aplicar límite de batch
  const totalBeforeCap = allLeads.length;
  if (allLeads.length > MAX_MESSAGES_PER_RUN) {
    allLeads = allLeads.slice(0, MAX_MESSAGES_PER_RUN);
  }
  console.log(`\nTotal leads en ventana (after dedup): ${totalBeforeCap}`);
  console.log(`Enviando: ${allLeads.length} (cap: ${MAX_MESSAGES_PER_RUN})\n`);

  // Send WhatsApp messages (nuevos)
  let sent = 0, failed = 0, rateLimited = false;

  if (allLeads.length === 0) {
    console.log('No leads nuevos para enviar.');
  }
  for (const lead of allLeads) {
    const msg = buildMessage(lead.name, lead.zona, lead.prop);
    console.log(`Sending to ${lead.name} (${lead.phone}) — ${lead.zona}...`);

    const result = await sendWhatsApp(lead.phone, msg);
    if (result.ok) {
      console.log(`  ✅ Sent: ${result.sid}`);
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
      // Early exit si es error de límite diario
      if (result.error && (result.error.includes('daily') || result.error.includes('limit') || result.error.includes('exceeded'))) {
        console.log('\n⚠️  LÍMITE DIARIO ALCANZADO — deteniendo envíos.');
        rateLimited = true;
        break;
      }
      // Early exit si fallan 3 seguidos (otro error sistémico)
      if (failed >= 3 && sent === 0) {
        console.log('\n⚠️  3 fallos consecutivos sin éxito — deteniendo.');
        break;
      }
    }

    // Rate limit: 1.5s entre mensajes
    await new Promise(r => setTimeout(r, 1500));
  }

  // --- INSISTENCIA: leads que recibieron WA hace 24-48h y no respondieron ---
  console.log('\n--- Insistencia (recordatorio) ---');
  const REMINDER_MIN_HOURS = 24;
  const REMINDER_MAX_HOURS = 48;
  const reminderMin = new Date(now.getTime() - REMINDER_MIN_HOURS * 60 * 60 * 1000);
  const reminderMax = new Date(now.getTime() - REMINDER_MAX_HOURS * 60 * 60 * 1000);

  let reminders = fiscData.leads.filter(l => {
    if (l.wa_respuesta) return false;           // ya respondió
    if (l.wa_insistencia) return false;          // ya se mandó insistencia
    if (!l.wa_fecha_envio) return false;
    const envio = new Date(l.wa_fecha_envio);
    return envio < reminderMin && envio > reminderMax; // entre 24-48h desde envío
  });

  console.log(`Leads sin respuesta en ventana 24-48h: ${reminders.length}`);

  let reminderSent = 0;
  for (const lead of reminders) {
    if (sent + reminderSent >= MAX_MESSAGES_PER_RUN) {
      console.log('  Cap de mensajes alcanzado, deteniendo insistencias.');
      break;
    }

    const msg = buildReminder(lead.nombre);
    console.log(`  Recordatorio → ${lead.nombre} (${lead.telefono}) — ${lead.zona}...`);

    const result = await sendWhatsApp(lead.telefono, msg);
    if (result.ok) {
      console.log(`    ✅ Reminder sent: ${result.sid}`);
      lead.wa_insistencia = new Date().toISOString();
      reminderSent++;
    } else {
      console.log(`    ❌ Failed: ${result.error}`);
      if (result.error && (result.error.includes('daily') || result.error.includes('limit') || result.error.includes('exceeded'))) {
        console.log('\n⚠️  LÍMITE DIARIO ALCANZADO — deteniendo insistencias.');
        break;
      }
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`Insistencias enviadas: ${reminderSent}`);

  // Save fiscalizacion data
  if (sent > 0 || reminderSent > 0) {
    console.log('\nSaving fiscalizacion.json...');
    await saveFiscData(fiscData);
  }

  console.log(`\n=== Done ===`);
  console.log(`Nuevos: ${sent} | Insistencias: ${reminderSent} | Fallos: ${failed}`);
})();
