/**
 * 機電自檢紀錄表：外框邏輯（主網站與離線版共用，原始檔在 web-prototype/js/app-shell.js）
 * 資料來源 window.APP_STORE：離線版 offline-store.js（裝置本身）、主網站 js/server-store.js（伺服器）。
 * APP_STORE.can(功能) 決定按鈕是否顯示：manage（工地、公司名稱）、templates（自訂空白檢查表）、
 * backup（備份）、accounts（帳號管理）；離線版全部可用，主網站只有管理者可用。
 *   - 載入共用的自主檢查表畫面（PAGES['self-check']）；主網站另有帳號管理（PAGES.accounts）
 *   - 公司名稱（印在表頭，可空白）；工地（工程名稱）切換、新增／改名／刪除
 *   - 第一次進入檢查表先填工地名稱（取代暫用的「我的工地」）
 *   - 自訂範本：自己新增、修改、刪除整份檢查表（或複製現有範本再改）
 *   - 備份匯出（下載 .json）／匯入；有填寫內容超過 7 天沒備份時提醒
 *   - 離線版：註冊 Service Worker，讓第一次開啟後沒有網路也能使用
 *   - 主網站：右上角顯示登入者（帳號管理、登出）
 */
(function () {
  const content = document.getElementById('content');
  const sel = document.getElementById('olProject');
  const dlg = document.getElementById('olDialog');
  const fileInput = document.getElementById('olImportFile');
  const statusEl = document.getElementById('olStatus');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const O = window.APP_STORE;
  const can = key => !O.can || O.can(key);

  function showPage() {
    const page = window.PAGES['self-check'];
    content.innerHTML = page.render();
    page.mount(content);
    document.title = `自主檢查表｜${window.SK_STORE.projectName()}｜機電自檢紀錄表`;
  }
  function renderSelect() {
    sel.innerHTML = O.projects().map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    sel.value = O.current();
  }

  sel.addEventListener('change', async () => {
    await O.setCurrent(sel.value);
    showPage();
  });

  /* ---------- 工地管理 ---------- */
  function manageHTML(msg = '') {
    const list = O.projects();
    return `
      <div class="pj-box">
        <div class="pj-head">
          <h3>公司與工地</h3>
          <button class="sk-dlg-x" data-x aria-label="關閉">✕</button>
        </div>
        <form class="pj-company" data-company>
          <label for="olCompany">公司名稱（印在檢查表最上方，可空白）</label>
          <div class="pj-row">
            <input id="olCompany" name="company" value="${esc(O.company())}" placeholder="例如：○○營造有限公司" maxlength="40" />
            <button class="ac-save" type="submit">儲存</button>
          </div>
        </form>
        <form class="pj-company pj-locs" data-locations>
          <h4 class="pj-sub">檢查位置選項（${esc(O.projects().find(p => p.id === O.current()).name)}）</h4>
          <p class="pj-hint">填表時「檢查位置」會變成下拉選單，只能從這裡設定的選項挑。一行一個，例如：B1、1F、2F 機房、屋頂。</p>
          <textarea name="locations" rows="5" placeholder="B1&#10;1F&#10;2F&#10;屋頂">${esc(O.locationsOf().join('\n'))}</textarea>
          <button class="ac-save" type="submit">儲存位置選項</button>
        </form>
        ${shareHTML()}
        <h4 class="pj-sub">工地（工程名稱）</h4>
        <p class="pj-hint">工地名稱會印在檢查表的「工程名稱」。每個工地各有一整套檢查表。</p>
        <ul class="pj-list">
          ${list.map(p => `
            <li data-id="${esc(p.id)}">
              <input class="pj-input" value="${esc(p.name)}" maxlength="50" aria-label="工地名稱" />
              <button class="ac-save" data-rename hidden>儲存</button>
              <button class="ac-del" data-delete ${list.length === 1 ? 'disabled title="至少要保留一個工地"' : ''}>刪除</button>
            </li>`).join('')}
        </ul>
        <form class="pj-add" data-add>
          <input name="name" placeholder="新工地名稱，例如：○○大樓新建工程" maxlength="50" required />
          <button class="sk-fill" type="submit">＋ 新增工地</button>
        </form>
        <div class="pj-msg" ${msg ? '' : 'hidden'}>${esc(msg)}</div>
      </div>`;
  }
  // okMsg 可以是文字，或依 fn 的結果產生文字的函式
  // 同事共用：管理密碼＋匯出設定檔（同事匯入後只能填表）
  function shareHTML() {
    if (!O.exportSettings) return '';
    return `
      <div class="pj-share">
        <h4 class="pj-sub">👥 同事共用</h4>
        <p class="pj-hint">你是管理者。設定管理密碼後，按「匯出設定檔」用 LINE 傳給同事；同事在「💾 備份 → 匯入」選這個檔，
          就會拿到你的工地、位置選項、公司名稱和自訂檢查表，而且只能填表、不能改設定。之後新增檢查表，再匯出一次讓同事重新匯入即可。</p>
        <form class="pj-company" data-pin>
          <label for="olPin">${O.hasPin() ? '管理密碼（已設定 ✓，要改就輸入新密碼）' : '管理密碼（4～20 個字，請記住）'}</label>
          <div class="pj-row">
            <input id="olPin" name="pin" type="password" autocomplete="new-password" minlength="4" maxlength="20" required />
            <button class="ac-save" type="submit">${O.hasPin() ? '更改' : '設定'}</button>
          </div>
        </form>
        <button class="ol-btn pj-share-go" data-export-settings ${O.hasPin() ? '' : 'disabled title="請先設定管理密碼"'}>⬇ 匯出設定檔給同事</button>
      </div>`;
  }
  async function exportSettings() {
    const data = await O.exportSettings();
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `機電自檢設定檔_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return `已匯出設定檔（${data.projects.length} 個工地、${Object.keys(data.customTemplates).length} 份自訂檢查表），請傳給同事匯入`;
  }

  async function run(fn, okMsg) {
    let msg = okMsg;
    try {
      const r = await fn();
      if (typeof okMsg === 'function') msg = okMsg(r);
    } catch (e) { msg = e.message; }
    renderSelect();
    showPage();
    dlg.innerHTML = manageHTML(msg);
  }
  document.getElementById('olManage').addEventListener('click', () => {
    dlg.innerHTML = manageHTML();
    dlg.showModal();
  });

  /* ---------- 進入自主檢查表：先確認工地、公司名稱 ----------
   * 第一次使用：填自己的工地（取代暫用的「我的工地」，避免印出來工程名稱寫錯）
   * 之後每次從封面進來：帶入目前的工地與公司名稱，按一下「開始填表」就好，也可以換工地或新增工地 */
  const placeholder = () => O.projects().find(p => p.name === O.DEFAULT_PROJECT);
  function setupHTML(msg = '') {
    if (!placeholder()) return confirmHTML(msg);
    const others = O.projects().length > 1;
    return `
      <form class="pj-box ol-setup" data-setup>
        <div class="pj-head">
          <h3>開始使用：先填寫工地</h3>
          <button class="sk-dlg-x" type="button" data-x aria-label="關閉">✕</button>
        </div>
        <p class="pj-hint">工地名稱會印在每張檢查表的「工程名稱」，請先填好再開始填表。之後可以在右上角「✎ 工地」修改或新增其他工地。</p>
        <label class="pj-company">工地名稱（必填）
          <input name="name" placeholder="例如：○○大樓新建工程" maxlength="50" required autocomplete="off" />
        </label>
        <label class="pj-company">公司名稱（印在檢查表最上方，可空白）
          <input name="company" value="${esc(O.company())}" placeholder="例如：○○營造有限公司" maxlength="40" autocomplete="off" />
        </label>
        <div class="pj-msg" ${msg ? '' : 'hidden'}>${esc(msg)}</div>
        <button class="sk-fill ol-setup-go" type="submit">開始填表</button>
        ${others ? `<button class="ol-setup-skip" type="button" data-setup-del>不需要「${esc(O.DEFAULT_PROJECT)}」，直接刪除它</button>` : ''}
      </form>`;
  }
  function confirmHTML(msg = '') {
    const cur = O.current();
    return `
      <form class="pj-box ol-setup" data-setup>
        <div class="pj-head">
          <h3>今天在哪個工地？</h3>
          <button class="sk-dlg-x" type="button" data-x aria-label="關閉">✕</button>
        </div>
        <p class="pj-hint">工地名稱會印在檢查表的「工程名稱」，公司名稱印在最上方。確認沒錯就按「開始填表」。</p>
        <label class="pj-company">工地名稱
          <select name="site">
            ${O.projects().map(p => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            ${can('manage') ? '<option value="">＋ 新增工地…</option>' : ''}
          </select>
        </label>
        <label class="pj-company" data-newsite hidden>新工地名稱
          <input name="name" placeholder="例如：○○大樓新建工程" maxlength="50" autocomplete="off" />
        </label>
        <label class="pj-company">公司名稱（可空白）
          <input name="company" value="${esc(O.company())}" placeholder="例如：○○營造有限公司" maxlength="40" autocomplete="off" ${can('manage') ? '' : 'readonly title="由管理者設定"'} />
        </label>
        <div class="pj-msg" ${msg ? '' : 'hidden'}>${esc(msg)}</div>
        <button class="sk-fill ol-setup-go" type="submit">開始填表</button>
      </form>`;
  }
  // 選「＋ 新增工地…」才顯示新工地名稱欄位
  dlg.addEventListener('change', e => {
    if (!e.target.matches('[data-setup] select[name="site"]')) return;
    const box = dlg.querySelector('[data-newsite]');
    box.hidden = !!e.target.value;
    box.querySelector('input').required = !e.target.value;
    if (!e.target.value) box.querySelector('input').focus();
  });
  function openSetup() {
    dlg.innerHTML = setupHTML();
    dlg.dataset.mode = 'setup';
    if (!dlg.open) dlg.showModal();
  }
  async function finishSetup(fn) {
    try { await fn(); } catch (e) { dlg.innerHTML = setupHTML(e.message); return; }
    delete dlg.dataset.mode;
    dlg.close();
    renderSelect();
    showPage();
  }
  // 沒填工地就關掉：回封面，下次進檢查表會再問
  dlg.addEventListener('close', () => {
    if (dlg.dataset.mode !== 'setup') return;
    delete dlg.dataset.mode;
    if (placeholder()) location.hash = '#/';
  });

  /* ---------- 同事模式：輸入管理密碼解鎖 ---------- */
  function lockHTML(msg = '') {
    return `
      <form class="pj-box ol-setup" data-unlock>
        <div class="pj-head">
          <h3>🔒 同事模式</h3>
          <button class="sk-dlg-x" type="button" data-x aria-label="關閉">✕</button>
        </div>
        <p class="pj-hint">這支手機是用管理者的設定檔，只能填表、簽名、下載 PDF。檢查表種類、工地、位置選項由管理者設定；
          管理者更新後，重新匯入新的設定檔即可。</p>
        <label class="pj-company">管理密碼（管理者才需要）
          <input name="pin" type="password" autocomplete="current-password" maxlength="20" required />
        </label>
        <div class="pj-msg" ${msg ? '' : 'hidden'}>${esc(msg)}</div>
        <button class="sk-fill ol-setup-go" type="submit">解鎖管理功能</button>
      </form>`;
  }
  const lockBtn = document.getElementById('olLock');
  lockBtn.addEventListener('click', () => {
    dlg.innerHTML = lockHTML();
    dlg.showModal();
  });
  // 依這台裝置的身分顯示按鈕（管理者／同事模式），並重畫清單上方的按鈕
  function applyRole() {
    document.getElementById('olManage').hidden = !can('manage');
    document.getElementById('olBackup').hidden = !can('backup');
    lockBtn.hidden = !O.role || O.role() !== 'member';
  }

  /* ---------- 備份 ---------- */
  function backupHTML(msg = '') {
    return `
      <div class="pj-box ol-backup">
        <div class="pj-head">
          <h3>💾 備份</h3>
          <button class="sk-dlg-x" data-x aria-label="關閉">✕</button>
        </div>
        <p>檢查表只存在這台裝置。換手機、清除瀏覽器資料或裝置故障前，請先匯出備份檔，存到電腦或雲端硬碟。</p>
        <div class="ol-backup-actions">
          <button class="ol-btn" data-export>⬇ 匯出備份檔（所有工地與檢查表）</button>
          <button class="ol-btn" data-import>⬆ 匯入備份檔／管理者的設定檔</button>
        </div>
        <div class="ol-tip">匯入會「合併」資料：相同的工地與檢查表以備份檔內容為準，其他資料保留。</div>
        <div class="pj-msg" ${msg ? '' : 'hidden'}>${esc(msg)}</div>
      </div>`;
  }
  document.getElementById('olBackup').addEventListener('click', () => {
    dlg.innerHTML = backupHTML();
    dlg.showModal();
  });
  async function exportBackup() {
    const data = await O.exportBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `自主檢查表備份_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    await O.markBackedUp();
    checkRemind();
    return `已匯出 ${data.forms.filter(f => f.version > 0).length} 份已填寫的檢查表（共 ${data.projects.length} 個工地）`;
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let msg;
    try {
      const data = JSON.parse(await file.text());
      if (data && data.app === 'selfcheck-settings' && O.importSettings) {
        const r = await O.importSettings(data);
        msg = `已套用管理者的設定（${r.projects} 個工地、${r.templates} 份自訂檢查表）。這支手機現在是同事模式，只能填表。`;
        applyRole();
      } else {
        const r = await O.importBackup(data);
        msg = `已匯入 ${r.projects} 個工地、${r.forms} 份檢查表${r.templates ? `、${r.templates} 份自訂範本` : ''}`;
      }
      renderSelect();
      showPage();
    } catch (e) {
      msg = e instanceof SyntaxError ? '檔案格式不正確，無法讀取' : e.message;
    }
    dlg.innerHTML = backupHTML(msg);
    if (!dlg.open) dlg.showModal();
  });

  /* ---------- 視窗事件（工地管理與備份共用） ---------- */
  dlg.addEventListener('click', async e => {
    if (e.target === dlg || e.target.closest('[data-x]')) { dlg.close(); return; }
    if (e.target.closest('[data-export]')) { dlg.innerHTML = backupHTML(await exportBackup()); return; }
    if (e.target.closest('[data-import]')) { fileInput.click(); return; }
    if (e.target.closest('[data-export-settings]')) { run(() => exportSettings(), r => r); return; }
    if (e.target.closest('[data-setup-del]')) {
      const p = placeholder();
      const n = p ? await O.savedCount(p.id) : 0;
      if (n) { dlg.innerHTML = setupHTML(`「${O.DEFAULT_PROJECT}」已經有 ${n} 份填寫的檢查表，請改填工地名稱，或到「✎ 工地」刪除。`); return; }
      finishSetup(() => p && O.deleteProject(p.id));
      return;
    }
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const p = O.projects().find(x => x.id === li.dataset.id);
    if (e.target.closest('[data-rename]')) {
      const name = li.querySelector('.pj-input').value.trim();
      run(() => O.renameProject(p.id, name), `已改名為「${name}」`);
    }
    // 刪除要按兩次（第一次變成「確定刪除」）。不用瀏覽器的 confirm()：LINE 等 App 內建瀏覽器會擋掉，按了沒反應
    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) {
      if (!delBtn.dataset.sure) {
        dlg.querySelectorAll('[data-delete][data-sure]').forEach(b => { delete b.dataset.sure; b.textContent = '刪除'; });
        const n = await O.savedCount(p.id);
        delBtn.dataset.sure = '1';
        delBtn.textContent = '確定刪除';
        const msg = dlg.querySelector('.pj-msg');
        msg.textContent = `再按一次「確定刪除」就會刪除工地「${p.name}」。`
          + (n ? `⚠ 這個工地有 ${n} 份已填寫的檢查表，刪除後無法復原，建議先匯出備份。` : '');
        msg.hidden = false;
        return;
      }
      run(() => O.deleteProject(p.id), `已刪除「${p.name}」`);
    }
  });
  dlg.addEventListener('input', e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const p = O.projects().find(x => x.id === li.dataset.id);
    li.querySelector('[data-rename]').hidden = e.target.value.trim() === p.name;
  });
  dlg.addEventListener('keydown', e => {
    const li = e.target.closest('li[data-id]');
    if (li && e.key === 'Enter') { e.preventDefault(); li.querySelector('[data-rename]').click(); }
  });
  dlg.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.target.matches('[data-setup]')) {
      const name = e.target.name.value.trim();
      const co = e.target.company.value.trim();
      const site = e.target.site; // 確認模式才有工地選單
      finishSetup(async () => {
        const p = placeholder();
        if (site && site.value) await O.setCurrent(site.value);
        else await O.setCurrent(p ? (await O.renameProject(p.id, name), p.id) : (await O.addProject(name)).id);
        if (co !== O.company()) await O.setCompany(co);
      });
      return;
    }
    if (e.target.matches('[data-pin]')) {
      run(() => O.setPin(e.target.pin.value), '管理密碼已設定，現在可以匯出設定檔給同事');
      return;
    }
    if (e.target.matches('[data-unlock]')) {
      try {
        await O.unlock(e.target.pin.value);
      } catch (err) { dlg.innerHTML = lockHTML(err.message); return; }
      dlg.close();
      applyRole();
      showPage();
      return;
    }
    if (e.target.matches('[data-locations]')) {
      const list = e.target.locations.value.split('\n');
      run(() => O.setLocations(O.current(), list),
        saved => (saved.length ? `已儲存 ${saved.length} 個檢查位置選項` : '已清空檢查位置選項，填表時改回自行輸入'));
      return;
    }
    if (e.target.matches('[data-company]')) {
      const name = e.target.company.value.trim();
      run(() => O.setCompany(name), name ? `公司名稱已改為「${name}」` : '公司名稱已清空，表頭會留白');
      return;
    }
    const name = e.target.name.value.trim();
    run(async () => { const p = await O.addProject(name); await O.setCurrent(p.id); }, `已新增「${name}」`);
  });

  /* ---------- 超過 7 天沒備份提醒 ---------- */
  const remindEl = document.getElementById('olRemind');
  const backupBtn = document.getElementById('olBackup');
  let remindLater = false; // 按「稍後」：這次開啟不再跳出提醒列（備份按鈕仍顯示紅點）
  async function checkRemind() {
    let due = null;
    try { if (ready && can('backup')) due = await O.backupDue(); } catch (e) {}
    backupBtn.classList.toggle('ol-btn-alert', !!due);
    remindEl.hidden = !due || remindLater || location.hash !== '#/self-check';
    if (due) {
      document.getElementById('olRemindText').textContent = due.never
        ? `⚠ 檢查表已經填了 ${due.days} 天，還沒備份過。手機遺失或換手機會找不回來，建議匯出備份檔。`
        : `⚠ 已經 ${due.days} 天沒備份了，建議匯出備份檔，存到電腦或雲端硬碟。`;
    }
  }
  remindEl.addEventListener('click', e => {
    const b = e.target.closest('[data-remind]');
    if (!b) return;
    if (b.dataset.remind === 'backup') backupBtn.click();
    else { remindLater = true; remindEl.hidden = true; }
  });
  // 填表視窗關閉（可能剛儲存）時重新檢查；dialog 的 close 事件不會往上傳，要用捕獲階段
  content.addEventListener('close', () => checkRemind(), true);

  /* ---------- 自訂範本：自己新增整份檢查表 ---------- */
  const tpDlg = document.getElementById('olTpl');
  let ed = null;   // 編輯中的範本 { id（新增時空白）, category, title, sub, items: [[檢查項目, 管理標準]] }
  let edSnap = '';
  let cats = [];   // 工作類別（給輸入框的建議清單）
  const edDirty = () => !!ed && JSON.stringify(ed) !== edSnap;

  async function showList(msg = '') {
    ed = null;
    const all = await O.templates();
    const mine = O.customTemplates();
    const ids = Object.keys(mine).sort();
    const every = Object.keys(all.templates).sort();
    tpDlg.innerHTML = `
      <div class="tp-box">
        <div class="pj-head">
          <h3>📋 自訂空白檢查表</h3>
          <button class="sk-dlg-x" data-tp="close" aria-label="關閉">✕</button>
        </div>
        <p class="pj-hint">自己新增的範本會出現在每個工地的檢查表清單。內建範本不能改，可以「複製」一份再修改。</p>
        <h4 class="pj-sub">我的範本（${ids.length}）</h4>
        ${ids.length ? `<ul class="tp-list">${ids.map(id => `
          <li>
            <div><b>${esc(mine[id].title)}</b><small>${esc(mine[id].category)}・${mine[id].items.length} 項</small></div>
            <button class="ac-save" data-tp="edit" data-id="${id}">修改</button>
            <button class="ac-del" data-tp="delete" data-id="${id}">刪除</button>
          </li>`).join('')}</ul>` : '<div class="tp-empty">還沒有自訂範本</div>'}
        <button class="sk-fill tp-new" data-tp="new">＋ 新增空白範本</button>
        <div class="tp-copy">
          <label for="tpCopyFrom">或從現有範本複製一份再修改：</label>
          <div class="pj-row">
            <select id="tpCopyFrom">
              ${all.categories.map(c => `
                <optgroup label="${esc(c)}">
                  ${every.filter(id => all.templates[id].category === c)
                    .map(id => `<option value="${id}">${esc(all.templates[id].title)}</option>`).join('')}
                </optgroup>`).join('')}
            </select>
            <button class="ac-save" data-tp="copy">複製</button>
          </div>
        </div>
        <div class="pj-msg" ${msg ? '' : 'hidden'}>${esc(msg)}</div>
      </div>`;
  }

  function renderEditor(msg = '') {
    const box = tpDlg.querySelector('.tp-box');
    const top = box ? box.scrollTop : 0;
    tpDlg.innerHTML = `
      <div class="tp-box tp-edit">
        <div class="pj-head">
          <h3>${ed.id ? '修改範本' : '新增範本'}</h3>
          <button class="sk-dlg-x" data-tp="back" aria-label="返回範本清單">✕</button>
        </div>
        <div class="tp-fields">
          <label>工作類別
            <input data-ed="category" value="${esc(ed.category)}" list="tpCats" maxlength="20" placeholder="選現有的類別，或自己取新的" />
          </label>
          <datalist id="tpCats">${cats.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
          <label>檢查表名稱
            <input data-ed="title" value="${esc(ed.title)}" maxlength="60" placeholder="例如：屋頂防水施工自主檢查表" />
          </label>
          <label>分項工程名稱（印在表上，可空白）
            <input data-ed="sub" value="${esc(ed.sub)}" maxlength="60" placeholder="例如：防水工程" />
          </label>
        </div>
        <h4 class="pj-sub">檢查項目（${ed.items.length}）</h4>
        <p class="pj-hint">空白的項目不會儲存。同一個檢查項目有好幾條標準時，檢查項目填一樣的字，列印時會合併成一格。</p>
        <ol class="tp-items">
          ${ed.items.map(([name, std], i) => `
            <li>
              <span class="tp-no">${i + 1}.</span>
              <div class="tp-item-fields">
                <textarea data-it="0" data-i="${i}" rows="1" maxlength="200" placeholder="檢查項目">${esc(name)}</textarea>
                <textarea data-it="1" data-i="${i}" rows="2" maxlength="300" placeholder="管理標準（例如：誤差 5mm 以內）">${esc(std)}</textarea>
              </div>
              <div class="tp-item-btns">
                <button data-tp="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="往上移">↑</button>
                <button data-tp="down" data-i="${i}" ${i === ed.items.length - 1 ? 'disabled' : ''} aria-label="往下移">↓</button>
                <button data-tp="del-item" data-i="${i}" aria-label="刪除此項">✕</button>
              </div>
            </li>`).join('')}
        </ol>
        <button class="sk-btn" data-tp="add-item">＋ 新增一項</button>
        <div class="pj-msg" ${msg ? '' : 'hidden'}>${esc(msg)}</div>
        <div class="tp-actions">
          <button class="sk-btn" data-tp="back">取消</button>
          <button class="sk-btn sk-btn-primary" data-tp="save">💾 儲存範本</button>
        </div>
      </div>`;
    tpDlg.querySelector('.tp-box').scrollTop = top;
  }
  async function startEdit(id, src) {
    cats = (await O.templates()).categories;
    ed = { id, category: src.category, title: src.title, sub: src.sub || '', items: src.items.map(([n, s]) => [n, s || '']) };
    edSnap = JSON.stringify(ed);
    renderEditor();
    tpDlg.querySelector('.tp-box').scrollTop = 0;
    if (!ed.title) tpDlg.querySelector('[data-ed="category"]').focus();
  }
  function leaveEditor() {
    if (edDirty() && !confirm('範本還沒儲存，確定要離開嗎？\n\n要保留內容請按「取消」，再按「💾 儲存範本」。')) return;
    showList();
  }
  async function saveEditor(btn) {
    const changed = JSON.stringify(ed.items) !== JSON.stringify(JSON.parse(edSnap).items);
    if (ed.id && changed) {
      const n = await O.templateUsage(ed.id);
      if (n && !confirm(`已有 ${n} 份填寫過的「${JSON.parse(edSnap).title}」。\n\n舊紀錄的標記會照項目順序保留：刪掉或調換順序的話，舊的標記可能對到別的項目。建議先匯出備份。\n\n確定要儲存嗎？`)) return;
    }
    btn.disabled = true;
    try {
      await O.saveTemplate(ed.id, ed);
      const title = ed.title.trim();
      const isNew = !ed.id;
      showPage();
      await showList(isNew ? `已新增「${title}」，每個工地的檢查表清單都加上了這份` : `已儲存「${title}」`);
    } catch (e) {
      btn.disabled = false;
      renderEditor(e.message);
    }
  }

  // 按鈕放在檢查表清單上方「＋ 增加既有檢查表」旁邊（由共用畫面透過 SK_STORE.toolbarHTML 顯示）
  window.SK_STORE.toolbarHTML = () => !can('templates') ? '' :
    '<button class="sk-btn sk-tpl-btn" data-ol="templates" title="自己新增、修改檢查表範本（每個工地都會多一份）">📋 自訂空白檢查表</button>';
  content.addEventListener('click', async e => {
    if (!e.target.closest('[data-ol="templates"]')) return;
    await showList();
    tpDlg.showModal();
  });
  // Esc：編輯中先詢問；點視窗外面不關閉（避免誤觸遺失內容）
  tpDlg.addEventListener('cancel', e => {
    e.preventDefault();
    if (ed) leaveEditor(); else tpDlg.close();
  });
  tpDlg.addEventListener('click', async e => {
    const b = e.target.closest('[data-tp]');
    if (!b) return;
    const a = b.dataset.tp;
    const i = +b.dataset.i;
    const all = await O.templates();
    if (a === 'close') tpDlg.close();
    if (a === 'back') leaveEditor();
    if (a === 'new') startEdit('', { category: '', title: '', sub: '', items: [['', ''], ['', ''], ['', '']] });
    if (a === 'copy') {
      const t = all.templates[tpDlg.querySelector('#tpCopyFrom').value];
      startEdit('', { ...t, title: `${t.title}（自訂）` });
    }
    if (a === 'edit') startEdit(b.dataset.id, O.customTemplates()[b.dataset.id]);
    if (a === 'delete') {
      const t = O.customTemplates()[b.dataset.id];
      const n = await O.templateUsage(b.dataset.id);
      const warn = n
        ? `\n\n⚠ 已有 ${n} 份填寫過的「${t.title}」，會一起刪除且無法復原。建議先匯出備份。`
        : '\n\n各工地裡這份還沒填寫的空白表也會一起移除。';
      if (!confirm(`確定刪除範本「${t.title}」？${warn}`)) return;
      await O.deleteTemplate(b.dataset.id);
      showPage();
      showList(`已刪除「${t.title}」`);
    }
    if (a === 'save') saveEditor(b);
    if (a === 'add-item') {
      ed.items.push(['', '']);
      renderEditor();
      const boxes = tpDlg.querySelectorAll('[data-it="0"]');
      boxes[boxes.length - 1].focus();
    }
    if (a === 'del-item') {
      ed.items.splice(i, 1);
      if (!ed.items.length) ed.items.push(['', '']); // 至少留一項
      renderEditor();
    }
    if (a === 'up' || a === 'down') {
      const j = a === 'up' ? i - 1 : i + 1;
      [ed.items[i], ed.items[j]] = [ed.items[j], ed.items[i]];
      renderEditor();
    }
  });
  tpDlg.addEventListener('input', e => {
    const t = e.target;
    if (!ed) return;
    if (t.dataset.ed) ed[t.dataset.ed] = t.value;
    if (t.dataset.it) ed.items[+t.dataset.i][+t.dataset.it] = t.value;
  });

  /* ---------- 離線快取 ---------- */
  function setStatus(text) {
    statusEl.textContent = text;
    statusEl.hidden = !text;
  }
  if (O.offline && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      const ready = () => setStatus('✓ 可離線使用');
      if (reg.active) ready();
      navigator.serviceWorker.ready.then(ready);
    }).catch(() => setStatus(''));
  }

  /* ---------- 封面與工具切換（#/ 封面、#/self-check 自主檢查表、#/accounts 帳號管理；手機返回鍵可回封面） ---------- */
  const cover = document.getElementById('cover');
  const bar = document.getElementById('olBar');
  const titleEl = bar.querySelector('.ol-title');
  const PAGE_TITLE = { 'self-check': '自主檢查表', accounts: '帳號管理' };
  let shown = null; // 目前顯示的工具
  let ready = false; // 資料載入完成前，只能顯示封面
  function route() {
    const id = location.hash.replace(/^#\/?/, '');
    const tool = ready && window.PAGES[id] && (id === 'self-check' || can(id)) ? id : null;
    cover.hidden = !!tool;
    bar.hidden = !tool;
    content.hidden = !tool;
    bar.classList.toggle('ol-bar-page', !!tool && tool !== 'self-check'); // 帳號管理不需要工地選單
    const entering = tool === 'self-check' && shown !== 'self-check';
    if (tool && tool !== shown) {
      titleEl.textContent = PAGE_TITLE[tool] || '';
      if (tool === 'self-check') showPage();
      else {
        content.innerHTML = window.PAGES[tool].render();
        window.PAGES[tool].mount(content);
        document.title = `${PAGE_TITLE[tool]}｜機電自檢紀錄表`;
      }
    }
    shown = tool;
    checkRemind();
    if (tool === 'self-check' && (entering || placeholder()) && !dlg.open) openSetup();
    if (!tool) document.title = '機電自檢紀錄表';
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ---------- 登入者（主網站）：帳號管理、登出 ---------- */
  const userBtn = document.getElementById('olUser');
  if (userBtn && O.user) {
    const u = O.user();
    userBtn.hidden = false;
    userBtn.textContent = `👤 ${u.name}`;
    userBtn.title = `${u.name}（${u.roleLabel}）`;
    userBtn.addEventListener('click', () => {
      dlg.innerHTML = `
        <div class="pj-box ol-user">
          <div class="pj-head">
            <h3>👤 ${esc(u.name)}</h3>
            <button class="sk-dlg-x" data-x aria-label="關閉">✕</button>
          </div>
          <p class="pj-hint">帳號：${esc(u.username)}　${esc(u.roleLabel)}${u.title ? `・${esc(u.title)}` : ''}</p>
          ${can('accounts') ? '<a class="ol-btn" href="#/accounts" data-x>👥 帳號管理</a>' : ''}
          <button class="ol-btn" data-logout>登出</button>
        </div>`;
      dlg.showModal();
    });
    dlg.addEventListener('click', async e => {
      if (!e.target.closest('[data-logout]')) return;
      await O.logout();
      location.hash = '';
      location.reload();
    });
  }
  // 沒有權限的按鈕不顯示（主網站一般使用者、離線版同事模式只能填表）；資料載入後再依身分更新一次
  applyRole();

  /* ---------- 封面「最新更新」（data/updates.json 由 更新紀錄.md 產生） ---------- */
  const SEEN_KEY = 'ol-seen-update';
  async function renderNews() {
    let list;
    try { list = await (await fetch('data/updates.json')).json(); } catch (e) { return; }
    if (!Array.isArray(list) || !list.length) return;
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch (e) {}
    const block = u => `
      <div class="cv-news-day">
        <div class="cv-news-date">${esc(u.date)}${seen && u.date > seen ? '<span class="cv-new">NEW</span>' : ''}</div>
        <ul>${u.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
      </div>`;
    const listEl = document.getElementById('cvNewsList');
    const more = document.getElementById('cvNewsMore');
    listEl.innerHTML = list.slice(0, 1).map(block).join('');
    more.hidden = list.length <= 1;
    more.onclick = () => { listEl.innerHTML = list.map(block).join(''); more.hidden = true; };
    document.getElementById('cvNews').hidden = false;
    try { localStorage.setItem(SEEN_KEY, list[0].date); } catch (e) {} // 下次開啟只標示更新的日期
  }

  /* ---------- 啟動 ---------- */
  // 封面不需要資料庫，先顯示；資料庫載入完成後才可進入工具（或直接回到原本開著的工具）
  route();
  renderNews();
  (async () => {
    try {
      await O.init();
      applyRole();
      renderSelect();
      ready = true;
      route();
    } catch (e) {
      cover.hidden = true;
      content.hidden = false;
      content.innerHTML = `<div class="sk-empty">無法啟動：${esc(e.message)}</div>`;
    }
  })();
})();
