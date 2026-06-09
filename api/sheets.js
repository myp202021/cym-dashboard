export default async function handler(req, res) {
  const { sheet } = req.query;
  if (!sheet) return res.status(400).json({ error: 'sheet param required' });

  const SHEET_ID = '11lsrC9TrlAlKNJ4qIiBzsiEY1gTe_tomENTjmW0duwE';
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;

  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error('Google Sheets HTTP ' + response.status);
    const text = await response.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
