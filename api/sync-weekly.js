// Vercel Serverless: weekly_report 저장 (주간보고는 PIN 없이 저장 가능)
// 환경 변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');

const TABLE = 'weekly_report';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Server config missing' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const data = body.data;

  const weekLabel = String(data?.weekLabel ?? '').trim();
  const complete = Array.isArray(data?.complete) ? data.complete : [];
  const scheduled = Array.isArray(data?.scheduled) ? data.scheduled : [];

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { error: delErr } = await supabase.from(TABLE).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delErr) {
      console.error(delErr);
      return res.status(500).json({ error: 'Delete failed', detail: delErr.message });
    }
    const { error: insertErr } = await supabase.from(TABLE).insert({
      week_label: weekLabel,
      complete_data: complete,
      scheduled_data: scheduled,
    });
    if (insertErr) {
      console.error(insertErr);
      return res.status(500).json({ error: 'Insert failed', detail: insertErr.message });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
