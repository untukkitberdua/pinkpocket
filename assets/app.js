'use strict';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const MIN_MONTH = '2026-11';
const WALLETS = {
  cash: { name: 'Cash', icon: '▣', color: 'peach' },
  bank: { name: 'Rekening', icon: '▤', color: 'lilac' },
  savings: { name: 'Tabungan', icon: '♡', color: 'rose' }
};
const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const money = (n) => new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(Number(n) || 0);
const compactMoney = (n) => {
  const value = Number(n) || 0;
  if (value >= 1_000_000_000) return `Rp${(value/1_000_000_000).toLocaleString('id-ID',{maximumFractionDigits:1})} M`;
  if (value >= 1_000_000) return `Rp${(value/1_000_000).toLocaleString('id-ID',{maximumFractionDigits:1})} jt`;
  if (value >= 1_000) return `Rp${(value/1_000).toLocaleString('id-ID',{maximumFractionDigits:0})} rb`;
  return `Rp${value.toLocaleString('id-ID')}`;
};
const escapeHTML = (value='') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthLabel = (value) => { const [y,m] = value.split('-').map(Number); return `${MONTHS[m-1]} ${y}`; };
const formatDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const formatShortDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('id-ID',{day:'numeric',month:'short'});
const todayLocal = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; };

let client = null;
let transactions = [];
let period = '2026-11';
let calendarYear = 2026;
let activeType = 'expense';
let activeFilter = 'all';
let selectedCalendarDay = '';
let editingId = null;
let selectedChartDay = '';
let realtimeChannel = null;
let refreshTimer = null;

function isConfigured() {
  const cfg = window.PINKPOCKET_CONFIG || {};
  return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes('YOUR-PROJECT') && !cfg.supabaseAnonKey.includes('YOUR_SUPABASE'));
}
function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}
function setSyncStatus(message, offline=false) {
  $('#syncLabel').textContent = message;
  $('#syncStatus').classList.toggle('offline', offline);
}
function showConfig() {
  $('#configScreen').hidden = false;
  $('#appShell').hidden = true;
}
function showApp() {
  $('#configScreen').hidden = true;
  $('#appShell').hidden = false;
}
function friendlyError(message) {
  const text = String(message || 'Terjadi kesalahan.');
  if (/Invalid login credentials/i.test(text)) return 'Email atau kata sandi belum benar.';
  if (/Email not confirmed/i.test(text)) return 'Email belum dikonfirmasi. Cek kotak masuk email.';
  if (/User already registered/i.test(text)) return 'Email ini sudah terdaftar. Silakan masuk.';
  if (/Password should be at least/i.test(text)) return 'Kata sandi minimal 6 karakter.';
  if (/Failed to fetch|NetworkError/i.test(text)) return 'Koneksi gagal. Periksa internet dan konfigurasi Supabase.';
  return text;
}
function mapRow(row) {
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    description: row.description || '',
    category: row.category || '',
    wallet: row.wallet,
    toWallet: row.to_wallet || null,
    date: row.date,
    note: row.note || '',
    createdAt: row.created_at || ''
  };
}
function selectedRows() { return transactions.filter(t => t.date.slice(0,7) === period); }
function sumRows(rows) {
  return rows.reduce((s,t) => {
    if (t.type === 'income') s.income += Number(t.amount);
    if (t.type === 'expense') s.expense += Number(t.amount);
    return s;
  }, { income:0, expense:0 });
}
function walletBalances() {
  const result = { cash:0, bank:0, savings:0 };
  transactions.filter(t => t.date <= `${period}-31`).forEach(t => {
    if (t.type === 'income') result[t.wallet] += Number(t.amount);
    if (t.type === 'expense') result[t.wallet] -= Number(t.amount);
    if (t.type === 'transfer') {
      result[t.wallet] -= Number(t.amount);
      result[t.toWallet] += Number(t.amount);
    }
  });
  return result;
}
async function fetchTransactions(quiet=false) {
  if (!client) return;
  if (!quiet) setSyncStatus('Menyinkronkan data...');
  const { data, error } = await client.from('transactions').select('*').order('date',{ascending:false}).order('created_at',{ascending:false});
  if (error) {
    setSyncStatus('Gagal menyinkronkan data', true);
    if (!quiet) showToast(friendlyError(error.message));
    throw error;
  }
  transactions = (data || []).map(mapRow);
  render();
  setSyncStatus('Tersinkron • data bersama aktif');
}
async function enterApp() {
  showApp();
  if (realtimeChannel) client.removeChannel(realtimeChannel);
  realtimeChannel = client.channel('pinkpocket-shared-transactions')
    .on('postgres_changes', { event:'*', schema:'public', table:'transactions' }, () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => fetchTransactions(true).catch(() => {}), 250);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setSyncStatus('Tersinkron • data bersama aktif');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncStatus('Realtime terputus • coba muat ulang', true);
    });
  try { await fetchTransactions(); }
  catch (error) { showToast('Data belum bisa dimuat. Periksa SQL Supabase dan hak akses anonim.'); }
}
function renderPeriod() {
  $('#periodLabel').textContent = monthLabel(period);
  $('#balanceAsOf').textContent = `s/d ${MONTHS[Number(period.slice(5,7))-1].slice(0,3)} ${period.slice(0,4)}`;
  $('#prevMonth').disabled = period === MIN_MONTH;
  $('#yearLabel').textContent = calendarYear;
  $('#prevYear').disabled = calendarYear <= 2026;
  $('#monthGrid').innerHTML = MONTHS.map((name,index) => {
    const value = `${calendarYear}-${String(index+1).padStart(2,'0')}`;
    const disabled = value < MIN_MONTH;
    return `<button class="month-option ${value===period?'chosen':''}" data-month="${value}" ${disabled?'disabled':''}>${name.slice(0,3)}</button>`;
  }).join('');
}
function transactionMarkup(t, showDate=true) {
  const isIncome = t.type === 'income';
  const isExpense = t.type === 'expense';
  const isTransfer = t.type === 'transfer';
  const icon = isIncome ? '↙' : isExpense ? '↗' : '⇄';
  const amountClass = isIncome ? 'positive' : isExpense ? 'negative' : 'neutral';
  const prefix = isIncome ? '+' : isExpense ? '−' : '⇄';
  const detail = isTransfer ? `${WALLETS[t.wallet].name} → ${WALLETS[t.toWallet].name}` : (t.category || WALLETS[t.wallet].name);
  return `<article class="transaction-row">
    <div class="transaction-icon ${isIncome?'in':isExpense?'out':'move'}">${icon}</div>
    <div class="transaction-main"><strong>${escapeHTML(t.description)}</strong><small>${escapeHTML(detail)}${showDate?' · '+formatShortDate(t.date):''}</small></div>
    <div class="transaction-right"><b class="${amountClass}">${prefix} ${money(t.amount)}</b>
      <span class="row-actions"><button class="edit-one" data-edit="${escapeHTML(t.id)}" aria-label="Edit transaksi">✎</button><button data-delete="${escapeHTML(t.id)}" aria-label="Hapus transaksi">×</button></span>
    </div>
  </article>`;
}
function emptyState(title='Belum ada transaksi',subtitle='Catat pemasukan atau pengeluaran pertamamu di sini.') {
  return `<div class="empty-state"><div class="empty-illustration">♡</div><strong>${title}</strong><p>${subtitle}</p></div>`;
}
function balanceDelta(t) {
  if (t.type === 'income') return Number(t.amount);
  if (t.type === 'expense') return -Number(t.amount);
  return 0; // transfer hanya memindahkan lokasi uang, bukan mengubah saldo total
}
function balanceAtDate(date) {
  return transactions.reduce((total, t) => t.date <= date ? total + balanceDelta(t) : total, 0);
}
function axisMoney(value, span) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    const decimals = span < 100_000_000 ? 3 : span < 1_000_000_000 ? 2 : 1;
    return `Rp${(value/1_000_000_000).toLocaleString('id-ID',{maximumFractionDigits:decimals})} M`;
  }
  if (abs >= 1_000_000) {
    const decimals = span < 100_000 ? 3 : span < 1_000_000 ? 2 : 1;
    return `Rp${(value/1_000_000).toLocaleString('id-ID',{maximumFractionDigits:decimals})} jt`;
  }
  if (abs >= 1_000) {
    const decimals = span < 100 ? 2 : span < 1_000 ? 1 : 0;
    return `Rp${(value/1_000).toLocaleString('id-ID',{maximumFractionDigits:decimals})} rb`;
  }
  return `Rp${Math.round(value).toLocaleString('id-ID')}`;
}
function renderChart(rows) {
  const [year,month] = period.split('-').map(Number);
  const lastDay = new Date(year,month,0).getDate();
  const daily = Array.from({length:lastDay},(_,i) => {
    const date = `${period}-${String(i+1).padStart(2,'0')}`;
    const result = sumRows(rows.filter(t => t.date === date));
    const change = result.income - result.expense;
    return { date, day:i+1, income:result.income, expense:result.expense, change, balance:balanceAtDate(date) };
  });
  const values = daily.map(d => d.balance);
  const dataMin = Math.min(...values), dataMax = Math.max(...values);
  const dataRange = dataMax - dataMin;
  // Do not force the Y axis to zero. Zoom in around the actual balance range.
  const padding = dataRange > 0 ? dataRange * .14 : Math.max(Math.abs(dataMax) * .012, 100_000);
  let chartMin = dataMin - padding;
  let chartMax = dataMax + padding;
  if (chartMax - chartMin < 1) { chartMin -= .5; chartMax += .5; }

  const width = 760, height = 230, left = 78, right = 16, top = 15, bottom = 35;
  const plotWidth = width-left-right, plotHeight = height-top-bottom;
  const x = (index) => left + (daily.length <= 1 ? 0 : index*plotWidth/(daily.length-1));
  const y = (value) => top + plotHeight - ((value-chartMin)/(chartMax-chartMin))*plotHeight;
  const balancePts = daily.map((d,i)=>`${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`);
  const balancePath = balancePts.map((point,i)=>`${i?'L':'M'}${point}`).join(' ');
  const baselineY = top + plotHeight;
  const areaPath = `${balancePath} L${x(daily.length-1).toFixed(1)},${baselineY} L${x(0).toFixed(1)},${baselineY} Z`;
  const ticks = [0,1/3,2/3,1].map(ratio => {
    const value = chartMin + (chartMax-chartMin)*ratio;
    const yy = y(value);
    return `<line class="chart-grid-line" x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text class="chart-axis-text" x="${left-10}" y="${yy+3}" text-anchor="end">${escapeHTML(axisMoney(value,chartMax-chartMin))}</text>`;
  }).join('');
  const labelDays = [...new Set([1,5,10,15,20,25,lastDay])];
  const labels = labelDays.map(day => `<text class="chart-axis-text" x="${x(day-1)}" y="${height-8}" text-anchor="middle">${day}</text>`).join('');
  const markers = daily.map((d,i) => `
    <g class="chart-point balance" data-chart-day="${d.date}" tabindex="0" role="button" aria-label="Saldo tanggal ${d.day}: ${money(d.balance)}"><title>${d.day} ${MONTHS[month-1]} · Saldo ${money(d.balance)} · Perubahan ${d.change>=0?'+':'−'}${money(Math.abs(d.change))}</title><circle cx="${x(i)}" cy="${y(d.balance)}" r="3.5"/></g>`).join('');
  $('#dailyChart').innerHTML = `<svg class="daily-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafik pergerakan saldo harian bulan ${monthLabel(period)}"><defs><linearGradient id="pinkPocketChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f078ad" stop-opacity=".26"/><stop offset="100%" stop-color="#f078ad" stop-opacity="0"/></linearGradient></defs>${ticks}<path class="chart-area" d="${areaPath}"/><path class="chart-income-line" d="${balancePath}"/>${markers}${labels}</svg>`;
  const nonZero = daily.filter(d => d.income || d.expense);
  if (!daily.some(d => d.date === selectedChartDay) || selectedChartDay.slice(0,7) !== period) selectedChartDay = (nonZero[0] || daily[daily.length-1]).date;
  renderChartDetail(daily.find(d => d.date === selectedChartDay) || daily[daily.length-1]);
}
function renderChartDetail(day) {
  if (!day) { $('#chartDetail').innerHTML = 'Belum ada data pergerakan saldo.'; return; }
  const change = day.change ?? (day.income - day.expense);
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  $('#chartDetail').innerHTML = `<strong>${escapeHTML(formatDate(day.date))}</strong><div class="chart-detail-grid">
    <div><span>Pemasukan hari ini</span><b class="positive">${money(day.income)}</b></div>
    <div><span>Pengeluaran hari ini</span><b class="negative">${money(day.expense)}</b></div>
    <div><span>Perubahan saldo</span><b class="${change>0?'positive':change<0?'negative':'neutral'}">${sign}${money(Math.abs(change))}</b></div>
    <div><span>Saldo berjalan</span><b class="${day.balance>0?'positive':day.balance<0?'negative':'neutral'}">${money(day.balance ?? 0)}</b></div>
  </div>`;
}
function renderCalendar(rows) {
  const [year,month] = period.split('-').map(Number);
  const lastDay = new Date(year,month,0).getDate();
  const firstWeekday = new Date(year,month-1,1).getDay();
  const byDate = {};
  rows.forEach(t => (byDate[t.date] ||= []).push(t));
  const dates = Object.keys(byDate);
  const today = todayLocal();
  if (!selectedCalendarDay || selectedCalendarDay.slice(0,7) !== period) {
    selectedCalendarDay = today.startsWith(period) ? today : (dates.sort().at(-1) || `${period}-01`);
  }
  $('#calendarMonthLabel').textContent = monthLabel(period);
  $('#calendarMonthCount').textContent = `${rows.length} transaksi`;
  const cells = Array(firstWeekday).fill('<span class="calendar-empty" aria-hidden="true"></span>');
  for (let day=1; day<=lastDay; day++) {
    const date = `${period}-${String(day).padStart(2,'0')}`;
    const dayRows = byDate[date] || [];
    const sums = sumRows(dayRows);
    const classes = ['calendar-day'];
    if (date === selectedCalendarDay) classes.push('selected');
    if (date === today) classes.push('today');
    if (dayRows.length) classes.push('has-transactions');
    if (sums.income && !sums.expense) classes.push('has-income');
    if (sums.expense && !sums.income) classes.push('has-expense');
    cells.push(`<button type="button" class="${classes.join(' ')}" data-calendar-day="${date}" aria-label="${escapeHTML(formatDate(date))}, ${dayRows.length} transaksi" aria-pressed="${date===selectedCalendarDay}"><span>${day}</span>${dayRows.length?'<i></i>':'<em></em>'}</button>`);
  }
  $('#calendarGrid').innerHTML = cells.join('');
  const pickedRows = (byDate[selectedCalendarDay] || []).slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  const sums = sumRows(pickedRows);
  const change = sums.income-sums.expense;
  $('#calendarSelectedDate').textContent = formatDate(selectedCalendarDay);
  $('#calendarSelectedCount').textContent = `${pickedRows.length} transaksi`;
  $('#calendarMetrics').innerHTML = `<div><span>Masuk</span><strong class="positive">${money(sums.income)}</strong></div><div><span>Keluar</span><strong class="negative">${money(sums.expense)}</strong></div><div><span>Perubahan</span><strong class="${change>0?'positive':change<0?'negative':'neutral'}">${change>0?'+':change<0?'−':''}${money(Math.abs(change))}</strong></div>`;
  $('#calendarDayTransactions').innerHTML = pickedRows.map(t=>transactionMarkup(t,false)).join('') || emptyState('Belum ada catatan','Tanggal ini masih kosong. Tekan tombol + untuk menambahkan transaksi.');
}

function render() {
  renderPeriod();
  const rows = selectedRows().sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||''));
  const sums = sumRows(rows);
  const balances = walletBalances();
  const total = Object.values(balances).reduce((a,b)=>a+b,0);
  const net = sums.income-sums.expense;
  $('#totalBalance').textContent = money(total);
  $('#homeIncome').textContent = money(sums.income);
  $('#homeExpense').textContent = money(sums.expense);
  $('#reportIncome').textContent = money(sums.income);
  $('#reportExpense').textContent = money(sums.expense);
  $('#reportNet').textContent = `${net<0?'−':net>0?'+':''}${money(Math.abs(net))}`;
  $('#reportNet').className = net>0?'positive':net<0?'negative':'neutral';
  $('#reportNetHint').textContent = net>0?'Pemasukan lebih besar dari pengeluaran':net<0?'Pengeluaran lebih besar dari pemasukan':'Pemasukan dan pengeluaran seimbang';
  $('#reportSubtitle').textContent = `Rangkuman ${monthLabel(period)} · ${rows.length} transaksi`;
  $('#homeWallets').innerHTML = Object.entries(WALLETS).map(([key,w])=>`<article class="mini-wallet ${w.color}"><div class="mini-wallet-icon">${w.icon}</div><span>${w.name}</span><strong>${money(balances[key])}</strong></article>`).join('');
  $('#homeRecent').innerHTML = rows.slice(0,4).map(t=>transactionMarkup(t)).join('') || emptyState('Belum ada aktivitas ♡','Belum ada catatan untuk periode ini. Tekan tombol + untuk mulai.');
  const filtered = rows.filter(t=>activeFilter==='all'||t.type===activeFilter);
  $('#transactionList').innerHTML = filtered.map(t=>transactionMarkup(t)).join('') || emptyState('Belum ada transaksi','Semua masih Rp0. Tambahkan catatan pertamamu dengan tombol +.');
  renderCalendar(rows);
  renderChart(rows);
}
function changeView(name) {
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $('#monthPopover').hidden = true;
}
function moveMonth(delta) {
  const [y,m] = period.split('-').map(Number);
  const d = new Date(y,m-1+delta,1);
  const next = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  if (next < MIN_MONTH) return;
  period = next; calendarYear = d.getFullYear(); selectedCalendarDay=''; selectedChartDay='';
  $('#monthPopover').hidden=true; $('#periodButton').setAttribute('aria-expanded','false'); render();
}
function openMonthPicker() {
  calendarYear = Number(period.slice(0,4)); renderPeriod();
  $('#monthPopover').hidden = !$('#monthPopover').hidden;
  $('#periodButton').setAttribute('aria-expanded',String(!$('#monthPopover').hidden));
}
function setType(type) {
  activeType = type;
  $$('.entry-types button').forEach(b=>b.classList.toggle('active',b.dataset.type===type));
  $('#walletField').childNodes[0].textContent = type==='income'?'Masuk ke dompet':type==='expense'?'Diambil dari dompet':'Dari dompet';
  $('#toWalletField').classList.toggle('hidden',type!=='transfer');
  $('#categoryField').classList.toggle('hidden',type==='transfer');
}
function openEntry(type='expense', transaction=null) {
  $('#entryForm').reset();
  editingId = transaction?.id || null;
  const today = todayLocal();
  const defaultDate = today >= '2026-11-01' && today.startsWith(period) ? today : `${period}-01`;
  $('#transactionDate').min = '2026-11-01'; $('#transactionDate').max = '2099-12-31';
  $('#transactionDate').value = transaction?.date || defaultDate;
  $('#amount').value = transaction?.amount ?? '';
  $('#description').value = transaction?.description ?? '';
  $('#category').value = transaction?.category ?? '';
  $('#wallet').value = transaction?.wallet || 'cash';
  $('#toWallet').value = transaction?.toWallet || 'savings';
  $('#note').value = transaction?.note ?? '';
  setType(transaction?.type || type);
  $('#entryEyebrow').textContent = editingId ? 'UBAH CATATAN' : 'TAMBAH CATATAN';
  $('#entryTitle').textContent = editingId ? 'Edit transaksi' : 'Transaksi baru';
  $('#saveEntryButton').textContent = editingId ? 'Simpan perubahan ♡' : 'Simpan transaksi ♡';
  $('#modalScrim').classList.add('open'); document.body.classList.add('modal-open');
}
function closeEntry() { $('#modalScrim').classList.remove('open'); document.body.classList.remove('modal-open'); }
function transactionPayload() {
  const type = activeType;
  const amount = Number($('#amount').value);
  const wallet = $('#wallet').value;
  const toWallet = $('#toWallet').value;
  const date = $('#transactionDate').value;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Nominal harus lebih dari Rp0.');
  if (!$('#description').value.trim()) throw new Error('Keterangan wajib diisi.');
  if (type==='transfer' && wallet===toWallet) throw new Error('Pilih dompet asal dan tujuan yang berbeda.');
  if (!date || date<'2026-11-01') throw new Error('Tanggal pencatatan dimulai dari 1 November 2026.');
  return {
    type, amount, description:$('#description').value.trim(), category:type==='transfer'?'':$('#category').value.trim(),
    wallet, to_wallet:type==='transfer'?toWallet:null, date, note:$('#note').value.trim()
  };
}
async function saveEntry(event) {
  event.preventDefault();
  let payload;
  try { payload=transactionPayload(); }
  catch(error) { showToast(error.message); return; }
  const button=$('#saveEntryButton'); button.disabled=true; button.textContent='Menyimpan...';
  try {
    let result;
    if (editingId) {
      result = await client.from('transactions').update(payload).eq('id',editingId).select().single();
    } else {
      result = await client.from('transactions').insert(payload).select().single();
    }
    if (result.error) throw result.error;
    const savedDate = payload.date;
    if (savedDate.slice(0,7)!==period) { period=savedDate.slice(0,7); calendarYear=Number(period.slice(0,4)); }
    selectedCalendarDay = savedDate;
    await fetchTransactions(true);
    closeEntry(); showToast(editingId?'Perubahan berhasil disimpan ♡':'Catatan berhasil disimpan ♡');
  } catch(error) {
    showToast(friendlyError(error.message || 'Gagal menyimpan. Pastikan SQL Supabase sudah dijalankan.'));
  } finally {
    button.disabled=false; button.textContent=editingId?'Simpan perubahan ♡':'Simpan transaksi ♡';
  }
}
async function deleteTransaction(id) {
  const row=transactions.find(t=>t.id===id);
  if (!row || !confirm(`Hapus transaksi “${row.description}”?`)) return;
  try {
    const {error}=await client.from('transactions').delete().eq('id',id);
    if (error) throw error;
    await fetchTransactions(true); showToast('Transaksi dihapus.');
  } catch(error) { showToast(friendlyError(error.message)); }
}
function handleTransactionAction(event) {
  const edit=event.target.closest('[data-edit]');
  const del=event.target.closest('[data-delete]');
  if (edit) { const row=transactions.find(t=>t.id===edit.dataset.edit); if(row) openEntry(row.type,row); }
  if (del) deleteTransaction(del.dataset.delete);
}
function exportCsv() {
  const rows=selectedRows();
  const data=[['Tanggal','Jenis','Keterangan','Kategori','Dompet','Dompet Tujuan','Nominal','Catatan'],...rows.map(t=>[t.date,t.type,t.description,t.category||'',WALLETS[t.wallet].name,t.toWallet?WALLETS[t.toWallet].name:'',t.amount,t.note||''])];
  const csv=data.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const link=document.createElement('a'); link.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
  link.download=`PinkPocket-${period}.csv`; link.click(); URL.revokeObjectURL(link.href);
}
function init() {
  if (!isConfigured() || !window.supabase?.createClient) { showConfig(); return; }
  const cfg=window.PINKPOCKET_CONFIG;
  // Normalize the project URL so PostgREST's /rest/v1 is added exactly once.
  const projectUrl=String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '').replace(/(?:\/rest\/v1)+$/i, '');
  client=window.supabase.createClient(projectUrl,cfg.supabaseAnonKey,{
    auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}
  });
  enterApp();
  $('#periodButton').addEventListener('click',openMonthPicker);
  $('#prevMonth').addEventListener('click',()=>moveMonth(-1));
  $('#nextMonth').addEventListener('click',()=>moveMonth(1));
  $('#prevYear').addEventListener('click',()=>{if(calendarYear>2026){calendarYear--;renderPeriod();}});
  $('#nextYear').addEventListener('click',()=>{calendarYear++;renderPeriod();});
  $('#monthGrid').addEventListener('click',event=>{
    const button=event.target.closest('[data-month]'); if(!button||button.disabled)return;
    period=button.dataset.month; calendarYear=Number(period.slice(0,4)); selectedCalendarDay=''; selectedChartDay='';
    $('#monthPopover').hidden=true; $('#periodButton').setAttribute('aria-expanded','false'); render();
  });
  document.addEventListener('click',event=>{
    if(!event.target.closest('.period-card')){$('#monthPopover').hidden=true;$('#periodButton').setAttribute('aria-expanded','false');}
  });
  $$('[data-view]').forEach(button=>button.addEventListener('click',()=>changeView(button.dataset.view)));
  $$('[data-open]').forEach(button=>button.addEventListener('click',()=>changeView(button.dataset.open)));
  $('#addFab').addEventListener('click',()=>openEntry());
  $('#addTransactionTop').addEventListener('click',()=>openEntry());
  $('#closeEntry').addEventListener('click',closeEntry);
  $('#modalScrim').addEventListener('click',event=>{if(event.target===$('#modalScrim'))closeEntry();});
  $$('.entry-types button').forEach(button=>button.addEventListener('click',()=>setType(button.dataset.type)));
  $('#entryForm').addEventListener('submit',saveEntry);
  $('#typeFilters').addEventListener('click',event=>{
    const button=event.target.closest('[data-filter]'); if(!button)return;
    activeFilter=button.dataset.filter; $$('#typeFilters button').forEach(item=>item.classList.toggle('selected',item===button)); render();
  });
  ['#transactionList','#homeRecent','#calendarDayTransactions'].forEach(selector=>$(selector).addEventListener('click',handleTransactionAction));
  $('#calendarGrid').addEventListener('click',event=>{
    const button=event.target.closest('[data-calendar-day]');
    if(!button)return;
    selectedCalendarDay=button.dataset.calendarDay;
    renderCalendar(selectedRows());
  });
  const selectChartDay = (date) => { selectedChartDay=date; renderChart(selectedRows()); };
  $('#dailyChart').addEventListener('click',event=>{const point=event.target.closest('[data-chart-day]');if(point)selectChartDay(point.dataset.chartDay);});
  $('#dailyChart').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const point=event.target.closest('[data-chart-day]');if(point){event.preventDefault();selectChartDay(point.dataset.chartDay);}}});
  $('#exportCsv').addEventListener('click',exportCsv);
  window.addEventListener('focus',()=>fetchTransactions(true).catch(()=>{}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)fetchTransactions(true).catch(()=>{});});
}
init();
