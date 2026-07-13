// Vercel serverless function: read a tournament down-card photo with a vision
// model and return the dealers it finds, as an assistive cross-check against
// what the manager typed in. Never the source of truth — handwriting OCR is
// imperfect by design.
//
// Env vars (set in Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY   (required) — your Claude API key
//   OCR_MODEL           (optional) — defaults to claude-sonnet-5
const SUPABASE_URL = 'https://gyruqtngvjcwhgkhphxf.supabase.co';
// Publishable anon key (safe to embed — it's already in the client bundle).
// Used only to authenticate the caller's own token against Supabase, so the
// endpoint answers signed-in staff and no one else. Hardcoded (like the URL
// above) so it can't drift out of sync with a mis-pasted env var.
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cnVxdG5ndmpjd2hna2hwaHhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMzQzOTgsImV4cCI6MjA5ODYxMDM5OH0.h-uoieOFIOKyzNYWnddljzUoXlwRIOqGXuJbW987iqM';

const PROMPT = `This image is a poker tournament dealer "down card". Each row/slot is one ~30-minute dealing "down"; a dealer writes their name and sometimes a badge/employee number on the row they worked. Extract every FILLED-IN row (ignore blank rows and any printed headers/labels).
Return ONLY minified JSON, no prose: {"entries":[{"name":"","badge":""}]}. Use an empty string when a field is missing. One object per filled row (a dealer may appear on several rows).`;

async function verifyCaller(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
    });
    return r.ok;
  } catch { return false; }
}

async function readImage(url, apiKey, model) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });
  if (!r.ok) throw new Error(`vision api ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = (data.content || []).map(c => c.text || '').join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try { return JSON.parse(match[0]).entries || []; } catch { return []; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'OCR not configured — set ANTHROPIC_API_KEY in Vercel.' });
  if (!(await verifyCaller(req))) return res.status(401).json({ error: 'Not authorized' });

  const { imageUrls } = req.body || {};
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return res.status(400).json({ error: 'imageUrls (array) required' });
  }
  const model = process.env.OCR_MODEL || 'claude-sonnet-5';
  try {
    const all = [];
    for (const url of imageUrls.slice(0, 6)) {
      const entries = await readImage(url, apiKey, model);
      all.push(...entries);
    }
    return res.status(200).json({ entries: all });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'OCR failed' });
  }
}
