// Vercel Serverless: PIN 검증 후 unpaid_items만 저장
// 환경 변수: EDITOR_PIN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');

const TABLE_UNPAID = 'unpaid_items';

function rowToUnpaid(row) {
  return {
    month: String(row.month ?? '').trim(),
    building_name: String(row.building_name ?? row.buildingName ?? '').trim(),
    project_name: String(row.project_name ?? row.projectName ?? '').trim(),
    invoice_date: String(row.invoice_date ?? row.invoiceDate ?? '').trim(),
    supply_amount: Number(row.supply_amount ?? row.supplyAmount) || 0,
  };
}

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

  const pin = process.env.EDITOR_PIN;
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

  const { pin: sentPin, data } = body;
  if (!pin || sentPin !== pin) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  const rows = Array.isArray(data) ? data : [];
  const toInsert = rows.map(rowToUnpaid);

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { error: delErr } = await supabase.from(TABLE_UNPAID).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delErr) {
      console.error(delErr);
      return res.status(500).json({ error: 'Delete failed', detail: delErr.message });
    }
    if (toInsert.length > 0) {
      const { error: insertErr } = await supabase.from(TABLE_UNPAID).insert(toInsert);
      if (insertErr) {
        console.error(insertErr);
        return res.status(500).json({ error: 'Insert failed', detail: insertErr.message });
      }
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
