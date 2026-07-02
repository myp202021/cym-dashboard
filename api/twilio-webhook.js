/**
 * Webhook para recibir respuestas de WhatsApp via Twilio
 * Guarda las respuestas en fiscalizacion.json en el repo via GitHub API
 */

import { readFileSync } from 'fs';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Serve fiscalizacion data
    try {
      const resp = await fetch('https://raw.githubusercontent.com/myp202021/cym-dashboard/main/fiscalizacion.json?t=' + Date.now());
      if (resp.ok) {
        const data = await resp.json();
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 's-maxage=30, must-revalidate');
        return res.status(200).json(data);
      }
    } catch (e) {}
    return res.status(200).json({ leads: [] });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { Body, From } = req.body || {};
  if (!From || !Body) {
    return res.status(400).json({ error: 'Missing From or Body' });
  }

  const phone = (From || '').replace('whatsapp:', '').trim();
  const response = (Body || '').trim();

  // Classify
  let estado = 'OTRO';
  let replyMsg = 'Gracias por tu respuesta. ¡Que tengas un excelente día!';

  if (response === '1' || response.toLowerCase().includes('si') || response.toLowerCase().includes('sí') || response.toLowerCase().includes('contactaron')) {
    estado = 'SI_CONTACTADO';
    replyMsg = '¡Excelente! Nos alegra saber que te contactaron. ¡Éxito con tu búsqueda! 🏡';
  } else if (response === '2' || response.toLowerCase().includes('no') || response.toLowerCase().includes('nadie')) {
    estado = 'NO_CONTACTADO';
    replyMsg = 'Lamentamos escuchar eso. Vamos a escalar tu caso para que te contacten a la brevedad.';
  } else if (response === '3' || response.toLowerCase().includes('llamaron') || response.toLowerCase().includes('contestar')) {
    estado = 'NO_CONTESTO';
    replyMsg = 'Entendido, te van a volver a contactar. ¡Gracias por tu respuesta!';
  }

  // Read current fiscalizacion.json from GitHub
  const GH_TOKEN = process.env.GH_TOKEN;
  const REPO = 'myp202021/cym-dashboard';
  const FILE_PATH = 'fiscalizacion.json';

  if (GH_TOKEN) {
    try {
      // Get current file
      const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
        headers: { 'Authorization': 'Bearer ' + GH_TOKEN, 'Accept': 'application/vnd.github.v3+json' }
      });

      let leads = [];
      let sha = null;

      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        const parsed = JSON.parse(content);
        leads = parsed.leads || [];
      }

      // Find lead by phone and update
      const phoneDigits = phone.replace(/[^0-9]/g, '').slice(-8);
      let found = false;
      for (let i = leads.length - 1; i >= 0; i--) {
        const leadDigits = (leads[i].telefono || '').replace(/[^0-9]/g, '').slice(-8);
        if (leadDigits === phoneDigits && !leads[i].wa_respuesta) {
          leads[i].wa_respuesta = estado;
          leads[i].wa_respuesta_raw = response;
          leads[i].wa_fecha_respuesta = new Date().toISOString();
          found = true;
          break;
        }
      }

      if (!found) {
        // New response without matching lead — store anyway
        leads.push({
          telefono: phone,
          wa_respuesta: estado,
          wa_respuesta_raw: response,
          wa_fecha_respuesta: new Date().toISOString(),
          nombre: 'Respuesta sin lead asociado'
        });
      }

      // Write back to GitHub
      const newContent = Buffer.from(JSON.stringify({ updated: new Date().toISOString(), leads }, null, 2)).toString('base64');
      await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + GH_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '📱 Respuesta WhatsApp: ' + phone + ' → ' + estado,
          content: newContent,
          sha: sha
        })
      });
    } catch (e) {
      console.error('GitHub write error:', e.message);
    }
  }

  // Reply via TwiML
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${replyMsg}</Message>
</Response>`);
}
