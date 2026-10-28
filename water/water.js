/**
 * 水電清查（各自使用版）　作者：Yimei
 * 輸出的 PDF、Excel、備份檔都會標上作者（AUTHOR）。
 * A～H 棟 × 樓層（RF、14F～1F、B1、B2）；2F～14F 逐間＋公共區域點選 ✓ △ ✗ —，
 * 項目與版面比照「1151028-清風安居_水電施工自主檢查未做表.xlsx」的「每層檢查表」。
 * RF（R樓屋頂層）、1F（1樓大公區）、B1／B2（BF地下層）沒有分間，整層一份清單（AREA_DEF），存在 pub 欄位。
 * 還沒有項目的樓層放在 PENDING_FLOORS，會顯示「項目待定」。
 *
 * 資料只存在這台裝置（IndexedDB：water-check / floors），一層一筆：
 *   { id: 'A-5F', b, f, date, inspector,
 *     units: { '1': { type, s: {u01: '✓'}, n: {u01: '缺失說明／未做原因'}, ph: {u01: [照片 id]}, at（最後修改時間）, by（填寫人） } },
 *     pub: { s: {}, n: {}, ph: {}, at: {p01: 時間}, by: {p01: 填寫人} }（公共區域逐項記時間），
 *     fx: { '3|u05': '2026-10-28' }（✗／△ 改成 ✓ 的改善日期），
 *     due: { '3|u05': '2026-11-05' }（預定改善日期，在缺失追蹤填），
 *     log: [{ t, w, k, from, to, by }]（與 ✗、△ 有關的修正紀錄，新的在前），
 * 填寫人名字存在這台裝置（localStorage wc-inspector），第一次進入時填。
 *     printVer（輸出 PDF／列印的版次）, printedAt, updatedAt }
 * photos 表：{ id, floor, w, k, t, by, data（JPEG dataURL，長邊 1280px） }，缺失／未做的現場照片
 * kv 表 settings：{ company, project, confirmed }（公司、工地名稱，第一次進入時確認，印在 PDF 表頭）
 * 備份檔：{ app: 'water-check', format: 1, exportedAt, settings, floors: [...], photos: [...] }，匯入時逐間合併。
 * 戶號顯示為「樓層-間號」，例如 14F-07（資料裡仍以 1～16 存）。
 */
(function () {
  'use strict';

  /* ---------- 項目（與 Excel 相同順序） ---------- */
  const UNIT_GROUPS = [
    ['電氣', 'elec', ['插座', '開關', '電盤結線', '洗衣機專用插座', '陽台燈', '漏電斷路器／接地', '智慧電表']],
    ['弱電', 'weak', ['弱電箱', '電視／網路／電話插座', '對講機', '緊急求救鈴(無障礙戶)']],
    ['消防', 'fire', ['消防灑水', '消防偵測']],
    ['給排水', 'water', ['給水', '排水', '地板落水頭／存水彎', '陽台3"雨排', '陽台3"屋頂平台RP', '2-1/2"洗衣機WP']],
    ['空調／通風', 'air', ['冷氣安裝', '銅管安裝', '陽台1-1/4"ACP', '廁所排氣', '廚房排煙']],
    ['瓦斯', 'gas', ['陽台2"瓦斯管線']],
    ['衛浴／廚具', 'bath', ['衛浴安裝', '熱水器', '廚房(具)']],
  ];
  const PUB_GROUPS = [
    ['電氣', 'elec', ['梯廳燈具', '樓梯(燈具及開關)', '梯廳插座', '緊急照明', '出口／避難方向指示燈', 'busway', '電氣設備室', '公共電表']],
    ['消防', 'fire', ['梯廳廣播及避難逃生', '消防栓、火警、排煙', '防火填塞(管道間穿樓板／牆)']],
    ['給排水', 'water', ['管道間排水', '水錶室(含智慧水錶)', '管道間檢修口／管線標示']],
  ];
  const PRINT_TONE = { elec: '#DDEBF7', weak: '#E4DFEC', fire: '#FCE4D6', water: '#DDF0F7', air: '#E2EFDA', gas: '#FFF2CC', bath: '#EDEDED' };
  const keyed = (groups, p) => { let i = 0; return groups.map(([name, tone, its]) => ({ name, tone, items: its.map(n => ({ k: p + String(++i).padStart(2, '0'), name: n })) })); };
  const UG = keyed(UNIT_GROUPS, 'u'), PG = keyed(PUB_GROUPS, 'p');
  const UI = UG.flatMap(g => g.items), PI = PG.flatMap(g => g.items);
  const NAME = Object.fromEntries([...UI, ...PI].map(i => [i.k, i.name]));
  const pad = n => String(n).padStart(2, '0');
  const SOS = UI.find(i => i.name.startsWith('緊急求救鈴')).k;
  const STATES = ['✓', '△', '✗', '—'];
  const ST_LABEL = { '✓': '完成', '△': '施工中', '✗': '缺失', '—': '不適用' };
  const TYPES = ['1房', '2房', '3房', '無障礙'];

  /* ---------- 棟別與樓層 ---------- */
  const SITE = [['B', 'C'], ['A', 'D'], ['H', 'E'], ['G', 'F']]; // 現場配置
  const UNITS = { B: 16, C: 16, F: 16, G: 16, A: 15, D: 15, H: 15, E: 15 };
  const FLOORS = ['RF', ...Array.from({ length: 13 }, (_, i) => `${14 - i}F`), '1F', 'B1', 'B2'];
  // 屋頂、1 樓大公區、地下層：沒有分間，整層一份清單（B1、B2 用同一份地下層項目）
  const BF = ['排水', '雨水', '給水', '消防', '發電機室', '進排風機房', '汽排', '弱電', '動力'];
  const AREA_DEF = {
    RF: ['R樓屋頂層', 'r', ['排水', '景觀', '雨水', '給水', '瓦斯', '消防', '弱電', '動力']],
    '1F': ['1樓大公區', 'g', ['排水', '景觀', '雨水', '給水', '瓦斯', '消防', '空調', '中控室', '電氣設備室', '弱電', '動力', '陰井']],
    B1: ['BF地下層', 'b', BF],
    B2: ['BF地下層', 'b', BF],
  };
  const AREA = Object.fromEntries(Object.entries(AREA_DEF).map(([f, [title, p, its]]) => [f, { title, items: its.map((n, i) => ({ k: p + pad(i + 1), name: n })) }]));
  const PENDING_FLOORS = []; // 項目待定的樓層（顯示「項目待定」）
  const ACTIVE = FLOORS.filter(f => !PENDING_FLOORS.includes(f));
  const isArea = f => !!AREA[f];
  const pubItems = f => (isArea(f) ? AREA[f].items : PI);
  const pubGroups = f => (isArea(f) ? [{ name: '檢查項目', tone: 'area', items: AREA[f].items }] : PG);
  const unitsOf = r => (isArea(r.f) ? 0 : UNITS[r.b]);
  Object.values(AREA).forEach(a => a.items.forEach(i => { NAME[i.k] = i.name; }));
  // 這套工具的作者：PDF 右下角印工具名稱（像系統名，不像署名）、左下角極淡的作者字，
  // PDF／Excel 檔案內容的作者欄、備份檔都會帶上
  const AUTHOR = 'Yimei';
  const APP_NAME = 'Yimei 工地手帳';
  const SIGN = `<span class="sig">${APP_NAME}</span><span class="sig-h">作者 ${AUTHOR}・${APP_NAME}</span>`;
  const sign = html => html.replace(/<div class="paper[^"]*">/g, m => m + SIGN);

  // 公司名稱、工地名稱：第一次進入時確認（預設帶入清豐安居），印在 PDF 表頭
  const DEFAULT_SETTINGS = { company: '群光電能科技股份有限公司', project: '高雄市楠梓區『清豐安居』社會住宅新建統包工程', confirmed: false };
  let settings = { ...DEFAULT_SETTINGS };
  let editingSettings = false;

  /* ---------- 小工具 ---------- */
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const stamp = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const pct = r => (r == null ? '—' : Math.round(r * 100) + '%');
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }

  /* ---------- 裝置上的資料庫 ---------- */
  let dbp = null;
  function idb() {
    dbp = dbp || new Promise((resolve, reject) => {
      const r = indexedDB.open('water-check', 3);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('floors')) d.createObjectStore('floors', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' }); // settings（公司、工地名稱）
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' }); // 缺失照片
      };
      // 新版要升級資料庫時，另一個分頁還開著舊版就會卡住：提示關掉；這一版被新版要求時自己讓開並重新載入
      r.onblocked = () => { $('#app').innerHTML = '<div class="empty"><b>請先關掉其他開著水電清查的分頁</b>網站已更新，需要整理手機裡的資料。關掉其他分頁（或把它們重新整理）後，這一頁會自動繼續。</div>'; };
      r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); location.reload(); }; resolve(d); };
      r.onerror = () => reject(new Error('無法開啟裝置上的資料庫（可能是瀏覽器的無痕模式或儲存空間不足）'));
    });
    return dbp;
  }
  async function loadAll() {
    const d = await idb();
    return new Promise((resolve, reject) => { const r = d.transaction('floors').objectStore('floors').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  }
  async function loadSettings() {
    const d = await idb();
    const v = await new Promise((resolve, reject) => { const r = d.transaction('kv').objectStore('kv').get('settings'); r.onsuccess = () => resolve(r.result?.value); r.onerror = () => reject(r.error); });
    if (v) settings = { ...DEFAULT_SETTINGS, ...v };
  }
  async function saveSettings(next) {
    settings = { company: String(next.company || '').trim().slice(0, 60), project: String(next.project || '').trim().slice(0, 80), confirmed: true };
    const d = await idb();
    await new Promise((resolve, reject) => {
      const t = d.transaction('kv', 'readwrite');
      t.objectStore('kv').put({ key: 'settings', value: settings });
      t.oncomplete = resolve;
      t.onerror = t.onabort = () => reject(t.error || new Error('儲存失敗（可能是儲存空間不足）'));
    });
  }
  /* ---------- 照片：存在裝置的 photos 表，畫面用時才讀，讀過的放在記憶體 ---------- */
  const photoCache = new Map();
  async function photoStore(mode) { return (await idb()).transaction('photos', mode).objectStore('photos'); }
  const reqP = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  async function getPhoto(id) {
    if (photoCache.has(id)) return photoCache.get(id);
    const p = await reqP((await photoStore('readonly')).get(id));
    if (p) photoCache.set(id, p);
    return p;
  }
  async function putPhotos(list) {
    const d = await idb();
    await new Promise((resolve, reject) => {
      const t = d.transaction('photos', 'readwrite');
      list.forEach(p => t.objectStore('photos').put(p));
      t.oncomplete = resolve;
      t.onerror = t.onabort = () => reject(t.error || new Error('照片儲存失敗（可能是手機空間不足）'));
    });
    list.forEach(p => photoCache.set(p.id, p));
  }
  async function deletePhoto(id) { await reqP((await photoStore('readwrite')).delete(id)); photoCache.delete(id); }
  async function allPhotos() { return reqP((await photoStore('readonly')).getAll()); }
  // 拍的照片縮成長邊 1280px 的 JPEG（約 150～300KB），手機才不會塞爆
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('讀不到這張照片，請再拍一次')); };
      img.src = url;
    });
  }
  // 畫面上的縮圖先放空白，讀到照片再補上
  function fillThumbs(root) {
    (root || document).querySelectorAll('img[data-pid]:not([src])').forEach(async img => {
      const p = await getPhoto(img.dataset.pid).catch(() => null);
      if (p) img.src = p.data; else img.closest('.thumb')?.remove();
    });
  }

  async function putAll(list) {
    const d = await idb();
    return new Promise((resolve, reject) => {
      const t = d.transaction('floors', 'readwrite');
      list.forEach(x => t.objectStore('floors').put(x));
      t.oncomplete = resolve;
      t.onerror = t.onabort = () => reject(t.error || new Error('儲存失敗（可能是儲存空間不足）'));
    });
  }

  /* ---------- 資料 ---------- */
  const floors = new Map();
  const fid = (b, f) => `${b}-${f}`;
  // 戶號：14F-07；公共區域或屋頂／1F／地下層顯示區域名稱
  const unitNo = (f, w) => `${f}-${pad(w)}`;
  const label = (r, w) => (w === 'pub' ? (isArea(r.f) ? AREA[r.f].title : '公共區域') : unitNo(r.f, w));
  function rec(b, f) {
    return floors.get(fid(b, f)) || { id: fid(b, f), b, f, date: '', inspector: '', units: {}, pub: { s: {}, n: {} }, fx: {}, log: [], printVer: 0, updatedAt: 0 };
  }
  // quiet：文字欄位存檔時不重畫，避免打完字後點的第一下按鈕被重畫吃掉
  function commit(r, quiet) {
    if (!r.date) r.date = today();
    if (!r.inspector) r.inspector = ls.get('wc-inspector') || '';
    r.updatedAt = Date.now();
    floors.set(r.id, r);
    putAll([r]).catch(e => toast(e.message));
    if (!quiet) render();
  }
  const box = (r, w) => (w === 'pub' ? r.pub : (r.units[w] = r.units[w] || {}));
  const me = () => ls.get('wc-inspector') || '';
  // 記下誰、什麼時候改的：每一間記在 unit.at／unit.by；公共區域逐項記在 pub.at[k]／pub.by[k]（匯入合併時比較新舊用）
  function touch(r, w, k) {
    const t = Date.now();
    if (w === 'pub') { r.pub.at = { ...(r.pub.at || {}), [k]: t }; r.pub.by = { ...(r.pub.by || {}), [k]: me() }; }
    else { const u = box(r, w); u.at = t; u.by = me(); }
  }
  const OPEN = v => v === '✗' || v === '△'; // 要寫原因／缺失的狀態
  function setStatus(r, w, k, v) {
    const b = box(r, w); b.s = b.s || {};
    const prev = b.s[k] || '';
    if (prev === v) v = ''; // 再點一次＝取消
    b.s[k] = v;
    if (OPEN(prev) || OPEN(v)) { r.log.unshift({ t: Date.now(), w, k, from: prev, to: v, by: me() }); r.log.length = Math.min(r.log.length, 300); }
    if (OPEN(prev) && v === '✓') r.fx[`${w}|${k}`] = today();
    if (OPEN(v)) delete r.fx[`${w}|${k}`];
    touch(r, w, k);
    commit(r);
  }

  /* ---------- 統計（與 Excel 公式相同：— 不計入，留白＝未檢查） ---------- */
  function info(s, items) {
    let done = 0, na = 0, filled = 0, bad = 0;
    for (const it of items) { const v = s?.[it.k]; if (!v) continue; filled++; if (v === '✓') done++; else if (v === '—') na++; else if (v === '✗') bad++; }
    return { done, na, filled, bad };
  }
  function unitInfo(u) { const i = info(u?.s, UI); i.rate = i.filled ? (UI.length - i.na ? i.done / (UI.length - i.na) : null) : null; return i; }
  // f：樓層（屋頂、1F、地下層用各自的清單，其他樓層用公共區域 14 項）
  function pubInfo(p, f) {
    const items = pubItems(f), i = info(p?.s, items);
    i.total = items.length - i.na;
    i.rate = i.filled - i.na > 0 ? i.done / (i.filled - i.na) : null;
    return i;
  }
  function floorInfo(r) {
    const rates = []; let bad = 0, started = 0;
    for (let i = 1; i <= unitsOf(r); i++) { const ui = unitInfo(r.units[i]); if (ui.rate != null) rates.push(ui.rate); if (ui.filled) started++; bad += ui.bad; }
    const pi = pubInfo(r.pub, r.f); bad += pi.bad;
    const rate = isArea(r.f) ? pi.rate : rates.length ? rates.reduce((a, c) => a + c, 0) / rates.length : null;
    return { rate, started, pub: pi, bad, touched: started > 0 || pi.filled > 0 };
  }
  function buildingInfo(b) {
    const rs = ACTIVE.map(f => floors.get(fid(b, f))).filter(Boolean).map(floorInfo).filter(x => x.touched);
    const rates = rs.map(x => x.rate).filter(x => x != null);
    return { floorsDone: rs.length, rate: rates.length ? rates.reduce((a, c) => a + c, 0) / rates.length : null, bad: rs.reduce((n, x) => n + x.bad, 0) };
  }

  /* ---------- 兩段式確認 ---------- */
  let armed = null, armTimer = null;
  function arm(id, btn) {
    if (armed === id) { armed = null; clearTimeout(armTimer); return true; }
    armed = id; clearTimeout(armTimer);
    btn.dataset.label = btn.textContent; btn.textContent = '再按一次確認'; btn.classList.add('armed');
    armTimer = setTimeout(() => { armed = null; btn.textContent = btn.dataset.label; btn.classList.remove('armed'); }, 3000);
    return false;
  }

  /* ---------- 路由：#/ 棟別、#/defects 缺失追蹤、#/b/A 樓層、#/f/A/5F 填寫 ---------- */
  const ui = { unit: '1', floor: null, showFixed: false, sel: new Set(), fb: '', fc: '' };
  const parse = () => location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  function render() {
    if (!settings.confirmed || !me() || editingSettings) return renderSetup();
    const [v, b, f] = parse();
    if (v === 'f' && UNITS[b] && ACTIVE.includes(f)) {
      if (ui.floor !== fid(b, f)) { ui.floor = fid(b, f); ui.unit = '1'; }
      if (isArea(f)) ui.unit = 'pub'; // 整層一份清單，沒有分間
      return renderFloor(b, f);
    }
    ui.floor = null;
    if (v === 'b' && UNITS[b]) return renderBuilding(b);
    renderHome(v === 'defects' || v === 'overview' ? v : 'site');
  }

  function backupBanner() {
    const last = Number(ls.get('wc-lastBackup') || 0);
    const pending = [...floors.values()].filter(r => r.updatedAt > last);
    if (!pending.length) return '';
    const since = last || Math.min(...pending.map(r => r.updatedAt));
    const days = Math.floor((Date.now() - since) / 86400000);
    if (days < 7) return '';
    return `<div class="banner"><span>${last ? `已經 ${days} 天沒有備份` : '還沒有備份過'}。資料只存在這台手機，換手機或清除瀏覽器資料前請先備份。</span><button class="btn pri sm" data-act="export">💾 立即備份</button></div>`;
  }

  // 加到主畫面：手機上用「主畫面圖示」開啟，資料比較不會被瀏覽器清掉；Android 可直接按鈕安裝，iPhone 要從分享選單加入
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; render(); });
  window.addEventListener('appinstalled', () => { installEvt = null; toast('已加到主畫面'); render(); });
  function installBanner() {
    if (standalone() || ls.get('wc-install-hide') === '1') return '';
    const how = installEvt ? '<button class="btn pri sm" data-act="install">📲 加到主畫面</button>'
      : isIOS ? '<span class="muted">用 Safari 開啟 → 點下方「分享」<b>⬆︎</b> →「加入主畫面」</span>'
        : '<span class="muted">瀏覽器選單（⋮）→「加到主畫面」或「安裝應用程式」</span>';
    return `<div class="banner install"><span><b>加到主畫面，資料比較不會被清掉</b><br>之後從主畫面的圖示打開，沒網路也能用；點選後會自動存在手機，不用另外按儲存。</span>
      <div class="row">${how}<button class="btn sm" data-act="installhide">不再提醒</button></div></div>`;
  }

  // 進入水電清查先確認公司、工地名稱（第一次一定要確認；之後在首頁按「✎ 修改」）
  function renderSetup() {
    const first = !settings.confirmed || !me();
    $('#bar').innerHTML = `${first ? '<a class="ib" href="../" aria-label="回工具箱">‹ 工具箱</a>' : ''}<h1>${first ? '開始之前' : '修改名稱'}<small>水電清查</small></h1>`;
    $('#app').innerHTML = `<form class="card" id="setup" style="display:flex;flex-direction:column;gap:12px">
      <b style="font-size:17px">確認公司、工地與你的名字</b>
      <span class="muted">公司、工地名稱會印在 PDF 表頭；你的名字會記在你填的每一間，管理者匯入後看得到是誰填的。之後可以在水電清查首頁按「✎ 修改」。</span>
      <label class="f">公司名稱<input id="s-company" name="company" value="${esc(settings.company)}" maxlength="60" autocomplete="organization" required></label>
      <label class="f">工地名稱（工程名稱）<input id="s-project" name="project" value="${esc(settings.project)}" maxlength="80" required></label>
      <label class="f">你的名字（填寫人）<input id="s-me" name="me" value="${esc(me())}" maxlength="20" autocomplete="name" placeholder="例：王小明" required></label>
      <div class="row"><button class="btn pri grow" type="submit">${first ? '確認，開始清查' : '儲存'}</button>${first ? '' : '<button class="btn" type="button" data-act="cancelset">取消</button>'}</div></form>`;
  }

  function renderHome(tab) {
    $('#bar').innerHTML = `<a class="ib" href="../" aria-label="回工具箱">‹ 工具箱</a><h1>水電清查<small>A～H 棟逐層逐間</small></h1>`;
    const totalOpen = allDefects().filter(d => !d.fixed).length;
    let h = installBanner() + backupBanner();
    h += `<div class="card row" style="padding:10px 14px"><div class="grow" style="font-size:13px;line-height:1.6">
      <div><span class="muted">工地　</span><b>${esc(settings.project)}</b></div><div><span class="muted">公司　</span>${esc(settings.company)}</div>
      <div><span class="muted">填寫人　</span>${esc(me() || '（未填）')}</div></div>
      <div style="display:flex;flex-direction:column;gap:6px"><button class="btn sm" data-act="editset">✎ 修改</button><a class="btn sm" href="guide.html">📖 使用流程</a></div></div>`;
    h += `<nav class="tabs"><a href="#/" aria-current="${tab === 'site' ? 'page' : 'false'}">棟別</a>
      <a href="#/overview" aria-current="${tab === 'overview' ? 'page' : 'false'}">總覽</a>
      <a href="#/defects" aria-current="${tab === 'defects' ? 'page' : 'false'}">缺失追蹤${totalOpen ? `<span class="cnt">${totalOpen}</span>` : ''}</a></nav>`;
    h += tab === 'defects' ? defectsHTML() : tab === 'overview' ? overviewHTML() : siteHTML();
    $('#app').innerHTML = h;
    fillThumbs($('#app'));
  }
  function siteHTML() {
    let h = `<div class="site">`;
    for (const row of SITE) for (const b of row) {
      const bi = buildingInfo(b);
      h += `<a class="bd" href="#/b/${b}"><b>${b}<small>棟</small></b>
        <div class="prog" aria-hidden="true"><i style="width:${Math.round((bi.rate || 0) * 100)}%"></i></div>
        <div class="meta"><span>每層 ${UNITS[b]} 間</span><span>${pct(bi.rate)}</span></div>
        <div class="meta"><span>已查 ${bi.floorsDone}/${ACTIVE.length} 層</span>${bi.bad ? `<span class="bad-t">✗ ${bi.bad}</span>` : ''}</div></a>`;
    }
    h += `</div><div class="muted" style="text-align:center">棟別依現場配置排列；B、C、F、G 棟每層 16 間，A、D、H、E 棟每層 15 間</div>`;
    h += `<div class="card" style="display:flex;flex-direction:column;gap:8px"><b>💾 備份與交接</b>
      <span class="muted">資料只存在這台手機。換手機、清除瀏覽器資料之前先「匯出備份」。同事把備份檔傳給管理者「匯入備份」，就會逐間合併到這台（同一間以較新的為準，不同間不會互相蓋掉）。</span>
      <div class="row"><button class="btn" data-act="export">匯出備份</button><button class="btn" data-act="import">匯入備份</button></div></div>`;
    return h;
  }
  /* ---------- 總覽：8 棟 × 17 層一張表，點格子直接進該層；下面列出每位填寫人填了多少 ---------- */
  const ORDER_B = Object.keys(UNITS).sort();
  function overviewHTML() {
    let h = `<div class="card ov-wrap"><div class="row" style="margin-bottom:8px"><b class="grow">各棟各層完成率</b>
      <button class="btn pri sm" data-act="xlsx">📊 匯出 Excel</button></div>
      <div class="ov-scroll"><table class="ov"><thead><tr><th>樓層</th>${ORDER_B.map(b => `<th><a href="#/b/${b}">${b}</a></th>`).join('')}</tr></thead><tbody>`;
    for (const f of ACTIVE) {
      h += `<tr><th>${f}</th>`;
      for (const b of ORDER_B) {
        const r = floors.get(fid(b, f)), fi = r ? floorInfo(r) : null;
        if (!fi?.touched) { h += `<td><a class="ov-c" href="#/f/${b}/${f}" aria-label="${b}棟 ${f} 尚未檢查">·</a></td>`; continue; }
        const p = fi.rate == null ? 0 : fi.rate, lv = p >= 1 ? 4 : p >= .7 ? 3 : p >= .4 ? 2 : 1;
        h += `<td><a class="ov-c lv${lv}" href="#/f/${b}/${f}" aria-label="${b}棟 ${f} ${pct(fi.rate)}">${fi.rate == null ? '—' : Math.round(p * 100)}${fi.bad ? '<i>✗</i>' : ''}</a></td>`;
      }
      h += `</tr>`;
    }
    h += `</tbody></table></div><div class="ov-key"><span class="ov-c">·</span>未查<span class="ov-c lv1">%</span>&lt;40<span class="ov-c lv2">%</span>40～69<span class="ov-c lv3">%</span>70～99<span class="ov-c lv4">%</span>完成<span><i class="bad-t">✗</i> 有缺失</span></div></div>`;
    // 填寫人統計（匯入同事備份後就看得到大家各填了多少）
    const who = new Map();
    const add = (name, t, where) => { const k = name || '（未填名字）', x = who.get(k) || { n: 0, last: 0, where: new Set() }; x.n++; x.last = Math.max(x.last, t || 0); x.where.add(where); who.set(k, x); };
    for (const r of floors.values()) {
      for (const u of Object.values(r.units || {})) if (u?.at) add(u.by, u.at, `${r.b}棟`);
      for (const [k, t] of Object.entries(r.pub?.at || {})) add(r.pub.by?.[k], t, `${r.b}棟`);
    }
    h += `<div class="card"><b>填寫人</b>`;
    if (!who.size) h += `<div class="muted" style="margin-top:6px">還沒有資料。同事把備份檔傳給你「匯入備份」後，這裡會列出每個人填了多少。</div>`;
    else h += `<table class="who"><tr><th>填寫人</th><th>筆數</th><th>棟別</th><th>最後填寫</th></tr>${[...who].sort((a, b) => b[1].last - a[1].last).map(([n, x]) =>
      `<tr><td>${esc(n)}</td><td>${x.n}</td><td>${[...x.where].sort().join('、')}</td><td>${stamp(x.last)}</td></tr>`).join('')}</table><div class="muted">筆數：戶內每間算 1 筆、公共區域每項算 1 筆</div>`;
    return h + `</div>`;
  }

  // 工種：戶內／公共區域用分類（電氣、消防…），屋頂／1F／地下層用項目名稱
  const CAT = {};
  [...UG, ...PG].forEach(g => g.items.forEach(i => { CAT[i.k] = g.name; }));
  Object.values(AREA).forEach(a => a.items.forEach(i => { CAT[i.k] = i.name; }));
  const defKey = d => `${d.r.id}|${d.w}|${d.k}`;
  function allDefects() {
    const out = [];
    for (const r of floors.values()) {
      const add = (w, s, n, ph, items) => {
        for (const it of items) {
          const v = s?.[it.k], fx = r.fx[`${w}|${it.k}`];
          const due = r.due?.[`${w}|${it.k}`] || '';
          if (OPEN(v)) out.push({ r, w, k: it.k, v, note: n?.[it.k], ph: ph?.[it.k] || [], due, fixed: false });
          else if (fx && v === '✓') out.push({ r, w, k: it.k, v: '✓', note: n?.[it.k], ph: ph?.[it.k] || [], due, fixed: true, at: fx });
        }
      };
      for (let i = 1; i <= unitsOf(r); i++) add(String(i), r.units[i]?.s, r.units[i]?.n, r.units[i]?.ph, UI);
      add('pub', r.pub.s, r.pub.n, r.pub.ph, pubItems(r.f));
    }
    const fo = f => FLOORS.indexOf(f);
    return out.sort((a, b) => a.r.b.localeCompare(b.r.b) || fo(a.r.f) - fo(b.r.f) || (a.w === 'pub') - (b.w === 'pub') || Number(a.w) - Number(b.w));
  }
  const md = ymd => (ymd ? `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}` : '');
  const overdue = d => !d.fixed && d.due && d.due < today();
  const defLine = d => `${d.r.b}棟 ${label(d.r, d.w)} ${NAME[d.k]} ${d.v}${d.note ? ` ${d.note}` : ''}${d.due ? `（預定 ${md(d.due)} 前改善）` : ''}`;
  function defectsHTML() {
    const all = allDefects(), open = all.filter(d => !d.fixed), fixed = all.filter(d => d.fixed);
    const cats = [...new Set(open.map(d => CAT[d.k]))];
    const match = d => (!ui.fb || d.r.b === ui.fb) && (!ui.fc || CAT[d.k] === ui.fc);
    const shown = open.filter(match);
    for (const k of [...ui.sel]) if (!open.some(d => defKey(d) === k)) ui.sel.delete(k); // 已改善的自動取消勾選
    let h = `<div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="row"><span class="muted grow">未改善 ${open.length} 項${open.some(overdue) ? `（<b class="bad-t">逾期 ${open.filter(overdue).length}</b>）` : ''}・已改善 ${fixed.length} 項</span>
      <button class="btn sm" data-act="togfix">${ui.showFixed ? '隱藏已改善' : '顯示已改善'}</button></div>
      <div class="row"><select id="f-fb" data-filter="fb" aria-label="篩選棟別"><option value="">全部棟別</option>${ORDER_B.map(b => `<option value="${b}" ${ui.fb === b ? 'selected' : ''}>${b} 棟</option>`).join('')}</select>
      <select id="f-fc" data-filter="fc" aria-label="篩選工種"><option value="">全部工種</option>${cats.map(c => `<option ${ui.fc === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="row"><button class="btn sm" data-act="selall">${shown.length && shown.every(d => ui.sel.has(defKey(d))) ? '取消全選' : '全選這些'}</button>
      <span class="muted grow">已勾選 ${ui.sel.size} 項</span>
      <button class="btn line" data-act="line" ${ui.sel.size ? '' : 'disabled'}>傳到 LINE</button><button class="btn sm" data-act="copy" ${ui.sel.size ? '' : 'disabled'}>複製文字</button></div>
      <button class="btn pri" data-act="fixsheet" ${ui.sel.size ? '' : 'disabled'}>📊 勾選的 ${ui.sel.size} 項匯出 Excel 給工班</button>
      <button class="btn" data-act="fiximport">📥 匯入工班回傳的改善單（一次結案）</button>
      <button class="btn" data-act="report">📄 缺失改善報告 PDF（給主管，依目前篩選、含已改善）</button></div>`;
    const list = ui.showFixed ? [...shown, ...fixed.filter(match)] : shown;
    if (!list.length) return h + `<div class="empty"><b>${open.length ? '這個篩選沒有項目' : '目前沒有未改善的項目'}</b>在樓層裡把項目點成 ✗（缺失）或 △（未做／施工中），就會出現在這裡；改善後按「已改善」。</div>`;
    h += `<div class="defs">`;
    for (const d of list) {
      const where = `${d.r.b}棟 ${label(d.r, d.w)}`, key = defKey(d);
      const tag = d.fixed ? '' : d.v === '△' ? '<span class="tag doing">△ 未做</span>' : '<span class="tag bad">✗ 缺失</span>';
      h += `<div class="def ${d.fixed ? 'fixed' : d.v === '△' ? 'doing' : ''} ${overdue(d) ? 'late' : ''}">
        <div class="def-h">${d.fixed ? '' : `<input type="checkbox" class="pick" id="pk-${esc(key)}" data-key="${esc(key)}" ${ui.sel.has(key) ? 'checked' : ''}>`}
        <label for="pk-${esc(key)}"><div class="where">${where}・${esc(CAT[d.k])}</div><div class="what">${tag}${esc(NAME[d.k])}</div></label></div>
        ${d.fixed ? `<span class="muted">✓ ${esc(d.at)} 已改善</span>` : `<button class="btn" data-act="fix" data-aid="${esc(`fix:${d.r.id}:${d.w}:${d.k}`)}">已改善</button>`}
        <div class="why"><span class="grow">${d.note ? esc(d.note) : `<span class="muted">（未寫${d.v === '△' ? '原因' : '缺失說明'}）</span>`}</span>
        <a class="btn sm" href="#/f/${d.r.b}/${d.r.f}" data-unit="${d.w}">前往</a></div>
        ${d.fixed ? (d.due ? `<div class="due muted">預定 ${md(d.due)}・實際 ${md(d.at)} 完成</div>` : '') : `<label class="due ${overdue(d) ? 'late' : ''}">預定改善<input type="date" id="due-${esc(key)}" data-due="${esc(`${d.r.id}|${d.w}|${d.k}`)}" value="${esc(d.due)}">${overdue(d) ? '<b>已逾期</b>' : ''}</label>`}
        ${d.ph.length ? `<div class="thumbs">${d.ph.map(id => `<button class="thumb" data-act="photo" data-pid="${esc(id)}" aria-label="看照片"><img data-pid="${esc(id)}" alt=""></button>`).join('')}</div>` : ''}</div>`;
    }
    return h + `</div>`;
  }
  // 勾選的缺失組成一段文字（給工班的 LINE 訊息）
  function selectedDefects() { return allDefects().filter(d => !d.fixed && ui.sel.has(defKey(d))); }
  function lineText(list) {
    const site = (settings.project.match(/『(.+?)』/) || [])[1] || settings.project;
    return [`【${site}】水電缺失／未完成 ${today().replace(/-/g, '/')}`,
      ...list.map((d, i) => `${i + 1}. ${defLine(d)}`), '請協助改善，完成後回報，謝謝！'].join('\n');
  }
  async function shareLine() {
    const list = selectedDefects();
    if (!list.length) return toast('請先勾選要傳的項目');
    const text = lineText(list);
    // 手機：用系統分享（可以選 LINE），有照片就一起附上；不支援時改開 LINE 的分享網址
    try {
      if (navigator.share) {
        const files = [];
        for (const id of list.flatMap(d => d.ph).slice(0, 10)) {
          const p = await getPhoto(id).catch(() => null);
          if (p) files.push(new File([await (await fetch(p.data)).blob()], `${id}.jpg`, { type: 'image/jpeg' }));
        }
        if (files.length && navigator.canShare?.({ files, text })) await navigator.share({ files, text });
        else await navigator.share({ text });
        return;
      }
    } catch (e) { if (e?.name === 'AbortError') return; }
    window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank');
  }
  async function copyText() {
    const text = lineText(selectedDefects());
    try { await navigator.clipboard.writeText(text); toast('已複製，可以貼到 LINE'); }
    catch (e) { window.prompt('複製下面的文字', text); }
  }

  function renderBuilding(b) {
    const bi = buildingInfo(b);
    $('#bar').innerHTML = `<a class="ib" href="#/" aria-label="回棟別">‹ 棟別</a><h1>${b} 棟<small>每層 ${UNITS[b]} 間・已查 ${bi.floorsDone}/${ACTIVE.length} 層・${pct(bi.rate)}</small></h1>
      <button class="ib" data-act="xlsx" data-b="${b}">Excel</button><button class="ib" data-act="pdfb" data-b="${b}">PDF</button>`;
    let h = `<div class="floors">`;
    for (const f of FLOORS) {
      if (PENDING_FLOORS.includes(f)) {
        h += `<div class="fl wait"><span class="lv">${f}</span><span>項目待定</span><span class="muted">提供項目後再開放填寫</span></div>`;
        continue;
      }
      const r = floors.get(fid(b, f)), fi = r ? floorInfo(r) : null;
      h += `<a class="fl" href="#/f/${b}/${f}"><span class="lv">${f}</span>
        <div class="prog" aria-hidden="true"><i style="width:${Math.round((fi?.rate || 0) * 100)}%"></i></div>
        <div class="meta"><span>${isArea(f) ? `${AREA[f].title}・` : ''}${!fi?.touched ? '尚未檢查' : isArea(f) ? `完成 ${fi.pub.done}/${fi.pub.total}・${pct(fi.rate)}` : `戶內 ${pct(fi.rate)}・${fi.started}/${UNITS[b]} 間・公共 ${fi.pub.done}/${fi.pub.total}`}</span>${fi?.bad ? `<span class="bad-t">✗ ${fi.bad}</span>` : `<span>${esc(r?.date || '')}</span>`}</div></a>`;
    }
    $('#app').innerHTML = h + `</div>`;
  }

  function renderFloor(b, f) {
    const r = rec(b, f), fi = floorInfo(r), n = unitsOf(r), area = isArea(f);
    $('#bar').innerHTML = `<a class="ib" href="#/b/${b}" aria-label="回 ${b} 棟">‹ ${b}棟</a>
      <h1>${b}棟 ${f}<small>${area ? `${AREA[f].title}・完成 ${fi.pub.done}/${fi.pub.total}` : `戶內 ${pct(fi.rate)}・公共 ${fi.pub.done}/${fi.pub.total}`}${fi.bad ? `・✗ ${fi.bad}` : ''}</small></h1>
      <button class="ib" data-act="pdf">PDF</button>`;
    let h = `<div class="card"><div class="row">
      <label class="f">檢查日期<input type="date" id="f-date" data-f="date" value="${esc(r.date || today())}"></label>
      <label class="f">檢查人<input id="f-insp" data-f="inspector" value="${esc(r.inspector || ls.get('wc-inspector') || '')}" placeholder="姓名"></label></div>
      ${r.updatedAt ? `<div class="muted" style="margin-top:6px">最後修改 ${stamp(r.updatedAt)}${r.printVer ? `・已輸出第 ${r.printVer} 版（${esc(r.printedAt || '')}）` : ''}</div>` : ''}</div>`;
    if (area) { $('#app').innerHTML = h + pubPanel(r) + logHTML(r); fillThumbs($('#app')); return; }
    h += `<div class="chips" role="tablist" aria-label="選擇第幾間">`;
    for (let i = 1; i <= n; i++) {
      const u = unitInfo(r.units[i]);
      h += `<button class="chip ${u.rate === 1 ? 'full' : u.filled ? 'part' : ''} ${u.bad ? 'bad' : ''}" data-act="unit" data-u="${i}" aria-current="${ui.unit === String(i)}">${unitNo(f, i)}</button>`;
    }
    h += `<button class="chip pubc ${fi.pub.bad ? 'bad' : ''}" data-act="unit" data-u="pub" aria-current="${ui.unit === 'pub'}">公共區域</button></div>`;
    h += ui.unit === 'pub' ? pubPanel(r) : unitPanel(r, ui.unit);
    const order = [...Array.from({ length: n }, (_, i) => String(i + 1)), 'pub'], idx = order.indexOf(ui.unit);
    h += `<div class="nav2"><button class="btn" data-act="unit" data-u="${order[idx - 1] || ''}" ${idx > 0 ? '' : 'disabled'}>‹ ${order[idx - 1] ? label(r, order[idx - 1]) : '上一間'}</button>
      <button class="btn" data-act="unit" data-u="${order[idx + 1] || ''}" ${idx < order.length - 1 ? '' : 'disabled'}>${order[idx + 1] ? label(r, order[idx + 1]) : '下一間'} ›</button></div>`;
    h += logHTML(r);
    $('#app').innerHTML = h;
    fillThumbs($('#app'));
  }
  const stButtons = (k, cur) => `<div class="seg" role="group" aria-label="${esc(NAME[k])}">${STATES.map(v =>
    `<button class="st ${cur === v ? 'on' : ''}" data-act="st" data-k="${k}" data-v="${v}" aria-pressed="${cur === v}" aria-label="${esc(NAME[k])} ${ST_LABEL[v]}">${v}</button>`).join('')}</div>`;
  // 點成 △ 時的快速原因（點一下帶入備註，可再自己打字補充）
  const REASONS = ['被撞到', '損壞', '等材料', '等其他工班', '尚未施作', '業主變更'];
  // ✗、△ 下面：說明欄＋拍照（照片存在手機，印在 PDF、跟著備份檔給管理者）
  function photosHTML(k, ids, idp) {
    return `<div class="thumbs">${(ids || []).map(id => `<button type="button" class="thumb" data-act="photo" data-pid="${esc(id)}" aria-label="看照片"><img data-pid="${esc(id)}" alt=""></button>`).join('')}
      <label class="cam" for="cam-${idp}-${k}">📷 拍照<input type="file" id="cam-${idp}-${k}" accept="image/*" capture="environment" data-photo="${k}" hidden></label></div>`;
  }
  function noteHTML(v, k, note, idp, ids) {
    if (v === '✗') return `<div class="why-box"><input class="note" id="${idp}-${k}" data-f="n:${k}" value="${esc(note || '')}" placeholder="缺失說明（例：面板未裝）">${photosHTML(k, ids, idp)}</div>`;
    if (v !== '△') return '';
    return `<div class="why-box"><input class="note doing" id="${idp}-${k}" data-f="n:${k}" value="${esc(note || '')}" placeholder="未做原因（例：被撞到、等材料）">
      <div class="reasons">${REASONS.map(x => `<button type="button" data-act="reason" data-k="${k}" data-v="${x}">${x}</button>`).join('')}</div>${photosHTML(k, ids, idp)}</div>`;
  }
  function itemsHTML(groups, s, notes, idp, ph) {
    let h = '';
    for (const g of groups) {
      h += `<section class="grp"><h3 style="background:var(--t-${g.tone})">${g.name}</h3>`;
      for (const it of g.items) {
        const v = s?.[it.k] || '';
        h += `<div class="item"><div class="iname">${esc(it.name)}</div>${stButtons(it.k, v)}${noteHTML(v, it.k, notes?.[it.k], idp, ph?.[it.k])}</div>`;
      }
      h += `</section>`;
    }
    return h;
  }
  function unitPanel(r, u) {
    const d = r.units[u] || {}, i = unitInfo(d);
    return `<div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="row"><b style="font-size:17px">${unitNo(r.f, u)}</b><span class="sum grow"><span>完成 <b>${i.done}</b>/${UI.length - i.na}</span><span>完成率 <b>${pct(i.rate)}</b></span></span></div>
      ${d.at ? `<div class="muted">最後填寫：${esc(d.by || '（未填名字）')}・${stamp(d.at)}</div>` : ''}
      <div><div class="muted" style="margin-bottom:4px">戶型</div><div class="typeseg">${TYPES.map(t => `<button data-act="type" data-v="${t}" aria-pressed="${d.type === t}">${t}</button>`).join('')}</div></div>
      <button class="btn" data-act="fillok" data-aid="fill:${r.id}:${u}">其餘未填的設為 ✓</button></div>` + itemsHTML(UG, d.s, d.n, `n${u}`, d.ph);
  }
  function pubPanel(r) {
    const i = pubInfo(r.pub, r.f), title = isArea(r.f) ? AREA[r.f].title : '公共區域';
    return `<div class="card row"><b style="font-size:17px;color:var(--t-pub)">${title}</b><span class="muted grow">整層檢查一次；這層沒有的項目點 —</span>
      <span class="sum"><span>完成 <b>${i.done}</b>/${i.total}</span><span><b>${pct(i.rate)}</b></span></span></div>` + itemsHTML(pubGroups(r.f), r.pub.s, r.pub.n, 'pn', r.pub.ph);
  }
  function logHTML(r) {
    if (!r.log.length) return '';
    const li = r.log.slice(0, 40).map(x => `<li>${stamp(x.t)}　${label(r, x.w)}　${esc(NAME[x.k])}：${x.from || '空白'} → ${x.to || '空白'}${x.by ? `　<span class="muted">${esc(x.by)}</span>` : ''}</li>`).join('');
    return `<details class="card log"><summary>修正紀錄（${r.log.length}）</summary><ul>${li}</ul></details>`;
  }

  /* ---------- 列印版（A4 橫式，比照 Excel「每層檢查表」） ---------- */
  const cls = v => ({ '✓': 's1', '△': 's2', '✗': 's3', '—': 's4' }[v] || '');
  // 屋頂、1F、地下層：整層一份清單（項次、項目、狀態、說明、最後填寫）
  function paperAreaHTML(r) {
    const items = pubItems(r.f), p = r.pub, pi = pubInfo(p, r.f);
    let h = `<div class="paper"><div class="t1">${esc(settings.company)}</div>
      <div class="t2"><div class="pj">工程名稱：${esc(settings.project)}</div><div>棟別：<span>${r.b} 棟</span></div><div>樓層：<span>${r.f}</span></div>
      <div>檢查日期：<span>${esc(r.date || '')}</span></div><div>檢查人：<span>${esc(r.inspector || '')}</span></div><div>第 <span>${r.printVer || 1}</span> 版</div></div>
      <div class="lower"><table class="area" style="width:820px"><colgroup><col style="width:44px"><col style="width:150px"><col style="width:64px"><col style="width:430px"><col style="width:132px"></colgroup>
      <tr><th colspan="5" class="zone" style="background:#5E4F6E">${esc(AREA[r.f].title)}（${r.f}，整層一次檢查）</th></tr>
      <tr><th class="gray gh">項次</th><th class="gray gh">項目</th><th class="gray gh">狀態</th><th class="gray gh">缺失／未做說明</th><th class="gray gh">最後填寫</th></tr><tbody>`;
    items.forEach((it, i) => {
      const v = p.s?.[it.k] || '', at = p.at?.[it.k];
      h += `<tr><td>${i + 1}</td><td style="text-align:left;padding-left:8px;font-size:10px">${esc(it.name)}</td><td class="${cls(v)}">${v}</td>
        <td class="l" style="font-size:8.5px;vertical-align:middle">${esc(p.n?.[it.k] || '')}</td><td style="font-size:8px">${at ? `${esc(p.by?.[it.k] || '')} ${stamp(at)}` : ''}</td></tr>`;
    });
    h += `<tr class="tot"><td colspan="2">完成項數／完成率</td><td>${pi.done} / ${pi.total}</td><td>${pi.rate == null ? '' : pct(pi.rate)}</td><td></td></tr></tbody></table>
      <div class="key"><div class="g">${SITE.map(row => row.map(x => `<span class="${x === r.b ? 'me' : ''}">${x}</span>`).join('')).join('')}</div>B-C-F-G 為 16 間<br>A-D-H-E 為 15 間</div></div>
      <div class="notes">填寫說明：狀態 ✓ 完成　△ 施工中／未做（寫原因）　✗ 未施工／有缺失（寫缺失說明）　— 不適用（不計入完成率）；留白＝尚未檢查。<br>
      已完成項目也要看有無被後續工班污損。　　輸出時間：${new Date().toLocaleString('zh-TW', { hour12: false })}</div></div>`;
    return h;
  }
  function paperHTML(r) {
    if (isArea(r.f)) return paperAreaHTML(r);
    const n = UNITS[r.b], W = { no: 44, ty: 34, it: 31, d: 38, rt: 38 };
    let h = `<div class="paper"><div class="t1">${esc(settings.company)}</div>
      <div class="t2"><div class="pj">工程名稱：${esc(settings.project)}</div><div>棟別：<span>${r.b} 棟</span></div><div>樓層：<span>${r.f}</span></div>
      <div>檢查日期：<span>${esc(r.date || '')}</span></div><div>檢查人：<span>${esc(r.inspector || '')}</span></div><div>第 <span>${r.printVer || 1}</span> 版</div></div>
      <table style="width:${W.no + W.ty + UI.length * W.it + W.d + W.rt}px"><colgroup><col style="width:${W.no}px"><col style="width:${W.ty}px">${UI.map(() => `<col style="width:${W.it}px">`).join('')}<col style="width:${W.d}px"><col style="width:${W.rt}px"></colgroup>
      <thead><tr><th rowspan="3" class="gray">戶號</th><th rowspan="3" class="gray">戶型</th><th colspan="${UI.length}" class="zone" style="background:#1F4E78">戶內項目（每間都有）</th>
        <th rowspan="3" class="gray">完成<br>項數</th><th rowspan="3" class="gray">完成率</th></tr>
      <tr>${UG.map(g => `<th colspan="${g.items.length}" class="gh" style="background:${PRINT_TONE[g.tone]}">${g.name}</th>`).join('')}</tr>
      <tr>${UG.map(g => g.items.map(it => `<th class="ih" style="background:${PRINT_TONE[g.tone]}">${esc(it.name)}</th>`).join('')).join('')}</tr></thead><tbody>`;
    const colDone = UI.map(() => 0), rates = [], udef = []; let sumDone = 0;
    for (let i = 1; i <= n; i++) {
      const u = r.units[i] || {}, ui2 = unitInfo(u);
      if (ui2.rate != null) rates.push(ui2.rate);
      sumDone += ui2.done;
      UI.forEach(it => { const v = u.s?.[it.k]; if (OPEN(v)) udef.push(`${unitNo(r.f, i)} ${v}${it.name}${u.n?.[it.k] ? '：' + u.n[it.k] : ''}`); });
      h += `<tr><td style="font-size:8.5px">${unitNo(r.f, i)}</td><td style="font-size:8px">${esc(u.type || '')}</td>${UI.map((it, j) => { const v = u.s?.[it.k] || ''; if (v === '✓') colDone[j]++; return `<td class="${cls(v)}">${v}</td>`; }).join('')}
        <td>${ui2.done}</td><td>${ui2.rate == null ? '' : pct(ui2.rate)}</td></tr>`;
    }
    const avg = rates.length ? rates.reduce((a, c) => a + c, 0) / rates.length : null;
    h += `<tr class="tot"><td colspan="2">完成間數</td>${colDone.map(c => `<td>${c}</td>`).join('')}<td>${sumDone}</td><td>${avg == null ? '' : pct(avg)}</td></tr></tbody></table>`;
    const p = r.pub, pi = pubInfo(p, r.f);
    h += `<div class="lower"><table style="width:${62 + PI.length * W.it + 112}px"><colgroup><col style="width:62px">${PI.map(() => `<col style="width:${W.it}px">`).join('')}<col style="width:56px"><col style="width:56px"></colgroup>
      <tr><th colspan="${PI.length + 3}" class="zone" style="background:#C55A11">公共區域項目（本層一次檢查，非每間都有）</th></tr>
      <tr><th class="gray gh">分類</th>${PG.map(g => `<th colspan="${g.items.length}" class="gh" style="background:${PRINT_TONE[g.tone]}">${g.name}</th>`).join('')}<th rowspan="2" class="gray">公共<br>完成項數</th><th rowspan="2" class="gray">公共<br>完成率</th></tr>
      <tr><th class="gray ih">項目</th>${PG.map(g => g.items.map(it => `<th class="ih" style="background:${PRINT_TONE[g.tone]}">${esc(it.name)}</th>`).join('')).join('')}</tr>
      <tr><th class="gray" style="height:18px">狀態</th>${PI.map(it => { const v = p.s?.[it.k] || ''; return `<td class="${cls(v)}" style="font-size:9.5px">${v}</td>`; }).join('')}
        <td rowspan="2" class="lt" style="font-size:9.5px">${pi.done} / ${pi.total}</td><td rowspan="2" class="lt" style="font-size:9.5px">${pi.rate == null ? '' : pct(pi.rate)}</td></tr>
      <tr><th class="gray" style="height:40px">缺失／<br>未做說明</th>${PI.map(it => `<td class="l">${esc(p.n?.[it.k] || '')}</td>`).join('')}</tr></table>
      <div class="key"><div class="g">${SITE.map(row => row.map(x => `<span class="${x === r.b ? 'me' : ''}">${x}</span>`).join('')).join('')}</div>B-C-F-G 為 16 間<br>A-D-H-E 為 15 間</div></div>`;
    if (udef.length) h += `<div class="udef"><b>戶內缺失／未做說明：</b>${esc(udef.join('；'))}</div>`;
    h += `<div class="notes">填寫說明：狀態 ✓ 完成　△ 施工中／未做（寫原因）　✗ 未施工／有缺失（寫缺失說明）　— 不適用（不計入完成率）；留白＝尚未檢查。　非無障礙戶「緊急求救鈴」填 —。<br>
      已完成項目也要看有無被後續工班污損；同戶型缺失一併檢查。　　輸出時間：${new Date().toLocaleString('zh-TW', { hour12: false })}</div></div>`;
    return h;
  }
  // 缺失照片頁：每頁 8 張，附上戶號、項目、狀態與說明（照片要先讀進 photoCache）
  function photoPages(r) {
    const cells = [];
    const addCell = (w, s, n, ph, items) => items.forEach(it => (ph?.[it.k] || []).forEach(id => {
      const p = photoCache.get(id); if (!p) return;
      cells.push(`<figure><img src="${p.data}" alt=""><figcaption><b>${esc(label(r, w))}</b> ${esc(it.name)} ${s?.[it.k] || ''}${n?.[it.k] ? `：${esc(n[it.k])}` : ''}</figcaption></figure>`);
    }));
    for (let i = 1; i <= unitsOf(r); i++) addCell(String(i), r.units[i]?.s, r.units[i]?.n, r.units[i]?.ph, UI);
    addCell('pub', r.pub.s, r.pub.n, r.pub.ph, pubItems(r.f));
    let h = '';
    for (let i = 0; i < cells.length; i += 8) {
      h += `<div class="paper photos"><div class="t2"><div class="pj">${esc(settings.company)}　${r.b} 棟 ${r.f}　缺失照片（${Math.floor(i / 8) + 1}／${Math.ceil(cells.length / 8)}）</div><div>第 <span>${r.printVer || 1}</span> 版</div></div>
        <div class="pgrid">${cells.slice(i, i + 8).join('')}</div></div>`;
    }
    return h;
  }
  async function loadPhotosFor(list) {
    const ids = list.flatMap(r => [...Object.values(r.units || {}).flatMap(u => Object.values(u?.ph || {}).flat()), ...Object.values(r.pub?.ph || {}).flat()]);
    await Promise.all(ids.map(id => getPhoto(id).catch(() => null)));
  }
  const papers = list => list.map(r => paperHTML(r) + photoPages(r)).join('');
  let pvList = [];
  // 目前預覽的內容：樓層檢查表（會累加版次）或缺失改善報告
  const pv = { render: () => papers(pvList), file: () => '', bump: true };
  async function openPreview(list) {
    if (!list.length) return toast('這棟還沒有檢查資料');
    pvList = list;
    await loadPhotosFor(list);
    const first = list[0];
    pv.render = () => papers(pvList); pv.bump = true;
    pv.file = () => (pvList.length > 1 ? `水電清查_${first.b}棟_${pvList.length}層.pdf` : `水電清查_${first.b}棟_${first.f}_第${first.printVer}版.pdf`);
    showPreview(list.length > 1 ? `${first.b} 棟（${list.length} 層）` : `${first.b}棟 ${first.f}`);
  }
  function showPreview(title) {
    $('#pv')?.remove();
    const m = document.createElement('div'); m.className = 'modal'; m.id = 'pv';
    m.innerHTML = `<div class="modal-in" role="dialog" aria-label="列印版預覽"><div class="modal-head"><b>${esc(title)}・A4 橫式</b>
      <button class="btn pri" data-act="save">下載 PDF</button><button class="btn" data-act="print">列印</button><button class="btn" data-act="close">關閉</button></div>
      <div class="modal-body"><div class="pv" id="pvin">${sign(pv.render())}</div></div></div>`;
    document.body.appendChild(m);
    const body = m.querySelector('.modal-body'), pvBox = $('#pvin');
    const s = Math.min(1, (body.clientWidth - 24) / 1123);
    // 縮小後把多出來的寬度收掉，預覽框才不會出現橫向捲軸
    pvBox.style.transform = `scale(${s})`; pvBox.style.height = `${pvBox.scrollHeight * s}px`; pvBox.style.marginRight = `${-1123 * (1 - s)}px`;
  }
  /* ---------- 缺失改善報告（給主管）：目前篩選的棟別、工種，含已改善；每項附照片、預定與完成日期 ---------- */
  function reportDefects() {
    return allDefects().filter(d => (!ui.fb || d.r.b === ui.fb) && (!ui.fc || CAT[d.k] === ui.fc))
      .sort((a, b) => a.fixed - b.fixed || a.r.b.localeCompare(b.r.b) || FLOORS.indexOf(a.r.f) - FLOORS.indexOf(b.r.f) || (a.w === 'pub') - (b.w === 'pub') || Number(a.w) - Number(b.w));
  }
  // 已改善的項目，從修正紀錄找出改善前是 ✗ 還是 △
  const origStatus = d => (d.fixed ? (d.r.log.find(l => l.w === d.w && l.k === d.k && l.to === '✓')?.from || '') : d.v);
  function reportPapers(defs) {
    const done = defs.filter(d => d.fixed).length, open = defs.length - done, late = defs.filter(overdue).length;
    const scope = `${ui.fb ? `${ui.fb} 棟` : '全部棟別'}・${ui.fc || '全部工種'}`;
    const per = 8, pages = Math.max(1, Math.ceil(defs.length / per));
    let h = '';
    for (let pg = 0; pg < pages; pg++) {
      const rows = defs.slice(pg * per, pg * per + per);
      h += `<div class="paper report"><div class="t1">${esc(settings.company)}　缺失改善報告</div>
        <div class="t2"><div class="pj">工程名稱：${esc(settings.project)}</div><div>範圍：<span>${esc(scope)}</span></div><div>製表：<span>${esc(me())}</span></div><div>日期：<span>${today()}</span></div><div><span>${pg + 1}／${pages}</span></div></div>
        ${pg ? '' : `<div class="rsum"><span>總計 <b>${defs.length}</b> 項</span><span class="ok">已改善 <b>${done}</b></span><span class="no">未改善 <b>${open}</b></span>${late ? `<span class="no">逾期 <b>${late}</b></span>` : ''}<span>改善率 <b>${defs.length ? Math.round(done / defs.length * 100) : 0}%</b></span></div>`}
        <table class="rtab"><colgroup><col style="width:34px"><col style="width:92px"><col style="width:62px"><col style="width:120px"><col style="width:42px"><col style="width:250px"><col style="width:150px"><col style="width:74px"><col style="width:74px"><col style="width:70px"></colgroup>
        <thead><tr>${['項次', '棟別／戶號', '工種', '項目', '原狀態', '缺失／未做說明・工班回覆', '照片', '預定改善', '改善完成', '查核結果'].map(t => `<th class="gray">${t}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((d, i) => {
          const o = origStatus(d), res = d.fixed ? '<b class="r-ok">已改善</b>' : overdue(d) ? '<b class="r-no">逾期未改善</b>' : '<b class="r-no">未改善</b>';
          const imgs = d.ph.slice(0, 2).map(id => photoCache.get(id)).filter(Boolean).map(p => `<img src="${p.data}" alt="">`).join('');
          return `<tr><td>${pg * per + i + 1}</td><td>${esc(d.r.b)}棟<br>${esc(label(d.r, d.w))}</td><td>${esc(CAT[d.k])}</td><td class="l2">${esc(NAME[d.k])}</td>
            <td class="${cls(o)}">${o}</td><td class="l2">${esc(d.note || '')}</td><td class="ph">${imgs}${d.ph.length > 2 ? `<small>＋${d.ph.length - 2}</small>` : ''}</td>
            <td>${esc(d.due || '')}</td><td>${esc(d.fixed ? d.at : '')}</td><td>${res}</td></tr>`;
        }).join('')}</tbody></table>
        <div class="notes">原狀態：✗ 缺失　△ 未做／施工中。查核結果依改善完成日期與現場查核；照片為查驗時拍攝。　　輸出時間：${new Date().toLocaleString('zh-TW', { hour12: false })}</div></div>`;
    }
    return h;
  }
  async function openReport() {
    const defs = reportDefects();
    if (!defs.length) return toast('這個範圍沒有缺失或改善紀錄');
    await Promise.all(defs.flatMap(d => d.ph.slice(0, 2)).map(id => getPhoto(id).catch(() => null)));
    pv.render = () => reportPapers(defs); pv.bump = false;
    pv.file = () => `缺失改善報告_${ui.fb ? `${ui.fb}棟_` : ''}${today().replace(/-/g, '')}.pdf`;
    showPreview(`缺失改善報告（${defs.length} 項）`);
  }

  // 輸出（下載或列印）＝新的一版：每層版次 +1，記下日期
  function bumpVersions() {
    pvList.forEach(r => { r.printVer = (r.printVer || 0) + 1; r.printedAt = today(); floors.set(r.id, r); });
    putAll(pvList).catch(e => toast(e.message));
  }
  let pdfLoading = null;
  function loadHtml2pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    pdfLoading = pdfLoading || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/vendor/html2pdf.bundle.min.js';
      s.onload = () => resolve(window.html2pdf);
      s.onerror = () => { pdfLoading = null; reject(new Error('無法載入 PDF 元件。可改按「列印」，在列印視窗選「另存為 PDF」。')); };
      document.head.appendChild(s);
    });
    return pdfLoading;
  }
  async function savePdf(btn) {
    btn.disabled = true; btn.textContent = '產生中…';
    const host = $('#printArea');
    try {
      const html2pdf = await loadHtml2pdf();
      if (document.fonts?.ready) await document.fonts.ready;
      if (pv.bump) bumpVersions();
      host.innerHTML = sign(pv.render());
      host.style.cssText = 'display:block;position:absolute;left:-30000px;top:0';
      const pages = [...host.children];
      const opt = { margin: 5, image: { type: 'jpeg', quality: 0.92 }, html2canvas: { scale: 2, backgroundColor: '#ffffff' }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } };
      // 一層一頁，逐頁轉圖，避免整棟一次畫成超大圖（手機會失敗）
      let w = html2pdf().set(opt).from(pages[0]).toPdf();
      pages.slice(1).forEach(p => { w = w.get('pdf').then(pdf => { pdf.addPage(); }).from(p).toContainer().toCanvas().toPdf(); });
      // PDF 的檔案內容（作者、建立程式）寫上作者
      w = w.get('pdf').then(pdf => { pdf.setProperties({ title: pv.file().replace(/\.pdf$/, ''), author: AUTHOR, creator: `${APP_NAME}（作者 ${AUTHOR}）`, subject: settings.project, keywords: `${AUTHOR}, 水電清查` }); });
      await w.save(pv.file());
      toast('PDF 已下載');
    } catch (e) {
      toast(e.message || 'PDF 產生失敗，請改按「列印」');
    } finally {
      host.innerHTML = ''; host.style.cssText = '';
      btn.disabled = false; btn.textContent = '下載 PDF';
      $('#pvin') && ($('#pvin').innerHTML = sign(pv.render()));
    }
  }
  function printPapers() {
    if (pv.bump) bumpVersions();
    $('#printArea').innerHTML = sign(pv.render());
    window.print();
  }

  /* ---------- 匯出 Excel：總覽、缺失清單、每層一張工作表（版面比照每層檢查表） ---------- */
  const stCell = v => ({ v: v || '', s: { '✓': 'ok', '△': 'doing', '✗': 'bad', '—': 'na' }[v] || 'cell' });
  const byCell = (by, at) => ({ v: at ? `${by || ''} ${stamp(at)}` : '', s: 'cell' });
  const fOrder = (a, b) => a.b.localeCompare(b.b) || FLOORS.indexOf(a.f) - FLOORS.indexOf(b.f);
  function floorSheet(r) {
    const head = (v, extra) => ({ v, s: 'head', ...extra });
    const rows = [[{ v: settings.company, s: 'title' }], [`工程名稱：${settings.project}`],
      [`棟別：${r.b} 棟`, '', `樓層：${r.f}`, '', `檢查日期：${r.date || ''}`, '', '', `檢查人：${r.inspector || ''}`], []];
    if (isArea(r.f)) {
      rows.push([head('項次'), head('項目'), head('狀態'), head('缺失／未做說明'), head('照片'), head('最後填寫')]);
      pubItems(r.f).forEach((it, i) => rows.push([{ v: i + 1, s: 'cell' }, { v: it.name, s: 'left' }, stCell(r.pub.s?.[it.k]), { v: r.pub.n?.[it.k] || '', s: 'wrap' },
        { v: (r.pub.ph?.[it.k] || []).length || '', s: 'cell' }, byCell(r.pub.by?.[it.k], r.pub.at?.[it.k])]));
      const pi = pubInfo(r.pub, r.f);
      rows.push([{ v: '完成項數／完成率', s: 'head' }, { v: '', s: 'head' }, { v: `${pi.done} / ${pi.total}`, s: 'cell' }, pi.rate == null ? { v: '', s: 'cell' } : { v: pi.rate, s: 'pct' }]);
      return { name: `${r.b}-${r.f}`, cols: [6, 16, 7, 40, 6, 16], rows, merges: ['A1:F1', 'A2:F2', `A${rows.length}:B${rows.length}`] };
    }
    rows.push([head('戶號'), head('戶型'), ...UI.map(it => head(it.name)), head('完成項數'), head('完成率'), head('缺失／未做說明'), head('最後填寫')]);
    for (let i = 1; i <= unitsOf(r); i++) {
      const u = r.units[i] || {}, ui2 = unitInfo(u);
      const notes = UI.filter(it => OPEN(u.s?.[it.k])).map(it => `${it.name}${u.s[it.k]}${u.n?.[it.k] ? '：' + u.n[it.k] : ''}${(u.ph?.[it.k] || []).length ? `（照片 ${u.ph[it.k].length} 張）` : ''}`).join('；');
      rows.push([{ v: unitNo(r.f, i), s: 'cell' }, { v: u.type || '', s: 'cell' }, ...UI.map(it => stCell(u.s?.[it.k])),
        { v: ui2.done, s: 'cell' }, ui2.rate == null ? { v: '', s: 'cell' } : { v: ui2.rate, s: 'pct' }, { v: notes, s: 'wrap' }, byCell(u.by, u.at)]);
    }
    rows.push([], [{ v: '公共區域（本層一次檢查）', s: 'bold' }], [head('項目'), head(''), head('狀態'), head('缺失／未做說明'), head(''), head(''), head('照片'), head('最後填寫')]);
    const pr0 = rows.length + 1;
    PI.forEach(it => rows.push([{ v: it.name, s: 'left' }, { v: '', s: 'cell' }, stCell(r.pub.s?.[it.k]), { v: r.pub.n?.[it.k] || '', s: 'wrap' }, { v: '', s: 'cell' }, { v: '', s: 'cell' },
      { v: (r.pub.ph?.[it.k] || []).length || '', s: 'cell' }, byCell(r.pub.by?.[it.k], r.pub.at?.[it.k])]));
    const merges = ['A1:H1', 'A2:H2', `A${pr0 - 1}:B${pr0 - 1}`, `D${pr0 - 1}:F${pr0 - 1}`];
    PI.forEach((_, i) => merges.push(`A${pr0 + i}:B${pr0 + i}`, `D${pr0 + i}:F${pr0 + i}`));
    return { name: `${r.b}-${r.f}`, cols: [9, 7, ...UI.map(() => 6), 7, 7, 40, 16], rows, merges };
  }
  function exportXlsx(onlyB) {
    const list = [...floors.values()].filter(r => (!onlyB || r.b === onlyB) && floorInfo(r).touched).sort(fOrder);
    if (!list.length) return toast(onlyB ? '這棟還沒有檢查資料' : '還沒有檢查資料');
    const bs = onlyB ? [onlyB] : ORDER_B;
    const ov = [[{ v: `${settings.company}　水電清查總覽`, s: 'title' }], [`工程名稱：${settings.project}`], [`匯出時間：${new Date().toLocaleString('zh-TW', { hour12: false })}`], [],
      [{ v: '樓層', s: 'head' }, ...bs.map(b => ({ v: `${b} 棟`, s: 'head' }))]];
    for (const f of ACTIVE) ov.push([{ v: f, s: 'head' }, ...bs.map(b => { const r = floors.get(fid(b, f)), fi = r ? floorInfo(r) : null; return !fi?.touched || fi.rate == null ? { v: fi?.touched ? '—' : '', s: 'cell' } : { v: fi.rate, s: 'pct' }; })]);
    const defs = allDefects().filter(d => !d.fixed && (!onlyB || d.r.b === onlyB));
    const dl = [[{ v: '缺失／未完成清單', s: 'title' }], [], ['棟別', '戶號／區域', '工種', '項目', '狀態', '缺失／未做說明', '照片', '預定改善日期', '改善完成日期', '最後填寫'].map(v => ({ v, s: 'head' })),
      ...defs.map(d => [{ v: `${d.r.b} 棟`, s: 'cell' }, { v: label(d.r, d.w), s: 'cell' }, { v: CAT[d.k], s: 'cell' }, { v: NAME[d.k], s: 'left' }, stCell(d.v), { v: d.note || '', s: 'wrap' },
        { v: d.ph.length || '', s: 'cell' }, { v: d.due || '', s: 'cell' }, { v: '', s: 'cell' }, d.w === 'pub' ? byCell(d.r.pub.by?.[d.k], d.r.pub.at?.[d.k]) : byCell(d.r.units[d.w]?.by, d.r.units[d.w]?.at)])];
    const blob = window.XLSXLite.build({ author: AUTHOR, footer: APP_NAME }, [{ name: '總覽', cols: [8, ...bs.map(() => 9)], rows: ov }, { name: '缺失清單', cols: [8, 12, 12, 22, 7, 40, 6, 13, 13, 16], rows: dl }, ...list.map(floorSheet)]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `水電清查_${onlyB ? `${onlyB}棟_` : ''}${today().replace(/-/g, '')}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`已匯出 Excel（${list.length} 層）`);
  }

  // 缺失改善單：只匯出勾選的項目，給工班填「改善完成日期」
  function exportFixSheet() {
    const list = selectedDefects();
    if (!list.length) return toast('請先勾選要給工班的項目');
    const head = v => ({ v, s: 'head' });
    const rows = [[{ v: `${settings.company}　缺失改善單`, s: 'title' }], [`工程名稱：${settings.project}`],
      [`開單日期：${today()}　開單人：${me()}　共 ${list.length} 項`], [],
      ['項次', '棟別', '戶號／區域', '工種', '項目', '狀態', '缺失／未做說明', '照片', '預定改善日期', '改善完成日期', '工班簽名／備註', '編號（請勿修改）'].map(head),
      ...list.map((d, i) => [{ v: i + 1, s: 'cell' }, { v: `${d.r.b} 棟`, s: 'cell' }, { v: label(d.r, d.w), s: 'cell' }, { v: CAT[d.k], s: 'cell' },
        { v: NAME[d.k], s: 'left' }, stCell(d.v), { v: d.note || '', s: 'wrap' }, { v: d.ph.length ? `${d.ph.length} 張` : '', s: 'cell' },
        { v: d.due || '', s: 'cell' }, { v: d.fixed ? d.at : '', s: 'cell' }, { v: '', s: 'wrap' }, { v: defKey(d), s: 'cell' }]),
      [], ['說明：改善完成後請填「改善完成日期」（例：2026/11/3）並簽名，拍照回傳；狀態 ✗ 缺失、△ 未完成。最後一欄「編號」請勿修改。']];
    const blob = window.XLSXLite.build({ author: AUTHOR, footer: APP_NAME }, [{ name: '缺失改善單', cols: [6, 7, 12, 11, 20, 6, 36, 7, 13, 13, 18, 14], rows, merges: ['A1:L1', 'A2:L2', 'A3:L3', `A${rows.length}:L${rows.length}`] }]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `缺失改善單_${today().replace(/-/g, '')}_${list.length}項.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`已匯出 ${list.length} 項缺失改善單`);
  }

  // 改善完成日期：Excel 日期（數字）、2026/11/3、2026-11-03、115/11/3（民國）、11/3（今年）都可以
  function toYmd(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
    const t = String(v || '').trim();
    let m = t.match(/(\d{2,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/);
    if (m) { let y = +m[1]; if (y < 1911) y += 1911; return `${y}-${pad(+m[2])}-${pad(+m[3])}`; }
    m = t.match(/^(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})日?$/);
    if (m) return `${new Date().getFullYear()}-${pad(+m[1])}-${pad(+m[2])}`;
    return '';
  }
  let pendingClose = [];
  async function importFixSheet(file) {
    let rows;
    try { rows = await window.XLSXRead.firstSheet(file); } catch (e) { return toast(e.message || '讀不到這個 Excel'); }
    const hi = rows.findIndex(r => r.some(c => String(c).startsWith('編號')) && r.some(c => String(c).includes('改善完成日期')));
    if (hi < 0) return toast('這不是新版的缺失改善單（找不到「編號」或「改善完成日期」欄），請重新匯出改善單給工班');
    const H = rows[hi], ci = name => H.findIndex(c => String(c).startsWith(name));
    const cKey = ci('編號'), cDone = ci('改善完成日期'), cNote = ci('工班簽名');
    const open = new Map(allDefects().map(d => [defKey(d), d]));
    const ok = [], skip = { noDate: 0, done: 0, missing: 0, bad: 0 };
    for (const r of rows.slice(hi + 1)) {
      const key = String(r[cKey] || '').trim(); if (!key) continue;
      const d = open.get(key);
      if (!d) { skip.missing++; continue; }
      if (d.fixed) { skip.done++; continue; }
      const raw = r[cDone];
      if (raw === '' || raw == null) { skip.noDate++; continue; }
      const date = toYmd(raw);
      if (!date) { skip.bad++; continue; }
      ok.push({ d, date, remark: cNote >= 0 ? String(r[cNote] || '').trim() : '' });
    }
    pendingClose = ok;
    const why = [skip.noDate && `${skip.noDate} 項沒填完成日期（不動）`, skip.done && `${skip.done} 項之前已結案`, skip.bad && `${skip.bad} 項日期看不懂（不動）`, skip.missing && `${skip.missing} 項在這支手機找不到`].filter(Boolean);
    $('#pv')?.remove();
    const m = document.createElement('div'); m.className = 'modal'; m.id = 'pv';
    m.innerHTML = `<div class="modal-in" role="dialog" aria-label="匯入改善單"><div class="modal-head"><b>匯入改善單：${ok.length ? `可以結案 ${ok.length} 項` : '沒有可以結案的項目'}</b>
      ${ok.length ? `<button class="btn pri" data-act="closeall">確定結案 ${ok.length} 項</button>` : ''}<button class="btn" data-act="close">${ok.length ? '取消' : '關閉'}</button></div>
      <div class="modal-body close-list">${why.length ? `<p class="muted">${why.join('；')}</p>` : ''}
      ${ok.map(x => `<div class="close-row"><b>${esc(x.d.r.b)}棟 ${esc(label(x.d.r, x.d.w))}</b> ${esc(NAME[x.d.k])} ${x.d.v} → ✓ <span class="muted">${esc(x.date)} 完成${x.remark ? `・${esc(x.remark)}` : ''}</span></div>`).join('')}</div></div>`;
    document.body.appendChild(m);
  }
  function closeAll() {
    const touched = new Set();
    for (const { d, date, remark } of pendingClose) {
      const r = d.r, b = box(r, d.w); b.s = { ...(b.s || {}), [d.k]: '✓' };
      if (remark) b.n = { ...(b.n || {}), [d.k]: `${b.n?.[d.k] ? `${b.n[d.k]}；` : ''}工班回覆：${remark}` };
      r.fx = { ...r.fx, [`${d.w}|${d.k}`]: date };
      r.log.unshift({ t: Date.now(), w: d.w, k: d.k, from: d.v, to: '✓', by: `${me()}（匯入改善單）` }); r.log.length = Math.min(r.log.length, 300);
      touch(r, d.w, d.k); touched.add(r);
    }
    touched.forEach(r => commit(r, true));
    const n = pendingClose.length; pendingClose = [];
    $('#pv')?.remove(); render(); toast(`已結案 ${n} 項`);
  }

  /* ---------- 照片：拍照存檔、放大看、刪除 ---------- */
  async function addPhoto(file, k) {
    const [, bd, fl] = parse(); if (!UNITS[bd]) return;
    const r = rec(bd, fl), w = ui.unit;
    try {
      toast('照片處理中…');
      const data = await shrinkPhoto(file);
      const id = `ph${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await putPhotos([{ id, floor: r.id, w, k, t: Date.now(), by: me(), data }]);
      const b = box(r, w);
      b.ph = { ...(b.ph || {}), [k]: [...(b.ph?.[k] || []), id] };
      touch(r, w, k); commit(r);
      toast('照片已存到手機');
    } catch (e) { toast(e.message || '照片儲存失敗'); }
  }
  async function openPhoto(pid) {
    const p = await getPhoto(pid).catch(() => null);
    if (!p) return toast('找不到這張照片');
    $('#phv')?.remove();
    const m = document.createElement('div'); m.className = 'modal'; m.id = 'phv';
    m.innerHTML = `<div class="modal-in" role="dialog" aria-label="照片"><div class="modal-head"><b>${esc(p.by || '')} ${stamp(p.t)}</b>
      <button class="btn" data-act="delphoto" data-aid="del:${esc(pid)}">刪除照片</button><button class="btn" data-act="closephoto">關閉</button></div>
      <div class="modal-body ph-body"><img src="${p.data}" alt="現場照片"></div></div>`;
    document.body.appendChild(m);
  }
  async function removePhoto(pid) {
    for (const r of floors.values()) {
      for (const [w, b] of [...Object.entries(r.units || {}), ['pub', r.pub]]) {
        for (const [k, ids] of Object.entries(b?.ph || {})) {
          if (!ids.includes(pid)) continue;
          b.ph = { ...b.ph, [k]: ids.filter(x => x !== pid) };
          touch(r, w, k); commit(r);
        }
      }
    }
    await deletePhoto(pid).catch(() => {});
    $('#phv')?.remove();
    toast('照片已刪除');
  }

  /* ---------- 備份 ---------- */
  async function exportBackup() {
    const photos = await allPhotos().catch(() => []);
    const data = { app: 'water-check', format: 1, author: AUTHOR, exportedAt: new Date().toISOString(), settings: { company: settings.company, project: settings.project }, floors: [...floors.values()], photos };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `水電清查備份_${today().replace(/-/g, '')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    ls.set('wc-lastBackup', String(Date.now()));
    toast(`已匯出 ${floors.size} 層的資料${photos.length ? `、${photos.length} 張照片` : ''}`);
    render();
  }
  const okId = id => /^[A-H]-(RF|B[12]|[1-9]F|1[0-4]F)$/.test(id);
  // 逐間合併：每一間、公共區域每一項各自比時間，較新的留下；不同人填同一層的不同間不會互相蓋掉
  function mergeFloor(mine, x) {
    const out = { ...mine, units: { ...mine.units }, pub: { ...mine.pub }, fx: { ...mine.fx, ...(x.fx || {}) } };
    let changed = 0;
    for (const [n, u] of Object.entries(x.units || {})) {
      if (!/^\d{1,2}$/.test(n) || !u || typeof u !== 'object') continue;
      const cur = mine.units[n];
      if (!cur || (u.at || x.updatedAt || 0) > (cur.at || mine.updatedAt || 0)) { out.units[n] = u; changed++; }
    }
    const xp = x.pub || {}, mp = mine.pub || {};
    const pick = { s: { ...(mp.s || {}) }, n: { ...(mp.n || {}) }, ph: { ...(mp.ph || {}) }, at: { ...(mp.at || {}) }, by: { ...(mp.by || {}) } };
    for (const it of pubItems(mine.f)) {
      const tx = xp.at?.[it.k] || (xp.s?.[it.k] ? x.updatedAt || 0 : 0), tm = mp.at?.[it.k] || (mp.s?.[it.k] ? mine.updatedAt || 0 : 0);
      if (tx > tm) { pick.s[it.k] = xp.s?.[it.k] || ''; pick.n[it.k] = xp.n?.[it.k] || ''; pick.ph[it.k] = xp.ph?.[it.k] || []; pick.at[it.k] = tx; pick.by[it.k] = xp.by?.[it.k] || ''; changed++; }
    }
    out.pub = pick;
    const seen = new Set((mine.log || []).map(l => `${l.t}|${l.w}|${l.k}`));
    out.log = [...(mine.log || []), ...(Array.isArray(x.log) ? x.log : []).filter(l => l && !seen.has(`${l.t}|${l.w}|${l.k}`))].sort((a, b) => b.t - a.t).slice(0, 300);
    if ((x.updatedAt || 0) > (mine.updatedAt || 0)) { out.date = x.date || out.date; out.inspector = x.inspector || out.inspector; }
    out.due = (x.updatedAt || 0) > (mine.updatedAt || 0) ? { ...(mine.due || {}), ...(x.due || {}) } : { ...(x.due || {}), ...(mine.due || {}) };
    out.printVer = Math.max(mine.printVer || 0, x.printVer || 0);
    out.updatedAt = Math.max(mine.updatedAt || 0, x.updatedAt || 0);
    return { out, changed };
  }
  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { return toast('讀不到這個檔案，請確認是水電清查的備份檔'); }
    if (!data || data.app !== 'water-check' || !Array.isArray(data.floors)) return toast('這不是水電清查的備份檔');
    const save = []; let units = 0, same = 0;
    for (const x of data.floors) {
      if (!x || !okId(x.id) || typeof x.units !== 'object') continue;
      const [b, f] = x.id.split('-');
      const { out, changed } = mergeFloor(rec(b, f), { ...x, b, f });
      if (changed) { save.push({ ...out, id: x.id, b, f }); units += changed; } else same++;
    }
    if (!save.length && !same) return toast('備份檔裡沒有樓層資料');
    // 照片：這台沒有的才存（同一張照片 id 相同）
    const okPhoto = x => x && typeof x.id === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(x.data || '');
    const newPhotos = Array.isArray(data.photos) ? data.photos.filter(okPhoto) : [];
    try {
      if (newPhotos.length) await putPhotos(newPhotos);
      if (save.length) await putAll(save);
      // 這台還沒確認過名稱（剛開始用、接手同事的資料）才帶入備份檔的公司、工地名稱
      if (!settings.confirmed && data.settings?.project) await saveSettings(data.settings);
    } catch (e) { return toast(e.message); }
    save.forEach(r => floors.set(r.id, r));
    render();
    toast(save.length ? `已合併 ${save.length} 層、${units} 筆較新的資料${newPhotos.length ? `、${newPhotos.length} 張照片` : ''}` : '備份檔裡沒有比這台更新的資料');
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-unit]');
    if (a) { ui.floor = a.getAttribute('href').replace('#/f/', '').replace('/', '-'); ui.unit = a.dataset.unit; return; }
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act, [, bd, fl] = parse();
    const r = ['st', 'type', 'fillok', 'reason'].includes(act) ? rec(bd, fl) : null;
    if (act === 'unit') {
      if (!b.dataset.u) return;
      ui.unit = b.dataset.u; render(); window.scrollTo(0, 0);
      document.querySelector('.chip[aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    } else if (act === 'st') setStatus(r, ui.unit, b.dataset.k, b.dataset.v);
    else if (act === 'type') { const d = box(r, ui.unit); d.type = d.type === b.dataset.v ? '' : b.dataset.v; touch(r, ui.unit); commit(r); }
    else if (act === 'reason') {
      // 快速原因：帶入備註（已經有寫的話接在後面），同一個原因不重複加
      const d = box(r, ui.unit), k = b.dataset.k, cur = d.n?.[k] || '', input = document.getElementById(`${ui.unit === 'pub' ? 'pn' : 'n' + ui.unit}-${k}`);
      const typed = input ? input.value.trim() : cur;
      const parts = typed ? typed.split('、') : [];
      if (!parts.includes(b.dataset.v)) parts.push(b.dataset.v);
      d.n = { ...(d.n || {}), [k]: parts.join('、') };
      touch(r, ui.unit, k); commit(r);
    } else if (act === 'fillok') {
      if (!arm(b.dataset.aid, b)) return;
      const d = box(r, ui.unit); d.s = d.s || {}; let c = 0;
      for (const it of UI) if (!d.s[it.k]) { d.s[it.k] = it.k === SOS && d.type !== '無障礙' ? '—' : '✓'; c++; }
      if (!c) return toast('這間都填好了');
      touch(r, ui.unit); commit(r); toast(`已填入 ${c} 項`);
    } else if (act === 'fix') {
      if (!arm(b.dataset.aid, b)) return;
      const [, id, w, k] = b.dataset.aid.split(':'), x = floors.get(id);
      if (x) { setStatus(x, w, k, '✓'); toast('已標記改善'); }
    } else if (act === 'togfix') { ui.showFixed = !ui.showFixed; render(); }
    else if (act === 'pdf') openPreview([rec(bd, fl)]);
    else if (act === 'pdfb') openPreview(ACTIVE.map(f => floors.get(fid(b.dataset.b, f))).filter(x => x && floorInfo(x).touched));
    else if (act === 'save') savePdf(b);
    else if (act === 'print') printPapers();
    else if (act === 'close') $('#pv')?.remove();
    else if (act === 'editset') { editingSettings = true; render(); window.scrollTo(0, 0); }
    else if (act === 'cancelset') { editingSettings = false; render(); }
    else if (act === 'export') exportBackup();
    else if (act === 'xlsx') exportXlsx(b.dataset.b);
    else if (act === 'photo') openPhoto(b.dataset.pid);
    else if (act === 'closephoto') $('#phv')?.remove();
    else if (act === 'delphoto') { if (arm(b.dataset.aid, b)) removePhoto(b.dataset.aid.slice(4)); }
    else if (act === 'selall') {
      const open = allDefects().filter(d => !d.fixed && (!ui.fb || d.r.b === ui.fb) && (!ui.fc || CAT[d.k] === ui.fc));
      const all = open.length && open.every(d => ui.sel.has(defKey(d)));
      open.forEach(d => (all ? ui.sel.delete(defKey(d)) : ui.sel.add(defKey(d))));
      render();
    } else if (act === 'line') shareLine();
    else if (act === 'copy') copyText();
    else if (act === 'fixsheet') exportFixSheet();
    else if (act === 'fiximport') $('#fixFile').click();
    else if (act === 'report') openReport();
    else if (act === 'closeall') closeAll();
    else if (act === 'install') { installEvt?.prompt(); installEvt?.userChoice.finally(() => { installEvt = null; render(); }); }
    else if (act === 'installhide') { ls.set('wc-install-hide', '1'); render(); }
    else if (act === 'import') $('#importFile').click();
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'importFile') { if (el.files[0]) importBackup(el.files[0]); el.value = ''; return; }
    if (el.id === 'fixFile') { if (el.files[0]) importFixSheet(el.files[0]); el.value = ''; return; }
    if (el.dataset?.photo) { if (el.files[0]) addPhoto(el.files[0], el.dataset.photo); el.value = ''; return; }
    if (el.dataset?.due) {
      const [id, w, k] = el.dataset.due.split('|'), r = floors.get(id);
      if (r) { r.due = { ...(r.due || {}), [`${w}|${k}`]: el.value }; commit(r); toast(el.value ? `預定 ${md(el.value)} 前改善` : '已清除預定日期'); }
      return;
    }
    if (el.classList?.contains('pick')) { el.checked ? ui.sel.add(el.dataset.key) : ui.sel.delete(el.dataset.key); render(); return; }
    if (el.dataset?.filter) { ui[el.dataset.filter] = el.value; render(); return; }
    const f = el.dataset?.f; if (!f) return;
    const [, bd, fl] = parse(); if (!UNITS[bd]) return;
    const r = rec(bd, fl), v = el.value.trim();
    if (f === 'date') r.date = v;
    else if (f === 'inspector') { r.inspector = v; ls.set('wc-inspector', v); }
    else if (f.startsWith('n:')) { const d = box(r, ui.unit), k = f.slice(2); d.n = { ...(d.n || {}), [k]: v }; touch(r, ui.unit, k); }
    commit(r, true);
  });
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'setup') return;
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get('me') || '').trim().slice(0, 20);
    if (!String(fd.get('company')).trim() || !String(fd.get('project')).trim() || !name) return toast('請填公司名稱、工地名稱和你的名字');
    try { await saveSettings({ company: fd.get('company'), project: fd.get('project') }); } catch (err) { return toast(err.message); }
    ls.set('wc-inspector', name);
    editingSettings = false;
    render(); toast('已儲存');
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#pv')?.remove(); $('#phv')?.remove(); } });
  window.addEventListener('hashchange', () => { $('#pv')?.remove(); $('#phv')?.remove(); render(); window.scrollTo(0, 0); });
  window.addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; render(); });

  /* ---------- 啟動 ---------- */
  (async () => {
    try {
      await loadSettings();
      (await loadAll()).forEach(r => floors.set(r.id, r));
    } catch (e) {
      $('#app').innerHTML = `<div class="empty"><b>無法啟動</b>${esc(e.message)}</div>`;
      return;
    }
    render();
  })();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
  // 請瀏覽器把這個網站的資料設為「不要自動清除」（Android Chrome 加到主畫面後通常會同意；iPhone 以加到主畫面為主）
  navigator.storage?.persist?.().catch(() => {});
})();
