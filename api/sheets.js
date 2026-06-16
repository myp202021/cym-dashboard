export default async function handler(req, res) {
  const { sheet } = req.query;
  if (!sheet) return res.status(400).json({ error: 'sheet param required' });

  const SHEET_ID = '11lsrC9TrlAlKNJ4qIiBzsiEY1gTe_tomENTjmW0duwE';
  // Cache-bust Google Sheets gviz endpoint to always get fresh data
  const ts = Date.now();
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}&_=${ts}`;

  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error('Google Sheets HTTP ' + response.status);
    const text = await response.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Short cache: 30s fresh, no stale serving — dashboard auto-refreshes every 5 min
    res.setHeader('Cache-Control', 's-maxage=30, must-revalidate');
    res.status(200).send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
