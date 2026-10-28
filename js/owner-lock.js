/**
 * 自主檢查表只給管理者用：設定了管理者帳號（js/owner.js 的 OWNER_USER／OWNER_HASH）之後，
 * 沒在這台裝置登入過管理者的人，封面看不到「自主檢查表」，網址 #/self-check 也會被擋回封面。
 * 登入一次後記在這台裝置（localStorage），之後不用再輸入；封面下方可以「登出」。
 * 必須在 js/app-shell.js 之前載入，才能在外框開啟自主檢查表之前擋下。
 * 注意：網站與程式碼是公開的，這是「不讓別人隨手打開」的門鎖，不是加密；填寫的資料本來就只存在各自的裝置。
 */
(function () {
  const KEY = 'yimei-owner';
  const SALT = 'yimei-owner:'; // 要和 tools/set_owner_password.py 的 SALT 一樣
  const user = window.OWNER_USER || '';
  const hash = window.OWNER_HASH || '';
  const ls = { get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }, set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) {} } };
  const unlocked = () => !hash || ls.get() === hash;
  const isSelfCheck = () => /^#\/?self-check/.test(location.hash);
  window.OWNER = { isAdmin: () => !!hash && ls.get() === hash, user: () => (unlocked() && hash ? user : '') };

  // 沒登入就不讓外框開自主檢查表：開頁時直接換掉網址；之後的切換在外框之前攔下
  if (!unlocked() && isSelfCheck()) history.replaceState(null, '', location.pathname + location.search + '#/');
  window.addEventListener('hashchange', () => {
    if (unlocked() || !isSelfCheck()) return;
    history.replaceState(null, '', location.pathname + location.search + '#/');
    openDialog();
  });

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  let dlg = null;
  function openDialog(msg = '') {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'sk-dialog pj-dialog';
      document.body.appendChild(dlg);
      dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-x]')) dlg.close(); });
      dlg.addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target;
        if (hash && (await sha256(`${SALT}${f.user.value.trim()}:${f.pin.value}`)) === hash) {
          ls.set(hash);
          dlg.close();
          apply();
          location.hash = '#/self-check';
        } else openDialog('帳號或密碼不正確');
      });
    }
    dlg.innerHTML = `
      <form class="pj-box ol-setup">
        <div class="pj-head"><h3>🔒 管理者登入</h3><button class="sk-dlg-x" type="button" data-x aria-label="關閉">✕</button></div>
        <p class="pj-hint">自主檢查表只開放給管理者。登入一次後，這台裝置之後就不用再輸入。</p>
        <label class="pj-company">帳號<input name="user" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="40" required /></label>
        <label class="pj-company">密碼<input name="pin" type="password" autocomplete="current-password" maxlength="60" required /></label>
        <div class="pj-msg" ${msg ? '' : 'hidden'}>${msg}</div>
        <button class="sk-fill ol-setup-go" type="submit">登入</button>
      </form>`;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('input').focus();
  }

  // 封面：沒登入時藏起自主檢查表的磚，頁尾放「管理者登入」；登入後頁尾可以登出
  function apply() {
    const tile = document.getElementById('cvSelfCheck');
    const foot = document.getElementById('cvOwner');
    if (!tile || !foot) return;
    tile.hidden = !unlocked();
    foot.hidden = !hash;
    foot.textContent = unlocked() ? `👤 管理者 ${user}・登出` : '🔒 管理者登入';
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('#cvOwner')) return;
    if (unlocked()) { ls.set(''); apply(); } else openDialog();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
