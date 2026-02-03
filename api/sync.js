// Vercel Serverless: PIN 검증 후 Supabase에 대시보드 데이터 저장
// 환경 변수: EDITOR_PIN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');

const TABLE_DASHBOARD = 'dashboard_rows';
const TABLE_UNPAID = 'unpaid_items';

function rowToDashboard(row) {
  return {
    month: String(row.month ?? ''),
    cat1: String(row.cat1 ?? ''),
    cat2: String(row.cat2 ?? ''),
    cat3: String(row.cat3 ?? ''),
    count: Number(row.count) || 0,
    rev: Number(row.rev) || 0,
    purchase: Number(row.purchase) || 0,
    labor: Number(row.labor) || 0,
    sga: Number(row.sga) || 0,
  };
}

function rowToUnpaid(row) {
  return {
    month: String(row.month ?? ''),
    building_name: String(row.buildingName ?? row.building_name ?? '').trim(),
    invoice_date: String(row.invoiceDate ?? row.invoice_date ?? '').trim(),
    supply_amount: Number(row.supplyAmount ?? row.supply_amount) || 0,
  };
}

function isUnpaidEligible(row) {
  if (String(row.cat2 ?? '').trim() !== '관리건물') return false;
  const building = String(row.buildingName ?? row.building_name ?? '').trim();
  const invDate = String(row.invoiceDate ?? row.invoice_date ?? '').trim();
  const supplyAmt = Number(row.supplyAmount ?? row.supply_amount) || 0;
  if (!building && !invDate && supplyAmt === 0) return false;
  return true;
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
  const toDashboard = rows.map(rowToDashboard);
  const toUnpaid = rows.filter(isUnpaidEligible).map(rowToUnpaid);

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { error: delErr } = await supabase.from(TABLE_DASHBOARD).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delErr) {
      console.error(delErr);
      return res.status(500).json({ error: 'Delete failed', detail: delErr.message });
    }
    if (toDashboard.length > 0) {
      const { error: insertErr } = await supabase.from(TABLE_DASHBOARD).insert(toDashboard);
      if (insertErr) {
        console.error(insertErr);
        return res.status(500).json({ error: 'Insert failed', detail: insertErr.message });
      }
    }

    const { error: delUnpaidErr } = await supabase.from(TABLE_UNPAID).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delUnpaidErr) {
      console.error(delUnpaidErr);
      return res.status(500).json({ error: 'Unpaid delete failed', detail: delUnpaidErr.message });
    }
    if (toUnpaid.length > 0) {
      const { error: insertUnpaidErr } = await supabase.from(TABLE_UNPAID).insert(toUnpaid);
      if (insertUnpaidErr) {
        console.error(insertUnpaidErr);
        return res.status(500).json({ error: 'Unpaid insert failed', detail: insertUnpaidErr.message });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
