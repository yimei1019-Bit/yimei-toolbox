/**
 * 自主檢查表離線版：資料存在裝置本身（瀏覽器 IndexedDB），不需伺服器、不需網路
 * 提供與主網站相同介面的 SK_STORE（見 web-prototype/js/selfcheck-store-server.js），
 * 另加 OFFLINE 物件管理「工地」（工程名稱）與備份匯出／匯入。
 *
 * 資料：
 *   forms 表：每份檢查表 { id, project, template, location, date, contractor, sub, timing, marks,
 *             notes, review, signs, version, createdAt, updatedAt }
 *   kv 表   ：projects（工地清單 [{id, name}]）、current（目前工地 id）、
 *             company（公司名稱，印在表頭，可空白）、customTemplates（使用者自己新增的範本 {C01: {...}}）、
 *             lastBackup（上次匯出備份的時間，用來提醒「超過 7 天沒備份」）
 * 新增工地時，自動為每份範本建立一份空白檢查表（與主網站相同）。
 * 自訂範本與內建範本一起使用；沒有越南文，切到越南文時顯示中文。
 */
(function () {
  const DB_NAME = 'selfcheck-offline';
  const BACKUP_APP = 'selfcheck-offline';
  const REMIND_DAYS = 7;
  let dbp = null;
  let tplCache = null; // 內建範本（data/templates.json）
  let custom = {};     // 自訂範本
  let company = '';

  /* ---------- IndexedDB 小工具 ---------- */
  function db() {
    dbp = dbp || new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('forms', { keyPath: 'id' }).createIndex('project', 'project');
        d.createObjectStore('kv', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('無法開啟裝置上的資料庫（可能是瀏覽器的無痕模式或儲存空間不足）'));
    });
    return dbp;
  }
  async function tx(stores, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then(r => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error('資料庫寫入失敗'));
      t.onabort = () => reject(t.error || new Error('資料庫寫入失敗（可能是儲存空間不足）'));
    });
  }
  const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const kvGet = async key => (await tx(['kv'], 'readonly', t => req(t.objectStore('kv').get(key))))?.value;
  const kvSet = (key, value) => tx(['kv'], 'readwrite', t => { t.objectStore('kv').put({ key, value }); });
  const newId = p => p + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4);
  const now = () => Math.floor(Date.now() / 1000);

  /* ---------- 範本（內建＋自訂） ---------- */
  async function templates() {
    if (!tplCache) {
      const res = await fetch('data/templates.json');
      if (!res.ok) throw new Error('無法讀取檢查表範本');
      tplCache = await res.json();
    }
    // 自訂範本用到新的工作類別時，接在內建類別後面
    const categories = [...tplCache.categories];
    Object.keys(custom).sort().forEach(id => { if (!categories.includes(custom[id].category)) categories.push(custom[id].category); });
    return { ...tplCache, categories, templates: { ...tplCache.templates, ...custom } };
  }

  const allForms = () => tx(['forms'], 'readonly', t => req(t.objectStore('forms').getAll()));
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  function cleanTemplate(t) {
    const title = str(t.title, 60);
    const category = str(t.category, 20);
    if (!title) throw new Error('請填寫檢查表名稱');
    if (!category) throw new Error('請填寫工作類別');
    const items = (Array.isArray(t.items) ? t.items : [])
      .map(it => [str(it && it[0], 200), str(it && it[1], 300)])
      .filter(([name]) => name);
    if (!items.length) throw new Error('至少要有一個檢查項目（空白的項目不會儲存）');
    if (items.length > 80) throw new Error('檢查項目最多 80 項');
    return { category, title, sub: str(t.sub, 60), items, custom: true };
  }
  // 新增（id 空白）或修改自訂範本；修改時舊表單的標記照項目順序保留
  async function saveTemplate(id, t) {
    const tpl = cleanTemplate(t);
    const all = (await templates()).templates;
    if (Object.entries(all).some(([k, x]) => k !== id && x.title === tpl.title)) {
      throw new Error(`已經有「${tpl.title}」這份檢查表，請換一個名稱`);
    }
    if (id && !custom[id]) throw new Error('內建範本不能修改，請用「複製」另存一份自訂範本');
    if (!id) {
      const n = Math.max(0, ...Object.keys(custom).map(k => parseInt(k.slice(1), 10) || 0)) + 1;
      id = 'C' + String(n).padStart(2, '0');
    }
    const n = tpl.items.length;
    const stale = (await allForms()).filter(f => f.template === id && f.marks.length !== n);
    custom = { ...custom, [id]: tpl };
    await tx(['forms', 'kv'], 'readwrite', t => {
      t.objectStore('kv').put({ key: 'customTemplates', value: custom });
      stale.forEach(f => {
        const marks = Array.from({ length: n }, (_, i) => f.marks[i] ?? null);
        const notes = Object.fromEntries(Object.entries(f.notes || {}).filter(([k]) => +k < n));
        t.objectStore('forms').put({ ...f, marks, notes });
      });
    });
    await fillMissing();
    return id;
  }
  async function deleteTemplate(id) {
    if (!custom[id]) throw new Error('內建範本不能刪除');
    const ids = (await allForms()).filter(f => f.template === id).map(f => f.id);
    const { [id]: _, ...rest } = custom;
    custom = rest;
    await tx(['forms', 'kv'], 'readwrite', t => {
      ids.forEach(fid => t.objectStore('forms').delete(fid));
      t.objectStore('kv').put({ key: 'customTemplates', value: custom });
    });
  }
  // 這份範本在所有工地已填寫過幾份（修改、刪除前提醒用）
  const templateUsage = async id => (await allForms()).filter(f => f.template === id && f.version > 0).length;

  function blankForm(project, tid, n, location = '') {
    const t = now();
    return {
      id: newId('L'), project, template: tid, location, date: '', contractor: '', sub: '', timing: [],
      marks: Array(n).fill(null), notes: {}, review: { status: null, date: '', title: '' }, signs: {},
      version: 0, createdAt: t, updatedAt: t,
    };
  }
  async function projectSet(project) {
    const tpl = (await templates()).templates;
    return Object.keys(tpl).sort().map(tid => blankForm(project, tid, tpl[tid].items.length));
  }

  /* ---------- 工地（工程名稱） ---------- */
  const DEFAULT_PROJECT = '我的工地'; // 第一次開啟時的暫用名稱，進入檢查表時會請使用者改成實際工地名稱
  let projects = [];
  let current = null;

  async function init() {
    custom = (await kvGet('customTemplates')) || {};
    company = (await kvGet('company')) || '';
    projects = (await kvGet('projects')) || [];
    current = await kvGet('current');
    if (!projects.length) await addProject(DEFAULT_PROJECT);
    if (!projects.some(p => p.id === current)) await setCurrent(projects[0].id);
    const all = await templates();
    const tpl = all.templates;
    // 範本調整（例如 2026-10-17 把 49 號併入 23 號）：依 migrations 把舊表單的標記搬到新位置
    for (const m of all.migrations || []) {
      const stale = (await allForms())
        .filter(f => f.template === m.template && f.marks.length === m.fromItems);
      if (!stale.length || !tpl[m.template]) continue;
      const n = tpl[m.template].items.length;
      await tx(['forms'], 'readwrite', t => stale.forEach(f => {
        const marks = Array(n).fill(null), notes = {};
        m.map.forEach((to, from) => {
          marks[to] = f.marks[from];
          if (f.notes && f.notes[from] != null) notes[to] = f.notes[from];
        });
        t.objectStore('forms').put({ ...f, marks, notes });
      }));
    }
    await fillMissing();
  }
  // 範本新增後（例如 46 號、自訂範本），每個工地補上該範本的空白表
  async function fillMissing() {
    const tpl = (await templates()).templates;
    for (const p of projects) {
      const have = new Set((await formsOf(p.id)).map(f => f.template));
      const missing = Object.keys(tpl).sort().filter(t => !have.has(t));
      if (missing.length) {
        await tx(['forms'], 'readwrite', t => missing.forEach(tid =>
          t.objectStore('forms').put(blankForm(p.id, tid, tpl[tid].items.length))));
      }
    }
  }
  const formsOf = project => tx(['forms'], 'readonly', t =>
    req(t.objectStore('forms').index('project').getAll(project)));

  function cleanName(name, exceptId) {
    name = String(name || '').trim();
    if (!name || name.length > 50) throw new Error('工地名稱需為 1～50 個字');
    if (projects.some(p => p.name === name && p.id !== exceptId)) throw new Error(`工地「${name}」已存在`);
    return name;
  }
  async function addProject(name) {
    const p = { id: newId('P'), name: cleanName(name) };
    const set = await projectSet(p.id);
    projects = [...projects, p];
    await tx(['forms', 'kv'], 'readwrite', t => {
      set.forEach(f => t.objectStore('forms').put(f));
      t.objectStore('kv').put({ key: 'projects', value: projects });
    });
    return p;
  }
  async function renameProject(id, name) {
    const n = cleanName(name, id);
    projects = projects.map(p => (p.id === id ? { ...p, name: n } : p));
    await kvSet('projects', projects);
  }
  async function deleteProject(id) {
    if (projects.length === 1) throw new Error('至少要保留一個工地');
    const ids = (await formsOf(id)).map(f => f.id);
    projects = projects.filter(p => p.id !== id);
    await tx(['forms', 'kv'], 'readwrite', t => {
      ids.forEach(fid => t.objectStore('forms').delete(fid));
      t.objectStore('kv').put({ key: 'projects', value: projects });
    });
    if (current === id) await setCurrent(projects[0].id);
  }
  async function setCurrent(id) { current = id; await kvSet('current', id); }
  const savedCount = async id => (await formsOf(id)).filter(f => f.version > 0).length;

  /* ---------- 備份 ---------- */
  async function exportBackup() {
    const forms = await allForms();
    return {
      app: BACKUP_APP, format: 1, exportedAt: new Date().toISOString(),
      projects, current, company, customTemplates: custom, forms,
    };
  }
  // 匯出檔案成功後呼叫，重新計算「幾天沒備份」
  const markBackedUp = () => kvSet('lastBackup', now());
  // 有填寫內容還沒備份、而且已經超過 7 天 → 回傳天數（never：從來沒備份過）；不用提醒時回傳 null
  async function backupDue() {
    const last = (await kvGet('lastBackup')) || 0;
    const pending = (await allForms()).filter(f => f.version > 0 && f.updatedAt > last);
    if (!pending.length) return null;
    const since = last || Math.min(...pending.map(f => f.updatedAt));
    const days = Math.floor((now() - since) / 86400);
    return days >= REMIND_DAYS ? { days, never: !last } : null;
  }
  // 合併匯入：同 id 的工地／表單／自訂範本以備份檔為準，其餘保留
  async function importBackup(data) {
    if (!data || data.app !== BACKUP_APP || !Array.isArray(data.projects) || !Array.isArray(data.forms)) {
      throw new Error('這不是自主檢查表離線版的備份檔');
    }
    const okForm = f => f && typeof f.id === 'string' && typeof f.project === 'string' && Array.isArray(f.marks);
    const forms = data.forms.filter(okForm);
    const byId = new Map(projects.map(p => [p.id, p]));
    data.projects.forEach(p => { if (p && p.id && p.name) byId.set(p.id, { id: p.id, name: String(p.name).slice(0, 50) }); });
    projects = [...byId.values()];
    const tpls = data.customTemplates && typeof data.customTemplates === 'object' ? data.customTemplates : {};
    Object.entries(tpls).forEach(([id, t]) => {
      if (!/^C\d+$/.test(id)) return;
      try { custom = { ...custom, [id]: cleanTemplate(t) }; } catch (e) {} // 格式不對的略過
    });
    if (!company && data.company) company = str(data.company, 40); // 這台還沒填公司名稱才帶入
    await tx(['forms', 'kv'], 'readwrite', t => {
      forms.forEach(f => t.objectStore('forms').put(f));
      t.objectStore('kv').put({ key: 'projects', value: projects });
      t.objectStore('kv').put({ key: 'customTemplates', value: custom });
      t.objectStore('kv').put({ key: 'company', value: company });
    });
    await init(); // 補齊缺少的範本
    return { projects: data.projects.length, forms: forms.length, templates: Object.keys(tpls).length };
  }
  async function setCompany(name) {
    company = str(name, 40);
    await kvSet('company', company);
  }

  /* ---------- 與主網站相同介面的 SK_STORE ---------- */
  window.SK_STORE = {
    templates,
    async listForms() {
      const tpl = (await templates()).templates;
      return (await formsOf(current))
        .filter(f => tpl[f.template]) // 已移除的範本（例如併入其他表）不顯示
        .map(({ signs, ...f }) => ({ ...f, signed: Object.keys(signs || {}) }));
    },
    async getForm(id) {
      const f = await tx(['forms'], 'readonly', t => req(t.objectStore('forms').get(id)));
      if (!f) throw new Error('找不到此檢查表，可能已被刪除');
      return f;
    },
    async saveForm(id, body) {
      const f = await this.getForm(id);
      if (!body.date) throw new Error('請填寫檢查日期');
      const fields = ['location', 'date', 'contractor', 'sub', 'timing', 'marks', 'notes', 'review', 'signs', 'extras'];
      fields.forEach(k => { f[k] = body[k]; });
      f.version += 1;
      f.updatedAt = now();
      await tx(['forms'], 'readwrite', t => { t.objectStore('forms').put(f); });
      return f;
    },
    async createForm({ template, location }) {
      const tpl = (await templates()).templates[template];
      if (!tpl) throw new Error('請選擇檢查表種類');
      const f = blankForm(current, template, tpl.items.length, String(location || '').trim().slice(0, 100));
      await tx(['forms'], 'readwrite', t => { t.objectStore('forms').put(f); });
      return f;
    },
    deleteForm: id => tx(['forms'], 'readwrite', t => { t.objectStore('forms').delete(id); }),
    canDelete: () => true,
    projectName: () => (projects.find(p => p.id === current) || {}).name || '',
    companyName: () => company,
  };

  // 外框（js/app-shell.js）用的資料介面；主網站的同一介面在 web-prototype/js/server-store.js
  window.APP_STORE = window.OFFLINE = {
    offline: true,
    can: () => true, // 離線版沒有登入，所有功能都可用
    init,
    projects: () => projects,
    DEFAULT_PROJECT,
    current: () => current,
    setCurrent, addProject, renameProject, deleteProject, savedCount,
    exportBackup, importBackup, markBackedUp, backupDue,
    company: () => company, setCompany,
    templates, customTemplates: () => custom, saveTemplate, deleteTemplate, templateUsage,
  };
})();
