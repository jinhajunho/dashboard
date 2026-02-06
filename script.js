/* global Chart, ChartDataLabels */
Chart.register(ChartDataLabels);
let globalData = [];
let unpaidItemsData = [];
let trendChart = null;
let revealObserver = null;
let chartObserver = null;
let chartAnimated = false;
let editorPinValue = ''; // PIN 잠금 해제 시에만 저장, Supabase 쓰기용
let syncDebounceTimer = null;
let editorActiveTab = 'real'; // 'real' | 'sga' - 데이터 관리 내 실적/판관비 탭
const STORAGE_KEY = 'v31_dashboard_data'; // bumped for unpaid fields

const defaultData = [];

function ensureUnpaidFields(row) {
    return {
        ...row,
        buildingName: String(row.buildingName ?? '').trim(),
        projectName: String(row.projectName ?? '').trim(),
        invoiceDate: String(row.invoiceDate ?? '').trim(),
        progressStatus: String(row.progressStatus ?? '').trim(),
        paymentStatus: String(row.paymentStatus ?? '').trim(),
        paymentAmount: toNumber(row.paymentAmount),
        supplyAmount: toNumber(row.supplyAmount)
    };
}

function isSupabaseConfigured() {
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
}

function dbRowToLocal(row) {
    return ensureUnpaidFields({
        month: String(row.month ?? ''),
        cat1: String(row.cat1 ?? ''),
        cat2: String(row.cat2 ?? ''),
        cat3: String(row.cat3 ?? ''),
        count: Number(row.count) || 0,
        rev: Number(row.rev) || 0,
        purchase: Number(row.purchase) || 0,
        labor: Number(row.labor) || 0,
        sga: Number(row.sga) || 0,
        buildingName: row.building_name ?? row.buildingName ?? '',
        projectName: row.project_name ?? row.projectName ?? '',
        invoiceDate: row.invoice_date ?? row.invoiceDate ?? '',
        progressStatus: row.progress_status ?? row.progressStatus ?? '',
        paymentStatus: row.payment_status ?? row.paymentStatus ?? '',
        paymentAmount: row.payment_amount ?? row.paymentAmount ?? 0,
        supplyAmount: row.supply_amount ?? row.supplyAmount ?? 0
    });
}

async function loadData() {
    if (isSupabaseConfigured() && window.supabaseClient) {
        try {
            const [dashRes, unpaidRes] = await Promise.all([
                window.supabaseClient.from('dashboard_rows').select('month,cat1,cat2,cat3,count,rev,purchase,labor,sga').order('month'),
                window.supabaseClient.from('unpaid_items').select('*').order('month')
            ]);
            const dashData = dashRes.data || [];
            const unpaidRaw = unpaidRes.data || [];
            globalData = dashData.map(r => dbRowToLocal({ ...r, building_name: '', invoice_date: '', progress_status: '', payment_status: '', payment_amount: 0, supply_amount: 0 }));
            globalData = globalData.map(ensureUnpaidFields).sort((a, b) => a.month.localeCompare(b.month));
            unpaidItemsData = unpaidRaw.map(r => ensureUnpaidFields({
                month: r.month ?? '',
                buildingName: r.building_name ?? '',
                projectName: r.project_name ?? '',
                invoiceDate: r.invoice_date ?? '',
                supplyAmount: Number(r.supply_amount) || 0
            }));
            return;
        } catch (e) {
            console.warn('Supabase load failed', e);
        }
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    globalData = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(defaultData));
    globalData = globalData.filter(r => !isUnpaidItemRow(r)).map(ensureUnpaidFields);
    unpaidItemsData = [];
}

async function loadWeeklyReport() {
    if (!isSupabaseConfigured() || !window.supabaseClient) return;
    try {
        const { data } = await window.supabaseClient.from('weekly_report').select('week_label, complete_data, scheduled_data').order('created_at', { ascending: false }).limit(1);
        const row = data && data[0];
        if (row) {
            weeklyReportData = {
                complete: Array.isArray(row.complete_data) ? row.complete_data : [],
                scheduled: Array.isArray(row.scheduled_data) ? row.scheduled_data : [],
                weekLabel: String(row.week_label ?? '')
            };
        }
    } catch (e) {
        console.warn('Weekly report load failed', e);
    }
}

window.onload = async function() {
    if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY && typeof window.supabase !== 'undefined') {
        window.supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
    await loadData();
    await loadWeeklyReport();

    renderEditorTab();
    updateFilterOptions();
    renderAll();

    const csvInput = document.getElementById('csvInput');
    if (csvInput) {
        csvInput.addEventListener('change', handleCsvFileChange);
    }
    const unpaidCsvInput = document.getElementById('unpaidCsvInput');
    if (unpaidCsvInput) {
        unpaidCsvInput.addEventListener('change', handleUnpaidCsvFileChange);
    }
    const weeklyCsvInput = document.getElementById('weeklyCsvInput');
    if (weeklyCsvInput) {
        weeklyCsvInput.addEventListener('change', handleWeeklyCsvFileChange);
    }
    const sgaCsvInput = document.getElementById('sgaCsvInput');
    if (sgaCsvInput) {
        sgaCsvInput.addEventListener('change', handleSgaCsvFileChange);
    }

    setupTheme();
    setupMonthSelect();
    setupTableTabs();
    setupEditorTabs();
    setupEditorDropdowns();
    setupSettingsMenu();
    setupSgaPin();
    setupRevealAnimations();
};

function isSgaRow(row) {
    const r = ensureUnpaidFields(row || {});
    return String(r.cat2 || '').trim() === '판관비' || String(r.cat1 || '').trim() === '본사' || (Number(r.sga) || 0) > 0;
}

function isUnpaidItemRow(row) {
    const r = ensureUnpaidFields(row || {});
    if (String(r.cat2 || '').trim() !== '관리건물') return false;
    return !!(String(r.buildingName || '').trim() || String(r.projectName || '').trim() || String(r.invoiceDate || '').trim());
}

// 탭 전환 기능 (에디터는 PIN 입력한 사람만 접근 가능, 별도 로그인 없음)
function switchTab(tabName) {
    // 에디터(데이터 관리)는 PIN 잠금 해제된 경우에만 진입 가능
    if (tabName === 'editor') {
        const unlocked = sessionStorage.getItem('sga_unlocked') === '1';
        if (!unlocked) {
            const menu = document.getElementById('settingsMenu');
            const pinInput = document.getElementById('pinInput');
            if (menu && pinInput) {
                menu.classList.add('is-open');
                menu.setAttribute('aria-hidden', 'false');
                pinInput.focus();
            }
            alert('데이터 수정은 PIN 입력 후 가능합니다.');
            return;
        }
    }

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    
    const tabBtn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
    if (tabBtn) {
        tabBtn.classList.add('active');
    }
    
    const page = document.getElementById(`page-${tabName}`);
    if (page) {
        page.classList.add('active');
    }

    if (tabName === 'dashboard') {
        updateDataFromEditor();
        renderAll();
    } else if (tabName === 'unpaid') {
        renderUnpaid();
    } else if (tabName === 'weekly') {
        renderWeekly();
    } else if (tabName === 'editor') {
        renderEditorTab();
    }

    const menu = document.getElementById('settingsMenu');
    if (menu) {
        menu.classList.remove('is-open');
        menu.setAttribute('aria-hidden', 'true');
    }
}

// --- Editor Functions ---
function renderEditorTab() {
    if (editorActiveTab === 'sga') {
        renderSgaEditor();
    } else {
        renderEditor();
    }
}

function resetEditorMonthFilterToAll() {
    ['editorMonthFilter', 'editorSgaMonthFilter'].forEach(id => {
        const input = document.getElementById(id);
        const btn = document.getElementById(id === 'editorMonthFilter' ? 'editorMonthFilterBtn' : 'editorSgaMonthFilterBtn');
        if (input && btn) {
            input.value = 'ALL';
            btn.textContent = '전체';
        }
    });
}

function updateEditorMonthFilterOptions() {
    const input = document.getElementById('editorMonthFilter');
    const list = document.getElementById('editorMonthFilterList');
    const btn = document.getElementById('editorMonthFilterBtn');
    if (!input || !list || !btn) return;
    const currentVal = input.value;
    const months = [...new Set(globalData.filter(r => !isSgaRow(r)).map(d => d.month).filter(Boolean))].sort();
    list.innerHTML = '';
    const addItem = (val, label) => {
        const el = document.createElement('div');
        el.className = 'editor-dropdown-item' + (val === currentVal ? ' is-selected' : '');
        el.textContent = label;
        el.dataset.value = val;
        el.addEventListener('click', () => {
            input.value = val;
            btn.textContent = label;
            list.querySelectorAll('.editor-dropdown-item').forEach(i => i.classList.remove('is-selected'));
            el.classList.add('is-selected');
            document.getElementById('editorMonthFilterShell')?.classList.remove('is-open');
            renderEditorTab();
        });
        list.appendChild(el);
    };
    addItem('ALL', '전체');
    months.forEach(m => addItem(m, m));
    const validVal = (currentVal === 'ALL' || months.includes(currentVal)) ? currentVal : 'ALL';
    input.value = validVal;
    btn.textContent = validVal === 'ALL' ? '전체' : validVal;
}

function updateEditorSgaMonthFilterOptions() {
    const input = document.getElementById('editorSgaMonthFilter');
    const list = document.getElementById('editorSgaMonthFilterList');
    const btn = document.getElementById('editorSgaMonthFilterBtn');
    if (!input || !list || !btn) return;
    const currentVal = input.value;
    const months = [...new Set(globalData.filter(r => isSgaRow(r)).map(d => d.month).filter(Boolean))].sort();
    list.innerHTML = '';
    const addItem = (val, label) => {
        const el = document.createElement('div');
        el.className = 'editor-dropdown-item' + (val === currentVal ? ' is-selected' : '');
        el.textContent = label;
        el.dataset.value = val;
        el.addEventListener('click', () => {
            input.value = val;
            btn.textContent = label;
            list.querySelectorAll('.editor-dropdown-item').forEach(i => i.classList.remove('is-selected'));
            el.classList.add('is-selected');
            document.getElementById('editorSgaMonthFilterShell')?.classList.remove('is-open');
            renderEditorTab();
        });
        list.appendChild(el);
    };
    addItem('ALL', '전체');
    months.forEach(m => addItem(m, m));
    const validVal = (currentVal === 'ALL' || months.includes(currentVal)) ? currentVal : 'ALL';
    input.value = validVal;
    btn.textContent = validVal === 'ALL' ? '전체' : validVal;
}

function renderEditor() {
    const tbody = document.getElementById('editorBody');
    const filterInput = document.getElementById('editorMonthFilter');
    if (!tbody) return;
    updateEditorMonthFilterOptions();
    const filterVal = filterInput ? filterInput.value : 'ALL';
    tbody.innerHTML = '';
    globalData.forEach((row, idx) => {
        if (isSgaRow(row)) return;
        if (filterVal !== 'ALL' && row.month !== filterVal) return;
        const r = ensureUnpaidFields(row);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;"><button class="btn-del" onclick="deleteRow(${idx})">✖</button></td>
            <td><input type="text" value="${escapeAttr(r.month)}" onchange="editData(${idx}, 'month', this.value)"></td>
            <td><input type="text" value="${escapeAttr(r.cat1)}" onchange="editData(${idx}, 'cat1', this.value)"></td>
            <td><input type="text" value="${escapeAttr(r.cat2)}" onchange="editData(${idx}, 'cat2', this.value)"></td>
            <td><input type="text" value="${escapeAttr(r.cat3)}" onchange="editData(${idx}, 'cat3', this.value)"></td>
            <td><input type="number" value="${r.count}" onchange="editData(${idx}, 'count', this.value)"></td>
            <td><input type="number" value="${r.rev}" onchange="editData(${idx}, 'rev', this.value)"></td>
            <td><input type="number" value="${r.purchase}" onchange="editData(${idx}, 'purchase', this.value)"></td>
            <td><input type="number" value="${r.labor}" onchange="editData(${idx}, 'labor', this.value)"></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderSgaEditor() {
    const tbody = document.getElementById('sgaEditorBody');
    const filterInput = document.getElementById('editorSgaMonthFilter');
    if (!tbody) return;
    updateEditorSgaMonthFilterOptions();
    const filterVal = filterInput ? filterInput.value : 'ALL';
    tbody.innerHTML = '';
    const sgaRows = [];
    globalData.forEach((row, idx) => {
        if (!isSgaRow(row)) return;
        if (filterVal !== 'ALL' && row.month !== filterVal) return;
        sgaRows.push({ row: ensureUnpaidFields(row), idx });
    });
    sgaRows.forEach(({ row: r, idx }) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;"><button class="btn-del" onclick="deleteSgaRow(${idx})">✖</button></td>
            <td><input type="text" value="${escapeAttr(r.month)}" onchange="editSgaData(${idx}, 'month', this.value)"></td>
            <td><input type="text" value="${escapeAttr(r.cat1)}" onchange="editSgaData(${idx}, 'cat1', this.value)"></td>
            <td><input type="text" value="${escapeAttr(r.cat2)}" onchange="editSgaData(${idx}, 'cat2', this.value)"></td>
            <td><input type="text" value="${escapeAttr(r.cat3)}" onchange="editSgaData(${idx}, 'cat3', this.value)"></td>
            <td><input type="number" value="${r.count}" onchange="editSgaData(${idx}, 'count', this.value)"></td>
            <td><input type="number" value="${r.sga}" onchange="editSgaData(${idx}, 'sga', this.value)"></td>
        `;
        tbody.appendChild(tr);
    });
}

function editSgaData(idx, key, val) {
    const numKeys = ['count','rev','purchase','labor','sga'];
    if (numKeys.includes(key)) {
        globalData[idx][key] = Number(val) || 0;
    } else {
        globalData[idx][key] = val;
    }
    saveToLocal();
}

function addRowForActiveTab() {
    if (editorActiveTab === 'sga') addSgaRow();
    else addRow();
}

function resetForActiveTab() {
    if (editorActiveTab === 'sga') resetSgaData();
    else resetData();
}

function addSgaRow() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    globalData.push({
        month: `${yyyy}-${mm}`, cat1: '본사', cat2: '판관비', cat3: '', count: 0, rev: 0, purchase: 0, labor: 0, sga: 0,
        buildingName: '', invoiceDate: '', progressStatus: '', paymentStatus: '', paymentAmount: 0, supplyAmount: 0
    });
    globalData.sort((a, b) => a.month.localeCompare(b.month));
    renderEditorTab();
    saveToLocal();
}

function deleteSgaRow(idx) {
    if (confirm('이 데이터를 삭제하시겠습니까?')) {
        globalData.splice(idx, 1);
        renderEditorTab();
        saveToLocal();
    }
}

function resetSgaData() {
    if (confirm('판관비만 초기화하시겠습니까? (실적·미수금은 유지됩니다)')) {
        globalData = globalData.filter(r => !isSgaRow(r));
        renderEditorTab();
        saveToLocal();
        updateFilterOptions();
        renderAll();
        alert('판관비가 초기화되었습니다.');
    }
}

function triggerSgaCsvInput() {
    const input = document.getElementById('sgaCsvInput');
    if (input) { input.value = ''; input.click(); }
}

function handleSgaCsvFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
        alert('CSV 파일만 업로드할 수 있습니다.');
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target?.result;
        if (typeof text !== 'string') return;
        if (typeof Papa === 'undefined') {
            alert('CSV 파서가 로드되지 않았습니다.');
            return;
        }
        Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                const headerMap = buildHeaderMap(results.meta && results.meta.fields || []);
                const newRows = [];
                (results.data || []).forEach(raw => {
                    const mapped = mapCsvRow(raw, headerMap);
                    if (mapped && isSgaRow(mapped)) newRows.push(mapped);
                });
                if (newRows.length === 0) {
                    alert('판관비 행이 없습니다. (중분류=판관비 또는 대분류=본사 또는 판관비>0인 행 필요)');
                    return;
                }
                const uploadedMonths = [...new Set(newRows.map(r => r.month).filter(Boolean))];
                const existingReal = globalData.filter(r => !isSgaRow(r));
                const existingSga = globalData.filter(r => isSgaRow(r));
                const sgaToKeep = existingSga.filter(r => !uploadedMonths.includes(r.month));
                globalData = [...existingReal, ...sgaToKeep, ...newRows.map(r => ensureUnpaidFields(r))];
                globalData.sort((a, b) => a.month.localeCompare(b.month));
                resetEditorMonthFilterToAll();
                renderEditorTab();
                saveToLocal();
                updateFilterOptions();
                renderAll();
                alert('판관비 CSV 업로드가 완료되었습니다. (업로드된 월만 반영, ' + uploadedMonths.length + '개월, ' + newRows.length + '건)' + (!editorPinValue ? '\n\n※ Supabase 반영을 위해 PIN을 입력해 주세요.' : ''));
            }
        });
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
}

function editData(idx, key, val) {
    const numKeys = ['count','rev','purchase','labor','sga','paymentAmount','supplyAmount'];
    if (numKeys.includes(key)) {
        globalData[idx][key] = Number(val) || 0;
    } else {
        globalData[idx][key] = val;
    }
    saveToLocal();
}

function addRow() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    globalData.push({
        month:`${yyyy}-${mm}`, cat1:"", cat2:"", cat3:"", count:0, rev:0, purchase:0, labor:0, sga:0,
        buildingName:"", invoiceDate:"", progressStatus:"", paymentStatus:"", paymentAmount:0, supplyAmount:0
    });
    renderEditorTab();
    saveToLocal();
}

function deleteRow(idx) {
    if(confirm("이 데이터를 삭제하시겠습니까?")) {
        globalData.splice(idx, 1);
        renderEditorTab();
        saveToLocal();
    }
}

function resetData() {
    if(confirm("실적만 초기화하시겠습니까? (판관비·미수금은 유지됩니다)")) {
        globalData = globalData.filter(r => isSgaRow(r));
        renderEditorTab();
        saveToLocal();
        updateFilterOptions();
        renderAll();
        if (syncDebounceTimer) { clearTimeout(syncDebounceTimer); syncDebounceTimer = null; }
        syncToSupabase();
        alert("초기화되었습니다.");
    }
}

function triggerCsvInput() {
    const csvInput = document.getElementById('csvInput');
    if (csvInput) {
        csvInput.click();
    }
}

function triggerUnpaidCsvInput() {
    const unpaidCsvInput = document.getElementById('unpaidCsvInput');
    if (unpaidCsvInput) {
        unpaidCsvInput.click();
    }
}

function triggerWeeklyCsvInput() {
    const weeklyCsvInput = document.getElementById('weeklyCsvInput');
    if (weeklyCsvInput) {
        weeklyCsvInput.click();
    }
}

let weeklyReportData = { complete: [], scheduled: [], weekLabel: '' };

function getKoreaWeekRange() {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = formatter.formatToParts(new Date());
    const y = parseInt(parts.find(p => p.type === 'year').value, 10);
    const m = parseInt(parts.find(p => p.type === 'month').value, 10) - 1;
    const d = parseInt(parts.find(p => p.type === 'day').value, 10);
    const dayOfWeek = new Date(y, m, d).getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisMonday = new Date(y, m, d - daysFromMonday);
    const thisSunday = new Date(thisMonday);
    thisSunday.setDate(thisMonday.getDate() + 6);
    const nextMonday = new Date(thisMonday);
    nextMonday.setDate(thisMonday.getDate() + 7);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    const pad = n => String(n).padStart(2, '0');
    const thisWeekStart = `${thisMonday.getFullYear()}-${pad(thisMonday.getMonth() + 1)}-${pad(thisMonday.getDate())}`;
    const thisWeekEnd = `${thisSunday.getFullYear()}-${pad(thisSunday.getMonth() + 1)}-${pad(thisSunday.getDate())}`;
    const nextWeekStart = `${nextMonday.getFullYear()}-${pad(nextMonday.getMonth() + 1)}-${pad(nextMonday.getDate())}`;
    const nextWeekEnd = `${nextSunday.getFullYear()}-${pad(nextSunday.getMonth() + 1)}-${pad(nextSunday.getDate())}`;
    return {
        thisWeekStart,
        thisWeekEnd,
        nextWeekStart,
        nextWeekEnd,
        weekLabel: `완료: ${thisWeekStart}~${thisWeekEnd} / 예정: ${nextWeekStart}~${nextWeekEnd}`
    };
}

function parseDateToYmd(val) {
    const s = String(val || '').trim();
    if (!s) return '';
    const m = s.match(/(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return s;
}

function isDateInWeek(dateYmd, weekStart, weekEnd) {
    if (!dateYmd || !weekStart || !weekEnd) return false;
    return dateYmd >= weekStart && dateYmd <= weekEnd;
}

function buildWeeklyHeaderMap(fields) {
    const map = {};
    (fields || []).forEach(field => {
        const key = normalizeHeader(field);
        const f = String(field || '').trim();
        if (['건물명','buildingname','building_name'].includes(key)) map[field] = 'building_name';
        if (['공사명','프로젝트명','projectname','project_name'].includes(key)) map[field] = 'project_name';
        if (['진행일','progressdate','progress_date','예정일','매출예정일','착수예정일'].includes(key)) map[field] = 'progress_date';
        if ((f.includes('진행') || f.includes('예정')) && f.includes('일') && !f.includes('상태')) map[field] = 'progress_date';
        if (['완료일','completiondate','completion_date','매출완료일','실제완료일'].includes(key)) map[field] = 'completion_date';
        if (f.includes('완료') && f.includes('일')) map[field] = 'completion_date';
        if (['진행상태','progressstatus','progress_status'].includes(key)) map[field] = 'progress_status';
    });
    return map;
}

function handleWeeklyCsvFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
        alert('CSV 파일만 업로드할 수 있습니다.');
        event.target.value = '';
        return;
    }
    const emptyEl = document.getElementById('weeklyReportEmpty');
    if (emptyEl) emptyEl.textContent = 'CSV 분석 중...';
    function doRead(encoding) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target?.result;
            if (typeof text !== 'string') {
                const el = document.getElementById('weeklyReportEmpty');
                if (el) el.textContent = 'CSV를 업로드하면 주간보고가 표시됩니다.';
                alert('파일을 읽을 수 없습니다.');
                return;
            }
            const retryFn = (encoding === 'UTF-8') ? function() { doRead('EUC-KR'); } : null;
            parseWeeklyCsvText(text, file.name, retryFn, file);
        };
        reader.onerror = function() {
            const el = document.getElementById('weeklyReportEmpty');
            if (el) el.textContent = 'CSV를 업로드하면 주간보고가 표시됩니다.';
            if (encoding === 'UTF-8') doRead('EUC-KR');
            else alert('파일을 읽는 중 오류가 발생했습니다.');
        };
        reader.readAsText(file, encoding);
    }
    doRead('UTF-8');
    event.target.value = '';
}

function parseWeeklyCsvText(csvText, fileName, retryWithUtf8, file) {
    if (typeof Papa === 'undefined') {
        alert('CSV 파서가 로드되지 않았습니다.');
        return;
    }
    const week = getKoreaWeekRange();
    Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        worker: false,
        complete: async function(results) {
            try {
            const rawRows = results.data || [];
            const headerMap = buildWeeklyHeaderMap(results.meta && results.meta.fields);
            const complete = [];
            const scheduled = [];
            rawRows.forEach(raw => {
                const row = { building_name: '', project_name: '', progress_date: '', completion_date: '', progress_status: '' };
                Object.keys(raw || {}).forEach(field => {
                    const key = headerMap[field];
                    if (key === 'building_name') row.building_name = String(raw[field] ?? '').trim();
                    if (key === 'project_name') row.project_name = String(raw[field] ?? '').trim();
                    if (key === 'progress_date') row.progress_date = parseDateToYmd(raw[field]);
                    if (key === 'completion_date') row.completion_date = parseDateToYmd(raw[field]);
                    if (key === 'progress_status') row.progress_status = String(raw[field] ?? '').trim();
                });
                const status = row.progress_status;
                const building = row.building_name || row.project_name;
                const project = row.project_name || row.building_name;
                if (!building && !project) return;
                const label = (building && project) ? `${building} - ${project}` : (building || project || '-');
                const item = { building: building || '-', project: project || '-', label };
                if (status === '완료' && isDateInWeek(row.completion_date, week.thisWeekStart, week.thisWeekEnd)) {
                    complete.push(item);
                } else if (status === '진행' && isDateInWeek(row.progress_date, week.nextWeekStart, week.nextWeekEnd)) {
                    scheduled.push(item);
                }
            });
            weeklyReportData = { complete, scheduled, weekLabel: week.weekLabel };

            const emptyEl2 = document.getElementById('weeklyReportEmpty');
            if (emptyEl2) emptyEl2.textContent = 'CSV를 업로드하면 주간보고가 표시됩니다.';
            if (complete.length === 0 && scheduled.length === 0) {
                if (typeof retryWithUtf8 === 'function' && file) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        const text = e.target?.result;
                        if (typeof text === 'string') parseWeeklyCsvText(text, fileName, null, null);
                        else alert('조건에 맞는 데이터가 없습니다.\n\n• 완료건: 진행상태=완료, 완료일이 이번 주(월~일)\n• 예정건: 진행상태=진행, 진행일이 다음 주\n• 필요한 컬럼: 진행일, 완료일, 진행상태, 건물명, 공사명');
                    };
                    reader.readAsText(file, 'EUC-KR');
                    return;
                }
                const headers = (results.meta && results.meta.fields) ? results.meta.fields.slice(0, 8).join(', ') : '(없음)';
                alert('조건에 맞는 데이터가 없습니다.\n\nCSV ' + rawRows.length + '행 읽음. 컬럼: ' + headers + '\n\n• 완료건: 진행상태=완료, 완료일이 이번 주\n• 예정건: 진행상태=진행, 진행일이 다음 주\n• 필요: 진행일, 완료일, 진행상태, 건물명, 공사명\n\nExcel에서 "다른 이름으로 저장" → CSV UTF-8(쉼표로 분리)로 저장해 보세요.');
                return;
            }

            renderWeekly();

            const willSave = isSupabaseConfigured();

            if (willSave) {
                const apiBase = window.API_BASE_URL || '';
                try {
                    const res = await fetch(apiBase + '/api/sync-weekly', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data: weeklyReportData })
                    });
                    const json = await res.json().catch(() => ({}));
                    if (res.ok) {
                        alert('주간보고가 반영되었습니다. (완료 ' + complete.length + '건, 예정 ' + scheduled.length + '건)\n\n다른 기기에서도 확인할 수 있습니다.');
                    } else {
                        const errMsg = json.detail || json.error || 'HTTP ' + res.status;
                        console.error('주간보고 저장 실패:', res.status, json);
                        alert('주간보고 표시됨 (완료 ' + complete.length + '건, 예정 ' + scheduled.length + '건)\n\n⚠️ 저장 실패: ' + errMsg);
                    }
                } catch (e) {
                    console.error('주간보고 Supabase 저장 오류:', e);
                    alert('주간보고 표시됨 (완료 ' + complete.length + '건, 예정 ' + scheduled.length + '건)\n\n⚠️ 저장 실패: ' + (e.message || '네트워크 오류. 껐다 켜면 사라집니다.'));
                }
            } else {
                alert('주간보고가 표시되었습니다. (완료 ' + complete.length + '건, 예정 ' + scheduled.length + '건)');
            }
            } catch (err) {
                console.error('주간보고 파싱 오류:', err);
                const el = document.getElementById('weeklyReportEmpty');
                if (el) el.textContent = 'CSV를 업로드하면 주간보고가 표시됩니다.';
                alert('처리 중 오류가 발생했습니다. 개발자 도구(F12) 콘솔을 확인해 주세요.');
            }
        },
        error: function(err) {
            const el = document.getElementById('weeklyReportEmpty');
            if (el) el.textContent = 'CSV를 업로드하면 주간보고가 표시됩니다.';
            alert('CSV 파일을 읽는 중 오류가 발생했습니다.');
        }
    });
}

function renderWeekly() {
    const contentEl = document.getElementById('weeklyReportContent');
    const emptyEl = document.getElementById('weeklyReportEmpty');
    const weekLabelEl = document.getElementById('weeklyReportWeek');
    const completeHeader = document.getElementById('weeklyCompleteHeader');
    const completeList = document.getElementById('weeklyCompleteList');
    const scheduledHeader = document.getElementById('weeklyScheduledHeader');
    const scheduledList = document.getElementById('weeklyScheduledList');
    if (!contentEl || !emptyEl) return;

    const { complete, scheduled, weekLabel } = weeklyReportData;
    const hasData = complete.length > 0 || scheduled.length > 0;

    contentEl.style.display = hasData ? 'block' : 'none';
    emptyEl.style.display = hasData ? 'none' : 'block';

    if (hasData) {
        if (weekLabelEl) weekLabelEl.textContent = `기준 주: ${weekLabel || getKoreaWeekRange().weekLabel}`;
        completeHeader.textContent = `1. 공사 완료건(${complete.length}건)`;
        scheduledHeader.textContent = `2. 공사 예정(${scheduled.length}건)`;
        completeList.innerHTML = complete.map((i, idx) => `<li><span>${escapeAttr(i.label)}</span> <button class="btn-del" style="margin-left:8px; padding:2px 6px; font-size:0.75rem;" onclick="deleteWeeklyItem('complete', ${idx})">삭제</button></li>`).join('');
        scheduledList.innerHTML = scheduled.map((i, idx) => `<li><span>${escapeAttr(i.label)}</span> <button class="btn-del" style="margin-left:8px; padding:2px 6px; font-size:0.75rem;" onclick="deleteWeeklyItem('scheduled', ${idx})">삭제</button></li>`).join('');
    }
}

function toCsvRow(cells) {
    return cells.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
}

function downloadCsvBlob(csv, filename) {
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

function downloadRealCsv() {
    const rows = globalData.filter(r => !isSgaRow(r));
    if (rows.length === 0) {
        alert('다운로드할 실적 데이터가 없습니다.');
        return;
    }
    const header = ['월', '대분류', '중분류', '소분류', '건수', '매출', '매입', '사업소득', '판관비'];
    const lines = [toCsvRow(header)];
    rows.forEach(r => {
        const x = ensureUnpaidFields(r);
        lines.push(toCsvRow([x.month, x.cat1, x.cat2, x.cat3, x.count, x.rev, x.purchase, x.labor, x.sga]));
    });
    const today = new Date().toISOString().slice(0, 10);
    downloadCsvBlob(lines.join('\n'), `실적_${today}.csv`);
}

function downloadSgaCsv() {
    const rows = globalData.filter(r => isSgaRow(r));
    if (rows.length === 0) {
        alert('다운로드할 판관비 데이터가 없습니다.');
        return;
    }
    const header = ['월', '대분류', '중분류', '소분류', '건수', '매출', '매입', '사업소득', '판관비'];
    const lines = [toCsvRow(header)];
    rows.forEach(r => {
        const x = ensureUnpaidFields(r);
        lines.push(toCsvRow([x.month, x.cat1, x.cat2, x.cat3, x.count, x.rev, x.purchase, x.labor, x.sga]));
    });
    const today = new Date().toISOString().slice(0, 10);
    downloadCsvBlob(lines.join('\n'), `판관비_${today}.csv`);
}

function downloadUnpaidCsv() {
    const filtered = unpaidItemsData.filter(row => {
        const r = ensureUnpaidFields(row);
        const building = String(r.buildingName || '').trim();
        const supply = Number(r.supplyAmount) || 0;
        return !!(building || r.invoiceDate || supply > 0);
    });
    if (filtered.length === 0) {
        alert('다운로드할 미수금 데이터가 없습니다.');
        return;
    }
    const header = ['건물명', '프로젝트명', '매출 발행일', '공급가액'];
    const lines = [toCsvRow(header)];
    filtered.forEach(r => {
        const x = ensureUnpaidFields(r);
        lines.push(toCsvRow([x.buildingName, x.projectName, x.invoiceDate, x.supplyAmount]));
    });
    const today = new Date().toISOString().slice(0, 10);
    downloadCsvBlob(lines.join('\n'), `미수금_${today}.csv`);
}

function downloadWeeklyReport() {
    const { complete, scheduled, weekLabel } = weeklyReportData;
    if (complete.length === 0 && scheduled.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }
    const rows = [];
    rows.push(['구분', '건물명', '공사명']);
    complete.forEach(i => {
        rows.push(['완료', i.building, i.project]);
    });
    scheduled.forEach(i => {
        rows.push(['예정', i.building, i.project]);
    });
    const csv = rows.map(r => toCsvRow(r)).join('\n');
    downloadCsvBlob(csv, `주간보고_${weekLabel.replace(/\s/g, '')}.csv`);
}

function buildUnpaidHeaderMap(fields) {
    const map = {};
    (fields || []).forEach(field => {
        const key = normalizeHeader(field);
        const f = String(field || '').trim();
        if (['월','month','yyyymm','date','기간','등록일','완료일'].includes(key)) map[field] = 'month';
        if (['건물명','buildingname','building_name'].includes(key)) map[field] = 'building_name';
        if (['프로젝트명','공사명','projectname','project_name'].includes(key)) map[field] = 'project_name';
        if (['매출발행일','매출발행','invoicedate','invoice_date'].includes(key)) map[field] = 'invoice_date';
        if (f.includes('매출') && f.includes('발행')) map[field] = 'invoice_date';
        if (['공급가액','supplyamount','supply_amount','매출공급','매출공급가액','매출공급가'].includes(key)) map[field] = 'supply_amount';
        if (f.includes('매출') && f.includes('공급') && !f.includes('부가')) map[field] = 'supply_amount';
        if (['중분류','cat2'].includes(key)) map[field] = 'cat2';
        if (['수금상태','수금현황','paymentstatus'].includes(key)) map[field] = 'payment_status';
        if (['수금액','paymentamount'].includes(key)) map[field] = 'payment_amount';
        if (['진행상태','progressstatus'].includes(key)) map[field] = 'progress_status';
    });
    return map;
}


function handleUnpaidCsvFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
        alert('CSV 파일만 업로드할 수 있습니다.');
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        let text = e.target?.result;
        if (typeof text !== 'string') return;
        parseUnpaidCsvText(text, file.name);
    };
    reader.readAsText(file, 'EUC-KR');
    event.target.value = '';
}

function parseUnpaidCsvText(csvText, fileName) {
    if (typeof Papa === 'undefined') {
        alert('CSV 파서가 로드되지 않았습니다.');
        return;
    }
    Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: async function(results) {
            const headerMap = buildUnpaidHeaderMap(results.meta && results.meta.fields);
            const rows = [];
            (results.data || []).forEach(raw => {
                const row = { month: '', building_name: '', project_name: '', invoice_date: '', supply_amount: 0 };
                Object.keys(raw || {}).forEach(field => {
                    const key = headerMap[field];
                    if (key === 'month') {
                        const v = String(raw[field] ?? '').trim();
                        const m = v.match(/^(\d{4})-(\d{1,2})/);
                        row.month = m ? `${m[1]}-${m[2].padStart(2,'0')}` : v;
                    }
                    if (key === 'building_name') row.building_name = String(raw[field] ?? '').trim();
                    if (key === 'project_name') row.project_name = String(raw[field] ?? '').trim();
                    if (key === 'invoice_date') row.invoice_date = String(raw[field] ?? '').trim();
                    if (key === 'supply_amount') row.supply_amount = toNumber(raw[field]);
                    if (key === 'cat2') row.cat2 = String(raw[field] ?? '').trim();
                    if (key === 'payment_status') row.payment_status = String(raw[field] ?? '').trim();
                    if (key === 'payment_amount') row.payment_amount = toNumber(raw[field]);
                    if (key === 'progress_status') row.progress_status = String(raw[field] ?? '').trim();
                });
                const isManaged = String(row.cat2 || '').trim() === '관리건물';
                const isComplete = String(row.progress_status || '').trim() === '완료';
                const hasInvoiceDate = String(row.invoice_date || '').trim().length > 0;
                const payStatus = String(row.payment_status || '').trim();
                const payAmtField = Object.keys(raw || {}).find(f => headerMap[f] === 'payment_amount');
                const payAmtVal = payAmtField != null ? raw[payAmtField] : null;
                const payAmtEmpty = payAmtVal === '' || payAmtVal == null || String(payAmtVal).trim() === '';
                const payAmt = toNumber(payAmtVal);
                const isUnpaid = hasInvoiceDate && (payStatus === '미수' || payAmt === 0 || payAmtEmpty);
                if (isManaged && isComplete && isUnpaid && (row.building_name || row.invoice_date || row.supply_amount > 0)) {
                    if (!row.month && row.invoice_date) row.month = parseDateToMonth(row.invoice_date);
                    rows.push(row);
                }
            });
            if (rows.length === 0) {
                alert('유효한 미수금 데이터가 없습니다. 중분류 "관리건물", 진행상태 "완료", 수금미완료(미수/수금액0/비어있음)인 행이 있는지 확인해 주세요.');
                return;
            }
            const apiBase = window.API_BASE_URL || '';
            if (!isSupabaseConfigured()) {
                alert('Supabase가 설정되지 않았습니다.');
                return;
            }
            try {
                const res = await fetch(apiBase + '/api/sync-unpaid', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: rows })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    alert('저장 실패: ' + (json.detail || json.error || '오류가 발생했습니다.'));
                    return;
                }
                unpaidItemsData = rows.map(r => ensureUnpaidFields({
                    month: r.month || parseDateToMonth(r.invoice_date || r.invoiceDate) || '',
                    buildingName: r.building_name || r.buildingName || '',
                    projectName: r.project_name || r.projectName || '',
                    invoiceDate: r.invoice_date || r.invoiceDate || '',
                    supplyAmount: Number(r.supply_amount ?? r.supplyAmount) || 0
                }));
                renderUnpaid();
                alert('미수금 데이터가 업로드되었습니다. (' + rows.length + '건)');
            } catch (e) {
                console.error(e);
                alert('업로드 중 오류가 발생했습니다.');
            }
        },
        error: function() {
            alert('CSV 파일을 읽는 중 오류가 발생했습니다.');
        }
    });
}

function handleCsvFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
        alert('CSV 파일만 업로드할 수 있습니다. 엑셀에서 CSV로 저장해 주세요.');
        event.target.value = '';
        return;
    }
    parseCsvFile(file);
    event.target.value = '';
}

function parseCsvFile(file) {
    if (typeof Papa === 'undefined') {
        alert('CSV 파서가 로드되지 않았습니다.');
        return;
    }

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            const rawData = results.data || [];
            const fields = results.meta && results.meta.fields || [];
            const aggregated = tryParseProjectCsvAndAggregate(rawData, fields);
            if (aggregated) {
                const uploadedMonths = [...new Set(aggregated.map(r => r.month).filter(Boolean))];
                const existingSga = globalData.filter(r => isSgaRow(r));
                const existingReal = globalData.filter(r => !isSgaRow(r));
                const realToKeep = existingReal.filter(r => !uploadedMonths.includes(r.month));
                globalData = [...existingSga, ...realToKeep, ...aggregated];
                globalData.sort((a, b) => a.month.localeCompare(b.month));
                resetEditorMonthFilterToAll();
                updateDataFromEditor();
                renderEditorTab();
                saveToLocal();
                renderAll();
                renderUnpaid();
                alert('프로젝트관리 원본이 집계되었습니다. (업로드된 월만 반영, ' + uploadedMonths.length + '개월, ' + aggregated.length + '행)' + (!editorPinValue ? '\n\n※ Supabase 반영을 위해 PIN을 입력해 주세요.' : ''));
                return;
            }
            const rows = normalizeCsvRows(rawData, fields);
            if (rows.length === 0) {
                alert('유효한 데이터가 없습니다. 헤더와 내용을 확인해 주세요.');
                return;
            }
            globalData = rows.map(ensureUnpaidFields);
            resetEditorMonthFilterToAll();
            updateDataFromEditor();
            renderEditorTab();
            saveToLocal();
            renderAll();
            renderUnpaid();
            alert('CSV 업로드가 완료되었습니다. 기존 데이터가 업로드 파일로 초기화되었습니다.' + (!editorPinValue ? '\n\n※ Supabase 반영을 위해 PIN을 입력해 주세요.' : ''));
        },
        error: function() {
            alert('CSV 파일을 읽는 중 오류가 발생했습니다.');
        }
    });
}

function buildProjectHeaderMap(fields) {
    const map = {};
    (fields || []).forEach(field => {
        const key = normalizeHeader(field);
        const f = String(field || '').trim();
        if (['매출발행일','매출발행','invoicedate'].includes(key) || (f.includes('매출') && f.includes('발행'))) map[field] = 'invoiceDate';
        if (['완료일','완료','completiondate'].includes(key) || f === '완료일') map[field] = 'completionDate';
        if (['진행일','진행','progressdate'].includes(key) || f === '진행일') map[field] = 'progressDate';
        if (['등록일','등록','regdate'].includes(key)) map[field] = 'regDate';
        if (['대분류','cat1'].includes(key)) map[field] = 'cat1';
        if (['중분류','cat2'].includes(key)) map[field] = 'cat2';
        if (['소분류','cat3'].includes(key)) map[field] = 'cat3';
        if (['진행상태','progressstatus'].includes(key)) map[field] = 'progressStatus';
        if (['매출공급가액','매출공급가'].includes(key) || (f.includes('매출') && f.includes('공급'))) map[field] = 'rev';
        if (['매입공급가액','매입공급가'].includes(key) || (f.includes('매입') && f.includes('공급'))) map[field] = 'purchase';
        if (['사업소득금액','사업소득'].includes(key) || f.includes('사업소득')) map[field] = 'labor';
    });
    return map;
}

function parseDateToMonth(val) {
    const s = String(val || '').trim();
    if (!s) return '';
    const m = s.match(/(\d{4})[-\/]?(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}` : '';
}

function tryParseProjectCsvAndAggregate(rawData, fields) {
    const headerMap = buildProjectHeaderMap(fields);
    const hasInvoiceDate = Object.values(headerMap).includes('invoiceDate');
    const hasCompletionDate = Object.values(headerMap).includes('completionDate');
    const hasProgressDate = Object.values(headerMap).includes('progressDate');
    const hasCat1 = Object.values(headerMap).includes('cat1');
    const hasRev = Object.values(headerMap).includes('rev');
    if (!(hasInvoiceDate || hasCompletionDate || hasProgressDate) || !hasCat1 || !hasRev || rawData.length === 0) return null;
    const MIN_MONTH = '2025-12';
    const rows = [];
    rawData.forEach(raw => {
        const getVal = (k) => {
            const f = Object.keys(raw || {}).find(x => headerMap[x] === k);
            return f != null ? raw[f] : null;
        };
        const dateVal = getVal('invoiceDate') || getVal('completionDate') || getVal('progressDate') || getVal('regDate');
        const month = parseDateToMonth(dateVal);
        if (!month || month < MIN_MONTH) return;
        const cat1 = String(getVal('cat1') || '').trim();
        let cat2 = String(getVal('cat2') || '').trim();
        let cat3 = String(getVal('cat3') || '').trim();
        if (cat3 === '강남' || cat3 === '강서') cat3 = '통합';
        const progressStatus = String(getVal('progressStatus') || '').trim();
        if (progressStatus !== '완료') return;
        if (cat1 === '본사' || cat2 === '판관비') return;
        const rev = toNumber(getVal('rev'));
        const purchase = toNumber(getVal('purchase'));
        const labor = toNumber(getVal('labor'));
        rows.push({ month, cat1, cat2, cat3, rev, purchase, labor });
    });
    if (rows.length === 0) return null;
    const group = new Map();
    rows.forEach(r => {
        const key = `${r.month}|${r.cat1}|${r.cat2}|${r.cat3}`;
        if (!group.has(key)) {
            group.set(key, { month: r.month, cat1: r.cat1, cat2: r.cat2, cat3: r.cat3, count: 0, rev: 0, purchase: 0, labor: 0, sga: 0 });
        }
        const g = group.get(key);
        g.count += 1;
        g.rev += r.rev;
        g.purchase += r.purchase;
        g.labor += r.labor;
    });
    return Array.from(group.values()).map(r => ensureUnpaidFields(r));
}

function normalizeCsvRows(rawRows, fields) {
    const headerMap = buildHeaderMap(fields || []);
    const rows = [];

    rawRows.forEach(raw => {
        const mapped = mapCsvRow(raw, headerMap);
        if (mapped) rows.push(mapped);
    });

    // 관리건물 강남/강서 -> 통합 변환 후 동일 키 행 병합
    const group = new Map();
    rows.forEach(r => {
        const key = `${r.month}|${r.cat1}|${r.cat2}|${r.cat3}`;
        if (!group.has(key)) {
            group.set(key, { ...r, count: 0, rev: 0, purchase: 0, labor: 0, sga: 0 });
        }
        const g = group.get(key);
        g.count += r.count || 0;
        g.rev += r.rev || 0;
        g.purchase += r.purchase || 0;
        g.labor += r.labor || 0;
        g.sga += r.sga || 0;
    });
    return Array.from(group.values()).map(r => ensureUnpaidFields(r));
}

function buildHeaderMap(fields) {
    const map = {};
    fields.forEach(field => {
        const key = normalizeHeader(field);
        if (['월','month','yyyymm','date','기간'].includes(key)) map[field] = 'month';
        if (['대분류','cat1'].includes(key)) map[field] = 'cat1';
        if (['중분류','cat2'].includes(key)) map[field] = 'cat2';
        if (['소분류','cat3'].includes(key)) map[field] = 'cat3';
        if (['건수','count'].includes(key)) map[field] = 'count';
        if (['매출','매출원','rev','revenue'].includes(key)) map[field] = 'rev';
        if (['매입','매입원','purchase','cost'].includes(key)) map[field] = 'purchase';
        if (['사업소득','노무비','labor'].includes(key)) map[field] = 'labor';
        if (['판관비','sga'].includes(key)) map[field] = 'sga';
        if (['건물명','buildingname'].includes(key)) map[field] = 'buildingName';
        if (['매출발행일','매출발행','invoicedate'].includes(key)) map[field] = 'invoiceDate';
        if (['진행상태','progressstatus'].includes(key)) map[field] = 'progressStatus';
        if (['수금상태','paymentstatus'].includes(key)) map[field] = 'paymentStatus';
        if (['수금액','paymentamount'].includes(key)) map[field] = 'paymentAmount';
        if (['공급가액','supplyamount'].includes(key)) map[field] = 'supplyAmount';
    });
    return map;
}

function normalizeHeader(text) {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[()_\-./]/g, '')
        .replace(/[\u200b-\u200d]/g, '');
}

function mapCsvRow(raw, headerMap) {
    const row = {
        month: '', cat1: '', cat2: '', cat3: '', count: 0, rev: 0, purchase: 0, labor: 0, sga: 0,
        buildingName: '', invoiceDate: '', progressStatus: '', paymentStatus: '', paymentAmount: 0, supplyAmount: 0
    };

    Object.keys(raw || {}).forEach(field => {
        const mappedKey = headerMap[field];
        if (!mappedKey) return;
        row[mappedKey] = raw[field];
    });

    row.month = String(row.month || '').trim();
    if (!row.month) return null;

    row.count = toNumber(row.count);
    row.rev = toNumber(row.rev);
    row.purchase = toNumber(row.purchase);
    row.labor = toNumber(row.labor);
    row.sga = toNumber(row.sga);
    row.cat1 = String(row.cat1 || '').trim();
    row.cat2 = String(row.cat2 || '').trim();
    row.cat3 = String(row.cat3 || '').trim();
    if (row.cat3 === '강남' || row.cat3 === '강서') row.cat3 = '통합';
    row.buildingName = String(row.buildingName || '').trim();
    row.invoiceDate = String(row.invoiceDate || '').trim();
    row.progressStatus = String(row.progressStatus || '').trim();
    row.paymentStatus = String(row.paymentStatus || '').trim();
    row.paymentAmount = toNumber(row.paymentAmount);
    row.supplyAmount = toNumber(row.supplyAmount);

    return ensureUnpaidFields(row);
}

function toNumber(value) {
    if (typeof value === 'number') return value;
    const cleaned = String(value || '').replace(/,/g, '').trim();
    return Number(cleaned) || 0;
}

function escapeAttr(val) {
    return String(val ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function saveToLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(globalData));
    showSaveMsg();
    syncToSupabaseDebounced();
    renderUnpaid();
}

function syncToSupabaseDebounced() {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(syncToSupabase, 800);
}

async function syncToSupabase() {
    if (!isSupabaseConfigured() || !editorPinValue) return;
    const apiBase = window.API_BASE_URL || '';
    try {
        const res = await fetch(apiBase + '/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: editorPinValue, data: globalData })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (res.status === 401) {
                console.warn('저장 권한 없음 (PIN 확인)');
            }
            return;
        }
    } catch (e) {
        console.warn('Sync failed', e);
    }
}

function updateDataFromEditor() {
    // 에디터의 인풋 값들을 최종 확인해서 globalData 업데이트 (보완책)
    // 실제로는 editData()에서 실시간 반영되므로 여기선 정렬만 다시 함
    globalData.sort((a,b) => a.month.localeCompare(b.month));
    updateFilterOptions();
}

function showSaveMsg() {
    const msg = document.getElementById('saveStatus');
    if (msg) { msg.style.opacity = 1; setTimeout(() => { msg.style.opacity = 0; }, 1500); }
}

// --- Dashboard Functions (기존 로직 유지) ---
function updateFilterOptions() {
    const select = document.getElementById('monthFilter');
    const uniqueMonths = [...new Set(globalData.map(d => d.month))].sort();
    while(select.options.length > 1) { select.remove(1); }
    uniqueMonths.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m; opt.innerText = m; select.appendChild(opt);
    });
    const currentMonth = getKoreaYearMonth();
    if (uniqueMonths.includes(currentMonth)) {
        select.value = currentMonth;
    } else if (uniqueMonths.length > 0) {
        select.value = uniqueMonths[uniqueMonths.length - 1];
    }
    updateMonthSelectUI();
}

function renderAll() {
    const filterVal = document.getElementById('monthFilter').value;
    const outlierToggle = document.getElementById('outlierToggle');
    const outlierLimit = document.getElementById('outlierLimit');
    const sgaToggle = document.getElementById('sgaToggle');
    const useSmartAvg = outlierToggle ? outlierToggle.checked : false;
    const useSga = sgaToggle ? sgaToggle.checked : false;
    const limit = outlierLimit ? Number(outlierLimit.value) * 10000 : 0;
    
    let filteredData = (filterVal === 'ALL') ? globalData : globalData.filter(d => d.month === filterVal);
    document.getElementById('currentRangeText').innerText = (filterVal === 'ALL') ? "데이터 기준: 전체 기간 합계" : `데이터 기준: ${filterVal} 당월 실적`;
    
    document.getElementById('sgaSection').style.display = useSga ? 'block' : 'none';
    updateSgaTabVisibility(useSga);
    
    renderKPI(filteredData, useSmartAvg, limit, useSga);
    renderChart(globalData, useSmartAvg, limit); 
    renderCategoryTable(filteredData, useSmartAvg, limit, useSga);
    renderDetailTable(filteredData, useSmartAvg, limit, useSga);
    renderSgaTable(filteredData);
    setupRevealAnimations();
}

function fmtMan(val) {
    const num = Number(val);
    if (!Number.isFinite(num)) return "0";
    return Math.round(num / 10000).toLocaleString();
}

function renderKPI(data, useSmartAvg, limit, useSga) {
    let tRev=0, tProf=0, avgNum = 0, avgDenom = 0;
    let outlierCount = 0;
    data.forEach(d => { 
        tRev += d.rev;
        let effectiveSga = useSga ? d.sga : 0;
        tProf += (d.rev - d.purchase - d.labor - effectiveSga);
        if(d.cat2 !== '판관비') {
            let unitPrice = d.count > 0 ? (d.rev / d.count) : d.rev; 
            if (shouldExcludeFromAvg(d, useSmartAvg, limit, unitPrice)) {
                if (useSmartAvg && unitPrice >= limit) {
                    outlierCount += 1;
                }
            } else {
                avgNum += d.rev;
                let safeCount = d.count > 0 ? d.count : (d.rev > 0 ? 1 : 0);
                avgDenom += safeCount;
            }
        }
    });
    document.getElementById('kpi-revenue').innerText = fmtMan(tRev) + " 만원";
    document.getElementById('label-profit').innerText = useSga ? "순수익" : "매출이익";
    const profElem = document.getElementById('kpi-profit'); profElem.innerText = fmtMan(tProf) + " 만원"; profElem.className = tProf >= 0 ? 'kpi-value text-profit' : 'kpi-value text-loss';
    const avgPrice = avgDenom > 0 ? avgNum/avgDenom : 0;
    document.getElementById('kpi-price').innerText = fmtMan(avgPrice) + " 만원";
    const priceSub = document.getElementById('kpi-price-sub');
    if (priceSub) {
        priceSub.innerText = '';
        priceSub.style.display = 'none';
    }
    document.getElementById('kpi-margin').innerText = (tRev > 0 ? ((tProf/tRev)*100).toFixed(1) : 0) + "%";
}

function renderChart(allData, useSmartAvg, limit) {
    const monthly = {};
    allData.forEach(d => {
        if(!monthly[d.month]) monthly[d.month] = { rev:0, count:0, avgNum:0, avgDenom:0 };
        monthly[d.month].rev += d.rev;
        if(d.cat2 !== '판관비') {
            monthly[d.month].count += d.count;
            let unitPrice = d.count > 0 ? (d.rev / d.count) : d.rev;
            if (!shouldExcludeFromAvg(d, useSmartAvg, limit, unitPrice)) {
                monthly[d.month].avgNum += d.rev;
                let safeCount = d.count > 0 ? d.count : (d.rev > 0 ? 1 : 0);
                monthly[d.month].avgDenom += safeCount;
            }
        }
    });
    const labels = Object.keys(monthly).sort();
    const revData = labels.map(m => Math.round(monthly[m].rev / 10000));
    const countData = labels.map(m => monthly[m].count);
    const priceData = labels.map(m => {
        const item = monthly[m];
        return item.avgDenom > 0 ? Math.round((item.avgNum / item.avgDenom)/10000) : 0;
    });
    const colors = getChartColors();
    const canvas = document.getElementById('trendChart');
    const ctx = canvas.getContext('2d');
    if (canvas.parentElement && !canvas.parentElement.classList.contains('chart-glow')) {
        canvas.parentElement.classList.add('chart-glow');
    }
    if(trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [
            { type: 'line', label: useSmartAvg ? '평균 단가 (보정됨)' : '평균 단가 (단순)', data: priceData, borderColor: colors.price, borderWidth: 3, yAxisID: 'y_price', order: 0, pointRadius: 4, pointBackgroundColor: colors.price, pointHoverRadius: 7, datalabels: { align: 'top', anchor: 'start', offset: 4, formatter: (v)=>v.toLocaleString()+'만', color: colors.price, font:{weight:'bold'}, backgroundColor: colors.labelBg, padding:2 } },
            { type: 'line', label: '진행 건수 (건)', data: countData, borderColor: colors.count, borderWidth: 2, borderDash: [5,5], yAxisID: 'y_count', order: 1, pointStyle:'rectRot', pointRadius:6, pointBackgroundColor: colors.count, pointHoverRadius: 8, datalabels: { align: 'bottom', anchor: 'end', formatter: (v)=>v+'건', color: colors.count, font:{weight:'bold'}, backgroundColor: colors.labelBg, padding:2 } },
            { type: 'bar', label: '매출액 (만원)', data: revData, backgroundColor: colors.rev, yAxisID: 'y_rev', order: 2, borderRadius: 6, datalabels: { anchor: 'end', align: 'top', formatter: (v)=>v.toLocaleString()+'만', font:{weight:'bold', size:11}, color: colors.text } }
        ]},
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 800, easing: 'easeOutQuart' },
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { color: colors.text } },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    titleColor: colors.text,
                    bodyColor: colors.text,
                    animation: { duration: 200, easing: 'easeOutQuad' }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: colors.text } },
                y_rev: { type: 'linear', position: 'left', beginAtZero: true, grace: '20%', grid: { borderDash: [2, 4], color: colors.grid }, title: {display:true, text:'매출 (만원)', color: colors.text }, ticks: { color: colors.text } },
                y_price: { type: 'linear', position: 'right', beginAtZero: true, grace: '20%', grid: { display: false }, title: {display:true, text:'단가 (만원)', color: colors.text }, ticks: { color: colors.text } },
                y_count: { type: 'linear', position: 'right', beginAtZero: true, grace: '20%', display: false }
            }
        }
    });

    setupChartReveal(canvas);
}

function setupTheme() {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;

    const savedTheme = localStorage.getItem('dashboard_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme ? savedTheme === 'dark' : prefersDark;
    setTheme(isDark);

    toggle.addEventListener('click', () => {
        const next = !document.body.classList.contains('dark');
        setTheme(next);
        localStorage.setItem('dashboard_theme', next ? 'dark' : 'light');
    });
}

function setTheme(isDark) {
    const toggle = document.getElementById('themeToggle');
    document.body.classList.toggle('dark', isDark);
    if (toggle) {
        toggle.innerHTML = isDark
            ? '<i class="fas fa-sun"></i> 라이트 모드'
            : '<i class="fas fa-moon"></i> 다크 모드';
    }
    renderAll();
}

function setupRevealAnimations() {
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => section.classList.add('reveal'));

    if (!('IntersectionObserver' in window)) {
        sections.forEach(section => {
            section.classList.add('is-visible');
            section.classList.add('in-view');
        });
        return;
    }

    if (revealObserver) {
        revealObserver.disconnect();
    }

    revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            entry.target.classList.toggle('is-visible', entry.isIntersecting);
            entry.target.classList.toggle('in-view', entry.isIntersecting);
        });
    }, { threshold: 0.2 });

    sections.forEach(section => revealObserver.observe(section));
}

function setupTableTabs() {
    const buttons = document.querySelectorAll('.tab-button[data-tab]');
    const panels = document.querySelectorAll('.tab-panel');
    if (buttons.length === 0 || panels.length === 0) return;

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');
            buttons.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = document.getElementById(target);
            if (panel) panel.classList.add('active');
        });
    });
}

function setupEditorDropdowns() {
    const shells = [
        { btn: 'editorMonthFilterBtn', shell: 'editorMonthFilterShell' },
        { btn: 'editorSgaMonthFilterBtn', shell: 'editorSgaMonthFilterShell' }
    ];
    shells.forEach(({ btn, shell }) => {
        const b = document.getElementById(btn);
        const s = document.getElementById(shell);
        if (!b || !s) return;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            shells.forEach(({ shell: id }) => {
                const el = document.getElementById(id);
                if (el && el !== s) el.classList.remove('is-open');
            });
            s.classList.toggle('is-open');
        });
    });
    document.addEventListener('click', () => {
        shells.forEach(({ shell: id }) => document.getElementById(id)?.classList.remove('is-open'));
    });
}

function setupEditorTabs() {
    const buttons = document.querySelectorAll('.tab-button[data-editor-tab]');
    const panels = document.querySelectorAll('.editor-tab-panel');
    if (buttons.length === 0 || panels.length === 0) return;

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-editor-tab');
            editorActiveTab = tab;
            buttons.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = document.getElementById('editor-tab-' + tab);
            if (panel) panel.classList.add('active');
            renderEditorTab();
        });
    });
}

function getChartColors() {
    const isDark = document.body.classList.contains('dark');
    return {
        price: isDark ? '#fb7185' : '#e11d48',
        count: isDark ? '#34d399' : '#16a34a',
        rev: isDark ? 'rgba(96, 165, 250, 0.9)' : 'rgba(59, 130, 246, 0.9)',
        text: isDark ? '#e5e7eb' : '#1f2937',
        grid: isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.35)',
        labelBg: isDark ? 'rgba(17, 24, 39, 0.7)' : 'rgba(255,255,255,0.8)',
        tooltipBg: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255,255,255,0.95)',
        tooltipBorder: isDark ? 'rgba(148, 163, 184, 0.3)' : 'rgba(203, 213, 225, 0.6)'
    };
}

function getAvgColor(useSmartAvg) {
    if (useSmartAvg) return '#e74c3c';
    return document.body.classList.contains('dark') ? '#e5e7eb' : '#333';
}

function shouldExcludeFromAvg(row, useSmartAvg, limit, unitPrice) {
    if (String(row.cat3 || '').trim() === '공사') return true;
    if (!useSmartAvg) return false;
    return unitPrice >= limit;
}

function renderUnpaid() {
    const filtered = [...unpaidItemsData].sort((a, b) => (a.invoiceDate || '').localeCompare(b.invoiceDate || ''));

    const tbody = document.getElementById('unpaidTableBody');
    const summaryEl = document.getElementById('unpaidSummary');
    if (!tbody || !summaryEl) return;

    let html = '';
    let totalSupply = 0;
    filtered.forEach((row, idx) => {
        const r = ensureUnpaidFields(row);
        const supply = Number(r.supplyAmount) || 0;
        totalSupply += supply;
        const globalIdx = unpaidItemsData.indexOf(row);
        html += `<tr>
            <td style="text-align:center;"><button class="btn-del" onclick="deleteUnpaidRow(${globalIdx})">✖</button></td>
            <td class="col-center">${idx + 1}</td>
            <td><input type="text" value="${escapeAttr(r.buildingName)}" onchange="editUnpaidData(${globalIdx}, 'buildingName', this.value)"></td>
            <td><input type="text" value="${escapeAttr(r.projectName)}" onchange="editUnpaidData(${globalIdx}, 'projectName', this.value)"></td>
            <td><input type="text" value="${escapeAttr(r.invoiceDate)}" onchange="editUnpaidData(${globalIdx}, 'invoiceDate', this.value)"></td>
            <td><input type="number" value="${supply}" onchange="editUnpaidData(${globalIdx}, 'supplyAmount', this.value)"></td>
        </tr>`;
    });

    if (filtered.length === 0) {
        html = '<tr><td colspan="6" style="text-align:center; padding:20px;">미수 건이 없습니다.</td></tr>';
    }

    tbody.innerHTML = html;
    summaryEl.textContent = `공급가액 합계: ${totalSupply.toLocaleString()}원 (VAT 별도)`;
}

function addUnpaidRow() {
    unpaidItemsData.push({
        month: '', buildingName: '', projectName: '', invoiceDate: '', supplyAmount: 0
    });
    renderUnpaid();
    syncUnpaidToSupabase();
}

function deleteUnpaidRow(idx) {
    if (confirm('이 행을 삭제하시겠습니까?')) {
        unpaidItemsData.splice(idx, 1);
        renderUnpaid();
        syncUnpaidToSupabase();
    }
}

function editUnpaidData(idx, key, val) {
    if (key === 'supplyAmount') unpaidItemsData[idx][key] = Number(val) || 0;
    else unpaidItemsData[idx][key] = String(val || '').trim();
    if (idx >= 0 && unpaidItemsData[idx].invoiceDate) {
        unpaidItemsData[idx].month = parseDateToMonth(unpaidItemsData[idx].invoiceDate) || unpaidItemsData[idx].month || '';
    }
    syncUnpaidToSupabase();
}

async function syncUnpaidToSupabase() {
    if (!isSupabaseConfigured()) return;
    const apiBase = window.API_BASE_URL || '';
    const rows = unpaidItemsData.map(r => ({
        month: r.month || parseDateToMonth(r.invoiceDate) || '',
        building_name: r.buildingName || '',
        project_name: r.projectName || '',
        invoice_date: r.invoiceDate || '',
        supply_amount: Number(r.supplyAmount) || 0
    }));
    try {
        const res = await fetch(apiBase + '/api/sync-unpaid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: rows })
        });
        if (!res.ok) console.warn('미수금 저장 실패:', await res.text());
    } catch (e) { console.warn('미수금 저장 오류:', e); }
}

function resetUnpaidData() {
    if (!confirm('미수금 데이터를 초기화하시겠습니까?')) return;
    unpaidItemsData = [];
    renderUnpaid();
    syncUnpaidToSupabase();
    alert('미수금이 초기화되었습니다.');
}

function addWeeklyItem() {
    const week = getKoreaWeekRange();
    weeklyReportData.complete.push({ building: '', project: '', label: '-' });
    weeklyReportData.weekLabel = weeklyReportData.weekLabel || week.weekLabel;
    renderWeekly();
    syncWeeklyToSupabase();
}

function deleteWeeklyItem(type, idx) {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;
    weeklyReportData[type].splice(idx, 1);
    renderWeekly();
    syncWeeklyToSupabase();
}

function resetWeeklyData() {
    if (!confirm('주간보고를 초기화하시겠습니까?')) return;
    weeklyReportData = { complete: [], scheduled: [], weekLabel: getKoreaWeekRange().weekLabel };
    renderWeekly();
    syncWeeklyToSupabase();
    alert('주간보고가 초기화되었습니다.');
}

async function syncWeeklyToSupabase() {
    if (!isSupabaseConfigured()) return;
    const apiBase = window.API_BASE_URL || '';
    try {
        const res = await fetch(apiBase + '/api/sync-weekly', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: weeklyReportData })
        });
        if (!res.ok) console.warn('주간보고 저장 실패:', await res.text());
    } catch (e) { console.warn('주간보고 저장 오류:', e); }
}

function getKoreaYearMonth() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit'
    }).formatToParts(now);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    return `${year}-${month}`;
}

function setupMonthSelect() {
    const btn = document.getElementById('monthSelectBtn');
    const modal = document.getElementById('monthSelectModal');
    const closeBtn = document.getElementById('monthSelectClose');

    if (!btn || !modal) return;

    btn.addEventListener('click', () => {
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        renderMonthSelectList();
    });

    closeBtn.addEventListener('click', () => closeMonthSelect());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeMonthSelect();
    });
}

function closeMonthSelect() {
    const modal = document.getElementById('monthSelectModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
}

function renderMonthSelectList() {
    const list = document.getElementById('monthSelectList');
    const select = document.getElementById('monthFilter');
    if (!list || !select) return;

    list.innerHTML = '';
    Array.from(select.options).forEach(opt => {
        const item = document.createElement('div');
        item.className = 'modal-item' + (opt.value === select.value ? ' is-selected' : '');
        item.textContent = opt.textContent;
        item.addEventListener('click', () => {
            select.value = opt.value;
            updateMonthSelectUI();
            renderAll();
            closeMonthSelect();
        });
        list.appendChild(item);
    });
}

function updateMonthSelectUI() {
    const select = document.getElementById('monthFilter');
    const btn = document.getElementById('monthSelectBtn');
    if (!select || !btn) return;
    const selected = select.options[select.selectedIndex];
    btn.textContent = selected ? selected.textContent : '전체 보기';
}

function setupChartReveal(canvas) {
    if (!canvas) return;
    const target = canvas.parentElement || canvas;

    chartAnimated = false;
    if (!('IntersectionObserver' in window)) {
        triggerChartDraw();
        return;
    }

    if (chartObserver) {
        chartObserver.disconnect();
    }

    chartObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !chartAnimated) {
                chartAnimated = true;
                triggerChartDraw();
            }
        });
    }, { threshold: 0.4 });

    chartObserver.observe(target);
}

function triggerChartDraw() {
    if (!trendChart) return;
    trendChart.reset();
    trendChart.update();
}

function setupSettingsMenu() {
    const button = document.getElementById('settingsToggle');
    const menu = document.getElementById('settingsMenu');
    if (!button || !menu) return;

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('is-open');
        menu.setAttribute('aria-hidden', menu.classList.contains('is-open') ? 'false' : 'true');
        if (menu.classList.contains('is-open')) {
            const pinInput = document.getElementById('pinInput');
            if (pinInput) {
                pinInput.value = '';
                pinInput.focus();
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && !button.contains(e.target)) {
            menu.classList.remove('is-open');
            menu.setAttribute('aria-hidden', 'true');
        }
    });
}

function updateSgaTabVisibility(useSga) {
    const sgaBtn = document.querySelector('.sga-tab-btn');
    const sgaPanel = document.getElementById('tab-sga');
    if (!sgaBtn || !sgaPanel) return;

    if (useSga) {
        sgaBtn.style.display = '';
        return;
    }

    sgaBtn.style.display = 'none';
    if (sgaPanel.classList.contains('active')) {
        const fallback = document.querySelector('.tab-button[data-tab="tab-detail"]');
        if (fallback) fallback.click();
    }
}

function setupSgaPin() {
    const pinInput = document.getElementById('pinInput');
    const pinBtn = document.getElementById('pinUnlockBtn');
    const pinStatus = document.getElementById('pinStatus');
    const sgaControls = document.getElementById('sgaControls');
    const sgaToggle = document.getElementById('sgaToggle');
    const editorLink = document.getElementById('editorSettingsLink');
    if (!pinInput || !pinBtn || !pinStatus || !sgaControls || !sgaToggle) return;

    const ADMIN_PIN = '1234';
    const unlocked = sessionStorage.getItem('sga_unlocked') === '1';
    updatePinUI(unlocked);
    if (!unlocked) {
        sgaToggle.checked = false;
        renderAll();
    }

    pinBtn.addEventListener('click', () => {
        const isUnlocked = sessionStorage.getItem('sga_unlocked') === '1';
        if (isUnlocked) {
            sessionStorage.removeItem('sga_unlocked');
            editorPinValue = '';
            sgaToggle.checked = false;
            renderAll();
            updatePinUI(false);
            return;
        }
        if (pinInput.value === ADMIN_PIN) {
            sessionStorage.setItem('sga_unlocked', '1');
            editorPinValue = pinInput.value;
            updatePinUI(true);
        } else {
            alert('PIN이 올바르지 않습니다.');
        }
        pinInput.value = '';
    });

    function updatePinUI(isUnlocked) {
        pinStatus.textContent = isUnlocked ? '잠금 해제됨' : '잠금됨';
        pinBtn.textContent = isUnlocked ? '잠금' : '잠금 해제';
        sgaControls.classList.toggle('is-open', isUnlocked);
        if (editorLink) editorLink.style.display = isUnlocked ? 'flex' : 'none';
    }
}

function renderCategoryTable(data, useSmartAvg, limit, useSga) {
    const avgColor = getAvgColor(useSmartAvg);
    const headHtml = `<th style="width:10%">대분류</th><th>중분류</th><th>소분류</th><th>건수</th><th>매출액</th><th>매입액</th><th>사업소득</th>${useSga ? '<th>판관비</th>' : ''}<th>순수익</th><th>평균단가</th><th>수익률</th>`;
    document.getElementById('categoryHeaderRow').innerHTML = headHtml;
    const colSpan = useSga ? 11 : 10;
    const groups = { 'B2B':[], 'B2C':[], '컨텍터스':[], '본사':[], '기타':[] };
    data.forEach(d => {
        if (!useSga && d.cat1 === '본사') return;
        let displayCat3 = d.cat3; if (d.cat1 === '본사') { displayCat3 = '합계'; }
        const key = `${d.cat1}|${d.cat2}|${displayCat3}`;
        let targetGroup = groups[d.cat1] ? groups[d.cat1] : groups['기타'];
        let effectiveSga = useSga ? d.sga : 0;
        let profit = d.rev - d.purchase - d.labor - effectiveSga;
        if(!groups[d.cat1] && d.cat1 !== '본사') groups['기타'].push({ ...d, key, cat3: displayCat3, avgNum:0, avgDenom:0, prof: profit, sga: effectiveSga });
        else { 
            let existing = targetGroup.find(item => item.key === key); 
            if(existing) { 
                existing.count += d.count; existing.rev += d.rev; existing.purchase += d.purchase; existing.labor += d.labor; existing.sga += effectiveSga; existing.prof += profit; 
                let unitPrice = d.count > 0 ? (d.rev / d.count) : d.rev;
                if(!shouldExcludeFromAvg(d, useSmartAvg, limit, unitPrice)) { existing.avgNum = (existing.avgNum||0) + d.rev; existing.avgDenom = (existing.avgDenom||0) + (d.count>0?d.count:(d.rev>0?1:0)); }
            } else { 
                let avgNum=0, avgDenom=0; let unitPrice = d.count > 0 ? (d.rev / d.count) : d.rev;
                if(!shouldExcludeFromAvg(d, useSmartAvg, limit, unitPrice)) { avgNum = d.rev; avgDenom = (d.count>0?d.count:(d.rev>0?1:0)); }
                targetGroup.push({ ...d, key, cat3: displayCat3, avgNum, avgDenom, prof: profit, sga: effectiveSga }); 
            } 
        }
    });
    let html = '';
    ['B2B', 'B2C', '컨텍터스', '본사', '기타'].forEach(cat => {
        const list = groups[cat]; if(!list || list.length === 0) return;
        html += `<tr><td colspan="${colSpan}" class="group-header">${cat}</td></tr>`;
        let sub = { count:0, rev:0, purchase:0, labor:0, sga:0, prof:0, avgNum:0, avgDenom:0 };
        list.forEach(g => {
            sub.count += g.count; sub.rev += g.rev; sub.purchase += g.purchase; sub.labor += g.labor; sub.sga += g.sga; sub.prof += g.prof;
            sub.avgNum += (g.avgNum||0); sub.avgDenom += (g.avgDenom||0);
            const avg = (g.avgDenom > 0) ? g.avgNum/g.avgDenom : 0; 
            const mar = g.rev>0 ? (g.prof/g.rev*100).toFixed(1) : 0; const profClass = g.prof >= 0 ? 'text-profit' : 'text-loss';
            html += `<tr><td></td><td class="col-center">${g.cat2}</td><td class="col-center">${g.cat3}</td><td class="col-center">${g.count}</td><td class="col-num">${fmtMan(g.rev)}</td><td class="col-num">${fmtMan(g.purchase)}</td><td class="col-num">${fmtMan(g.labor)}</td>${useSga ? `<td class="col-num">${fmtMan(g.sga)}</td>` : ''}<td class="col-num ${profClass}">${fmtMan(g.prof)}</td><td class="col-num" style="color:${avgColor}">${fmtMan(avg)}</td><td class="col-num ${profClass}">${mar}%</td></tr>`;
        });
        const subAvg = (sub.avgDenom > 0) ? sub.avgNum/sub.avgDenom : 0; const subMar = sub.rev>0 ? (sub.prof/sub.rev*100).toFixed(1) : 0; const subProfClass = sub.prof >= 0 ? 'text-profit' : 'text-loss';
        html += `<tr class="sub-row"><td colspan="3" style="text-align:center;">${cat} 소계</td><td class="col-center">${sub.count}</td><td class="col-num">${fmtMan(sub.rev)}</td><td class="col-num">${fmtMan(sub.purchase)}</td><td class="col-num">${fmtMan(sub.labor)}</td>${useSga ? `<td class="col-num">${fmtMan(sub.sga)}</td>` : ''}<td class="col-num ${subProfClass}">${fmtMan(sub.prof)}</td><td class="col-num" style="color:${avgColor}">${fmtMan(subAvg)}</td><td class="col-num ${subProfClass}">${subMar}%</td></tr>`;
    });
    document.querySelector('#categoryTable tbody').innerHTML = html;
}

function renderDetailTable(data, useSmartAvg, limit, useSga) {
    const avgColor = getAvgColor(useSmartAvg);
    const headHtml = `<th>월</th><th>대분류</th><th>중분류</th><th>소분류</th><th>건수</th><th>매출액</th><th>매입액</th><th>사업소득</th>${useSga ? '<th>판관비</th>' : ''}<th>순수익</th><th>평균단가</th><th>수익률</th>`;
    document.getElementById('detailHeaderRow').innerHTML = headHtml;
    const colSpan = useSga ? 4 : 4; 
    const months = {}; 
    data.forEach(d => { if(!months[d.month]) months[d.month] = []; months[d.month].push(d); });
    const sortedMonths = Object.keys(months).sort(); 
    let html = ''; 
    sortedMonths.forEach(m => {
        const list = months[m]; 
        const aggregatedList = [];
        const sgaMap = new Map();
        list.forEach(item => {
            if (!useSga && item.cat1 === '본사') return;
            let effectiveSga = useSga ? item.sga : 0;
            let profit = item.rev - item.purchase - item.labor - effectiveSga;
            let d = { ...item, sga: effectiveSga, prof: profit };
            if(d.cat1 === '본사') {
                 if(sgaMap.has('sga')) { const s = sgaMap.get('sga'); s.rev += d.rev; s.purchase += d.purchase; s.labor += d.labor; s.sga += d.sga; s.prof += d.prof; s.count += d.count; } 
                 else { sgaMap.set('sga', {...d, cat3: '합계'}); }
            } else { aggregatedList.push(d); }
        });
        if(sgaMap.has('sga')) aggregatedList.push(sgaMap.get('sga'));
        let sub = { count:0, rev:0, purchase:0, labor:0, sga:0, prof:0, avgNum:0, avgDenom:0 };
        aggregatedList.sort((a,b) => (a.cat1==='본사'?1:(b.cat1==='본사'?-1:b.rev-a.rev)));
        aggregatedList.forEach(d => {
            sub.count += d.count; sub.rev += d.rev; sub.purchase += d.purchase; sub.labor += d.labor; sub.sga += d.sga; sub.prof += d.prof;
            let unitPrice = d.count > 0 ? (d.rev / d.count) : d.rev;
            let safeCount = d.count > 0 ? d.count : (d.rev > 0 ? 1 : 0);
            if(!shouldExcludeFromAvg(d, useSmartAvg, limit, unitPrice)) { sub.avgNum += d.rev; sub.avgDenom += safeCount; }
            const mar = d.rev>0 ? (d.prof/d.rev*100).toFixed(1) : 0; const profClass = d.prof >= 0 ? 'text-profit' : 'text-loss';
            const excluded = shouldExcludeFromAvg(d, useSmartAvg, limit, unitPrice);
            html += `<tr><td class="col-center" style="font-weight:bold;">${d.month}</td><td class="col-center">${d.cat1}</td><td class="col-center">${d.cat2}</td><td class="col-center">${d.cat3}</td><td class="col-center">${d.count}</td><td class="col-num">${fmtMan(d.rev)}</td><td class="col-num">${fmtMan(d.purchase)}</td><td class="col-num">${fmtMan(d.labor)}</td>${useSga ? `<td class="col-num">${fmtMan(d.sga)}</td>` : ''}<td class="col-num ${profClass}">${fmtMan(d.prof)}</td><td class="col-num" style="${excluded ? 'text-decoration:line-through; color:#999;' : `color:${avgColor};`}">${fmtMan(unitPrice)}</td><td class="col-num ${profClass}">${mar}%</td></tr>`;
        });
        const subAvg = (sub.avgDenom > 0) ? sub.avgNum/sub.avgDenom : 0; const subMar = sub.rev>0 ? (sub.prof/sub.rev*100).toFixed(1) : 0; const subProfClass = sub.prof >= 0 ? 'text-profit' : 'text-loss';
        const avgText = useSmartAvg ? '평균단가 보정반영' : '평균단가 단순반영';
        html += `<tr class="sub-row"><td colspan="4" style="text-align:center;">${m} 월계 (${avgText})</td><td class="col-center">${sub.count}</td><td class="col-num">${fmtMan(sub.rev)}</td><td class="col-num">${fmtMan(sub.purchase)}</td><td class="col-num">${fmtMan(sub.labor)}</td>${useSga ? `<td class="col-num">${fmtMan(sub.sga)}</td>` : ''}<td class="col-num ${subProfClass}">${fmtMan(sub.prof)}</td><td class="col-num" style="color:${avgColor}">${fmtMan(subAvg)}</td><td class="col-num ${subProfClass}">${subMar}%</td></tr>`;
    });
    document.querySelector('#detailTable tbody').innerHTML = html;
}

function renderSgaTable(data) {
    if (!document.getElementById('sgaToggle').checked) {
        document.querySelector('#sgaTable tbody').innerHTML = '';
        return;
    }
    let html = ''; const sgaItems = data.filter(d => d.cat1 === '본사' || d.sga > 0); sgaItems.sort((a,b) => a.month.localeCompare(b.month));
    let totalSga = 0; sgaItems.forEach(d => { totalSga += d.sga; html += `<tr><td class="col-center">${d.month}</td><td class="col-center">${d.cat3}</td><td class="col-num" style="color:#e74c3c;">${d.sga.toLocaleString()}</td><td class="col-num">-</td></tr>`; });
    if(sgaItems.length === 0) html = '<tr><td colspan="4" style="text-align:center; padding:15px;">등록된 판관비 내역이 없습니다.</td></tr>';
    else html += `<tr class="sub-row sga-total"><td colspan="2" style="text-align:center;">판관비 총계</td><td class="col-num" style="color:#e74c3c; font-weight:bold;">${totalSga.toLocaleString()}</td><td></td></tr>`;
    document.querySelector('#sgaTable tbody').innerHTML = html;
}
