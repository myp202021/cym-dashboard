/**
 * Webhook para recibir respuestas de WhatsApp via Twilio
 *
 * Cuando un lead responde al mensaje de fiscalización (1, 2 o 3),
 * Twilio hace POST a este endpoint con la respuesta.
 *
 * Guardamos la respuesta en Google Sheets via Apps Script web app
 * y respondemos al lead con un mensaje de agradecimiento.
 */

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { Body, From, To, MessageSid } = req.body || {};

  if (!From || !Body) {
    return res.status(400).json({ error: 'Missing From or Body' });
  }

  // Parse phone number (remove "whatsapp:" prefix)
  const phone = (From || '').replace('whatsapp:', '').trim();
  const response = (Body || '').trim();

  console.log(`Webhook received: ${phone} → "${response}" (SID: ${MessageSid})`);

  // Classify response
  let estado = 'OTRO';
  let replyMsg = 'Gracias por tu respuesta. ¡Que tengas un excelente día!';

  if (response === '1' || response.toLowerCase().includes('si') || response.toLowerCase().includes('sí') || response.toLowerCase().includes('contactaron')) {
    estado = 'SI_CONTACTADO';
    replyMsg = '¡Excelente! Nos alegra saber que te contactaron. Si necesitas algo más, no dudes en escribirnos. ¡Éxito con tu búsqueda! 🏡';
  } else if (response === '2' || response.toLowerCase().includes('no') || response.toLowerCase().includes('nadie')) {
    estado = 'NO_CONTACTADO';
    replyMsg = 'Lamentamos escuchar eso. Vamos a escalar tu caso para que te contacten a la brevedad. ¡Gracias por avisarnos!';
  } else if (response === '3' || response.toLowerCase().includes('llamaron') || response.toLowerCase().includes('contestar') || response.toLowerCase().includes('contest')) {
    estado = 'NO_CONTESTO';
    replyMsg = 'Entendido, te van a volver a contactar en un horario que te acomode. ¡Gracias por tu respuesta!';
  }

  console.log(`Classified as: ${estado}`);

  // Write response to Google Sheets via Apps Script
  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_WEBHOOK;
  if (APPS_SCRIPT_URL) {
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'registrar_respuesta',
          data: {
            telefono: phone,
            respuesta: estado,
            respuesta_raw: response,
            fecha_respuesta: new Date().toISOString()
          }
        })
      });
      console.log('Response written to sheet');
    } catch (e) {
      console.error('Error writing to sheet:', e.message);
    }
  }

  // Reply to the lead via TwiML
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${replyMsg}</Message>
</Response>`);
}
