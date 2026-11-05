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
const todayLocal = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; };

let client = null;
let currentUser = null;
let transactions = [];
let period = '2026-11';
let calendarYear = 2026;
let activeType = 'expense';
let activeFilter = 'all';
let openedDay = '';
let editingId = null;
let selectedChartDay = '';
let authMode = 'login';
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
function showAuth(message='') {
  $('#authScreen').hidden = false;
  $('#configScreen').hidden = true;
  $('#appShell').hidden = true;
  $('#authMessage').textContent = message;
}
function showConfig() {
  $('#authScreen').hidden = true;
  $('#appShell').hidden = true;
  $('#configScreen').hidden = false;
}
function showApp() {
  $('#authScreen').hidden = true;
  $('#configScreen').hidden = true;
  $('#appShell').hidden = false;
  $('#accountEmail').textContent = currentUser?.email || '';
}
function updateAuthLabels() {
  const signup = authMode === 'signup';
  $('#authSubtitle').textContent = signup ? 'Buat satu akun yang akan dipakai bersama.' : 'Masuk ke ruang keuangan kalian.';
  $('#authSubmit').textContent = signup ? 'Buat akun bersama ♡' : 'Masuk ke PinkPocket ♡';
  $('#authSwitch').innerHTML = signup
    ? 'Sudah punya akun? <button type="button" id="toggleAuth">Masuk</button>'
    : 'Belum punya akun? <button type="button" id="toggleAuth">Buat akun bersama</button>';
  $('#authPassword').autocomplete = signup ? 'new-password' : 'current-password';
  $('#authMessage').textContent = '';
  $('#toggleAuth').addEventListener('click', () => { authMode = signup ? 'login' : 'signup'; updateAuthLabels(); });
}
async function handleAuth(event) {
  event.preventDefault();
  if (!client) return;
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  const button = $('#authSubmit');
  button.disabled = true;
  button.textContent = authMode === 'signup' ? 'Membuat akun...' : 'Memeriksa akun...';
  $('#authMessage').textContent = '';
  try {
    if (authMode === 'signup') {
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { emailRedirectTo: window.location.href.split('#')[0] }
      });
      if (error) throw error;
      if (data.session) {
        currentUser = data.user;
        await enterApp();
      } else {
        authMode = 'login';
        updateAuthLabels();
        $('#authEmail').value = email;
        $('#authMessage').textContent = 'Akun dibuat. Cek email untuk konfirmasi, lalu masuk dengan akun yang sama di kedua perangkat.';
      }
    } else {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user;
      await enterApp();
    }
  } catch (error) {
    $('#authMessage').textContent = friendlyError(error.message || 'Autentikasi gagal.');
  } finally {
    button.disabled = false;
    button.textContent = authMode === 'signup' ? 'Buat akun bersama ♡' : 'Masuk ke PinkPocket ♡';
  }
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
    userId: row.user_id,
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
  if (!client || !currentUser) return;
  if (!quiet) setSyncStatus('Menyinkronkan data...');
  const { data, error } = await client.from('transactions').select('*').eq('user_id', currentUser.id).order('date',{ascending:false}).order('created_at',{ascending:false});
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
  realtimeChannel = client.channel(`pinkpocket-transactions-${currentUser.id}`)
    .on('postgres_changes', { event:'*', schema:'public', table:'transactions' }, () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => fetchTransactions(true).catch(() => {}), 250);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setSyncStatus('Tersinkron • data bersama aktif');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncStatus('Realtime terputus • coba muat ulang', true);
    });
  try { await fetchTransactions(); }
  catch (error) { showToast('Data belum bisa dimuat. Cek setup SQL Supabase.'); }
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
    <div class="transaction-main"><strong>${escapeHTML(t.description)}</strong><small>${escapeHTML(detail)}${showDate?' · '+formatDate(t.date):''}</small></div>
    <div class="transaction-right"><b class="${amountClass}">${prefix} ${money(t.amount)}</b>
      <span class="row-actions"><button class="edit-one" data-edit="${escapeHTML(t.id)}" aria-label="Edit transaksi">✎</button><button data-delete="${escapeHTML(t.id)}" aria-label="Hapus transaksi">×</button></span>
    </div>
  </article>`;
}
function emptyState(title='Belum ada transaksi',subtitle='Catat pemasukan atau pengeluaran pertamamu di sini.') {
  return `<div class="empty-state"><div class="empty-illustration">♡</div><strong>${title}</strong><p>${subtitle}</p></div>`;
}
function renderChart(rows) {
  const [year,month] = period.split('-').map(Number);
  const lastDay = new Date(year,month,0).getDate();
  const daily = Array.from({length:lastDay},(_,i) => {
    const date = `${period}-${String(i+1).padStart(2,'0')}`;
    const result = sumRows(rows.filter(t => t.date === date));
    return { date, day:i+1, income:result.income, expense:result.expense };
  });
  const maxValue = Math.max(1,...daily.flatMap(d => [d.income,d.expense]));
  const chartMax = maxValue * 1.12;
  const width = 760, height = 230, left = 66, right = 16, top = 15, bottom = 35;
  const plotWidth = width-left-right, plotHeight = height-top-bottom;
  const x = (index) => left + (daily.length <= 1 ? 0 : index*plotWidth/(daily.length-1));
  const y = (value) => top + plotHeight - (value/chartMax)*plotHeight;
  const incomePts = daily.map((d,i)=>`${x(i).toFixed(1)},${y(d.income).toFixed(1)}`);
  const expensePts = daily.map((d,i)=>`${x(i).toFixed(1)},${y(d.expense).toFixed(1)}`);
  const incomePath = incomePts.map((p,i)=>`${i?'L':'M'}${p}`).join(' ');
  const expensePath = expensePts.map((p,i)=>`${i?'L':'M'}${p}`).join(' ');
  const gapPath = `${incomePts.map((p,i)=>`${i?'L':'M'}${p}`).join(' ')} ${expensePts.slice().reverse().map(p=>`L${p}`).join(' ')} Z`;
  const grid = [0,.5,1].map(ratio => {
    const yy = top + plotHeight*(1-ratio);
    return `<line class="chart-grid-line" x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text class="chart-axis-text" x="${left-9}" y="${yy+3}" text-anchor="end">${escapeHTML(compactMoney(chartMax*ratio))}</text>`;
  }).join('');
  const labelDays = [...new Set([1,5,10,15,20,25,lastDay])];
  const labels = labelDays.map(day => `<text class="chart-axis-text" x="${x(day-1)}" y="${height-8}" text-anchor="middle">${day}</text>`).join('');
  const markers = daily.map((d,i) => `
    <g class="chart-point income" data-chart-day="${d.date}" tabindex="0" role="button" aria-label="Pemasukan tanggal ${d.day}: ${money(d.income)}"><title>${d.day} ${MONTHS[month-1]} · Masuk ${money(d.income)}</title><circle cx="${x(i)}" cy="${y(d.income)}" r="3.5"/></g>
    <g class="chart-point expense" data-chart-day="${d.date}" tabindex="0" role="button" aria-label="Pengeluaran tanggal ${d.day}: ${money(d.expense)}"><title>${d.day} ${MONTHS[month-1]} · Keluar ${money(d.expense)}</title><circle cx="${x(i)}" cy="${y(d.expense)}" r="3.5"/></g>`).join('');
  $('#dailyChart').innerHTML = `<svg class="daily-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafik garis pemasukan dan pengeluaran harian bulan ${monthLabel(period)}">${grid}<path class="chart-gap" d="${gapPath}"/><path class="chart-income-line" d="${incomePath}"/><path class="chart-expense-line" d="${expensePath}"/>${markers}${labels}</svg>`;
  const nonZero = daily.filter(d => d.income || d.expense);
  if (!daily.some(d => d.date === selectedChartDay) || selectedChartDay.slice(0,7) !== period) selectedChartDay = (nonZero[0] || daily[0]).date;
  renderChartDetail(daily.find(d => d.date === selectedChartDay) || daily[0]);
}
function renderChartDetail(day) {
  if (!day) { $('#chartDetail').innerHTML = 'Belum ada data arus kas.'; return; }
  const net = day.income - day.expense;
  const sign = net > 0 ? '+' : net < 0 ? '−' : '';
  $('#chartDetail').innerHTML = `<strong>${escapeHTML(formatDate(day.date))}</strong><div class="chart-detail-grid">
    <div><span>Pemasukan</span><b class="positive">${money(day.income)}</b></div>
    <div><span>Pengeluaran</span><b class="negative">${money(day.expense)}</b></div>
    <div><span>Selisih</span><b class="${net>0?'positive':net<0?'negative':'neutral'}">${sign}${money(Math.abs(net))}</b></div>
  </div>`;
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
  $('#walletList').innerHTML = Object.entries(WALLETS).map(([key,w])=>`<article class="wallet-large ${w.color}"><div class="wallet-large-top"><span class="wallet-large-icon">${w.icon}</span><span class="wallet-period">SALDO AKHIR PERIODE</span></div><div class="wallet-large-name">${w.name}</div><strong>${money(balances[key])}</strong></article>`).join('');
  $('#homeRecent').innerHTML = rows.slice(0,4).map(t=>transactionMarkup(t)).join('') || emptyState('Dompet masih kosong ♡','Belum ada catatan untuk periode ini. Tekan tombol + untuk mulai.');
  const filtered = rows.filter(t=>activeFilter==='all'||t.type===activeFilter);
  $('#transactionList').innerHTML = filtered.map(t=>transactionMarkup(t)).join('') || emptyState('Belum ada transaksi','Semua masih Rp0. Tambahkan catatan pertamamu dengan tombol +.');
  $('#walletActivity').innerHTML = rows.map(t=>transactionMarkup(t)).join('') || emptyState('Belum ada aktivitas dompet','Riwayat akan muncul setelah kalian mencatat transaksi.');
  const byDate = {};
  rows.forEach(t=>(byDate[t.date] ||= []).push(t));
  const days = Object.keys(byDate).sort().reverse();
  $('#dayCount').textContent = `${days.length} hari`;
  $('#dailyDetails').innerHTML = days.map(date=>{
    const dayRows=byDate[date], daySum=sumRows(dayRows), expanded=openedDay===date;
    return `<article class="day-card"><button class="day-toggle" data-day="${date}"><span><strong>${formatDate(date)}</strong><small>Masuk ${money(daySum.income)} <i>·</i> Keluar ${money(daySum.expense)}</small></span><b>${expanded?'−':'+'}</b></button>${expanded?`<div class="day-transactions">${dayRows.map(t=>transactionMarkup(t,false)).join('')}</div>`:''}</article>`;
  }).join('') || emptyState('Rekap masih kosong','Setelah ada transaksi, rincian harian akan muncul otomatis.');
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
  period = next; calendarYear = d.getFullYear(); openedDay=''; selectedChartDay='';
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
      result = await client.from('transactions').update(payload).eq('id',editingId).eq('user_id',currentUser.id).select().single();
    } else {
      result = await client.from('transactions').insert({...payload,user_id:currentUser.id}).select().single();
    }
    if (result.error) throw result.error;
    const savedDate = payload.date;
    if (savedDate.slice(0,7)!==period) { period=savedDate.slice(0,7); calendarYear=Number(period.slice(0,4)); }
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
    const {error}=await client.from('transactions').delete().eq('id',id).eq('user_id',currentUser.id);
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
async function signOut() {
  $('#accountPopover').hidden=true;
  try { const {error}=await client.auth.signOut({scope:'local'}); if(error) throw error; }
  catch(error) { showToast(friendlyError(error.message)); }
}

function init() {
  if (!isConfigured() || !window.supabase?.createClient) { showConfig(); return; }
  const cfg=window.PINKPOCKET_CONFIG;
  client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{
    auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
  });
  updateAuthLabels();
  $('#authForm').addEventListener('submit',handleAuth);
  client.auth.getSession().then(({data,error})=>{
    if (error) { showAuth(friendlyError(error.message)); return; }
    if (data.session?.user) { currentUser=data.session.user; enterApp(); }
    else showAuth();
  }).catch(error=>showAuth(friendlyError(error.message)));
  client.auth.onAuthStateChange((_event,session)=>{
    if (session?.user && (!currentUser || currentUser.id!==session.user.id)) {
      currentUser=session.user; enterApp();
    } else if (!session?.user && currentUser) {
      currentUser=null; transactions=[]; if(realtimeChannel){client.removeChannel(realtimeChannel);realtimeChannel=null;} showAuth();
    }
  });
  $('#periodButton').addEventListener('click',openMonthPicker);
  $('#prevMonth').addEventListener('click',()=>moveMonth(-1));
  $('#nextMonth').addEventListener('click',()=>moveMonth(1));
  $('#prevYear').addEventListener('click',()=>{if(calendarYear>2026){calendarYear--;renderPeriod();}});
  $('#nextYear').addEventListener('click',()=>{calendarYear++;renderPeriod();});
  $('#monthGrid').addEventListener('click',event=>{
    const button=event.target.closest('[data-month]'); if(!button||button.disabled)return;
    period=button.dataset.month; calendarYear=Number(period.slice(0,4)); openedDay=''; selectedChartDay='';
    $('#monthPopover').hidden=true; $('#periodButton').setAttribute('aria-expanded','false'); render();
  });
  document.addEventListener('click',event=>{
    if(!event.target.closest('.period-card')){$('#monthPopover').hidden=true;$('#periodButton').setAttribute('aria-expanded','false');}
    if(!event.target.closest('.topbar')&&!event.target.closest('.account-popover'))$('#accountPopover').hidden=true;
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
  ['#transactionList','#homeRecent','#walletActivity','#dailyDetails'].forEach(selector=>$(selector).addEventListener('click',handleTransactionAction));
  $('#dailyDetails').addEventListener('click',event=>{const button=event.target.closest('[data-day]');if(!button)return;openedDay=openedDay===button.dataset.day?'':button.dataset.day;render();});
  $('#dailyChart').addEventListener('click',event=>{const point=event.target.closest('[data-chart-day]');if(!point)return;selectedChartDay=point.dataset.chartDay;const rows=selectedRows();const dayRows=rows.filter(t=>t.date===selectedChartDay);const sums=sumRows(dayRows);renderChartDetail({date:selectedChartDay,income:sums.income,expense:sums.expense});});
  $('#dailyChart').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const point=event.target.closest('[data-chart-day]');if(point){event.preventDefault();selectedChartDay=point.dataset.chartDay;const sums=sumRows(selectedRows().filter(t=>t.date===selectedChartDay));renderChartDetail({date:selectedChartDay,...sums});}}});
  $('#exportCsv').addEventListener('click',exportCsv);
  $('#accountButton').addEventListener('click',()=>{$('#accountPopover').hidden=!$('#accountPopover').hidden;});
  $('#signOutButton').addEventListener('click',signOut);
  window.addEventListener('focus',()=>{if(currentUser)fetchTransactions(true).catch(()=>{});});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentUser)fetchTransactions(true).catch(()=>{});});
}
init();
