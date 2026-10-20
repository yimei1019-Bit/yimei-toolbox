/**
 * 自主檢查表（版面參考品質查驗分頁）
 * 上：標題＋語言切換＋新增檢查表　中：工作類別篩選標籤　下：檢查表清單
 * 點「填表」→ 開啟填表視窗：承攬／協力廠商、檢查位置／日期、檢查時機、逐項標記 ○合格 ✕不合格 ／不適用、
 *              缺失複查、備註、手寫簽名
 *
 * 表單狀態判斷：
 *   全部已標記 → 完成
 *   部分已標記 → 進行中
 *   都沒標記   → 未填
 *
 * 資料存在後端（server/templates.json、server/selfcheck.json），透過 /api/selfcheck/* 讀寫。
 * 檢查表依專案分開：只顯示上方選單目前專案的表單，新增的表單也歸在目前專案。
 * 填表在草稿上進行，按「儲存」才送到後端；按 ✕ 關閉則放棄修改。
 * 「清空重填」也只清草稿，按「儲存」後才生效。
 * 儲存時帶 version，若別人已先存過會被後端擋下（409），避免互相覆蓋。
 *
 * 語言：「中文｜Tiếng Việt」只切換顯示，表單資料是同一份。
 *   介面文字在下方 UI；檢查項目的越南文在 templates.json 每份範本的 vi 欄位。
 *   伺服器回傳的錯誤訊息維持中文。
 */
(function () {
  const LANG_KEY = 'sk-lang';
  const PRINT_LANG_KEY = 'sk-print-lang';
  const store = {
    get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const state = {
    trade: 'all', openId: null, draft: null, tpl: null, forms: [], error: null,
    lang: store.get(LANG_KEY, 'zh') === 'vi' ? 'vi' : 'zh',
  };

  /* ---------- 介面文字（中／越） ---------- */
  const UI = {
    zh: {
      title: '自主檢查表', projectHint: '目前專案（在上方選單切換）', newForm: '＋ 增加既有檢查表',
      all: '全部', colCat: '類別', colItem: '檢查項目', colLoc: '位置', colDate: '日期', colStatus: '狀態',
      fill: '✎ 填表', fails: n => `${n} 項不合格`, empty: '沒有符合條件的檢查表', loading: '載入中…',
      loadFail: m => `無法載入檢查表：${m}`, openFail: m => `無法開啟檢查表：${m}`,
      done: '完成', doing: '進行中', todo: '未填',
      pass: '合格', fail: '不合格', na: '不適用',
      before: '施工前', during: '施工中', after: '施工完成',
      newTitle: '增加既有檢查表', formType: '檢查表種類', location: '檢查位置', locEg: '例如：2F、B1 東側、全區',
      cancel: '取消', create: '建立並開始填寫',
      close: '關閉（不儲存）', noLoc: '未填位置', marked: (a, b) => `已標記 ${a}/${b} 項`,
      preview: '👁 預覽／列印', save: '💾 儲存', saving: '儲存中…',
      contractor: '承攬廠商', contractorPh: '廠商名稱', sub: '協力廠商', subPh: '協力廠商（如有）',
      locPh: '例如：2F、B1 東側', date: '檢查日期', timing: '檢查時機', legend: '結果標記：',
      std: '規定標準：', notePh: '實際檢查情形（可空白）', itemAria: n => `第 ${n} 項結果`,
      review: '缺失複查結果', reviewDone: '已完成改善（檢附改善前中後照片）',
      reviewPending: '未完成改善，填具「缺失改善追蹤表」進行追蹤改善',
      reviewDate: '複查日期', reviewTitle: '複查人員職稱', reviewTitlePh: '職稱',
      remarks: '備註',
      remarkList: [
        '檢查結果合格者註明「○」，不合格者註明「╳」，如無需檢查之項目則打「/」。',
        '檢查標準及實際檢查情形應依設計圖說、規範及實際檢查情形，具體敘述量化之數值及單位。',
        '本表由工地現場施工人員實地檢查後覈實記載簽認。',
      ],
      signReview: '複查人員簽名', signManager: '工地負責人（或工地主任）簽名', signWorker: '現場施工人員（檢查人員）簽名',
      signPad: '（手寫簽名區）', signClear: '清除', signHint: '請在框內簽名',
      extraTitle: '其他檢查項目（自行填寫）', extraHint: '範本以外需要檢查的項目，空白的列不會儲存',
      extraName: '檢查項目', extraStd: '管理標準', extraAdd: '＋ 新增一列', extraDel: '刪除此列',
      reset: '↺ 清空重填', remove: '🗑 刪除這份檢查表',
      resetConfirm: '清空這份檢查表的所有填寫內容（標記、說明、複查結果、簽名）？\n\n按「儲存」後才會生效；不想清空可按 ✕ 關閉。',
      resetDone: '已清空，按「儲存」後生效',
      discardConfirm: '這份檢查表有尚未儲存的內容，確定要關閉嗎？\n\n要保留內容請按「取消」，再按「💾 儲存」。',
      removeConfirm: n => `確定刪除「${n}」？\n刪除後無法復原。`,
      pvBack: '← 返回填表', pvTitle: n => `預覽：${n}`, pvHint: '顯示目前填寫的內容（含尚未儲存的修改）',
      pvFit: p => `已自動縮小為 ${p}%，可印成一頁`,
      pvLang: '列印語言', print: '🖨 列印', pdf: '⬇ 下載 PDF', pdfBusy: '產生中…',
    },
    vi: {
      title: 'Phiếu tự kiểm tra', projectHint: 'Dự án hiện tại (đổi ở menu phía trên)', newForm: '＋ Thêm phiếu',
      all: 'Tất cả', colCat: 'Hạng mục', colItem: 'Phiếu kiểm tra', colLoc: 'Vị trí', colDate: 'Ngày', colStatus: 'Trạng thái',
      fill: '✎ Điền phiếu', fails: n => `${n} mục không đạt`, empty: 'Không có phiếu phù hợp', loading: 'Đang tải…',
      loadFail: m => `Không tải được phiếu: ${m}`, openFail: m => `Không mở được phiếu: ${m}`,
      done: 'Hoàn thành', doing: 'Đang thực hiện', todo: 'Chưa điền',
      pass: 'Đạt', fail: 'Không đạt', na: 'Không áp dụng',
      before: 'Trước thi công', during: 'Trong thi công', after: 'Sau khi hoàn thành',
      newTitle: 'Thêm phiếu kiểm tra', formType: 'Loại phiếu', location: 'Vị trí kiểm tra', locEg: 'VD: 2F, B1 phía Đông, toàn khu',
      cancel: 'Hủy', create: 'Tạo và bắt đầu điền',
      close: 'Đóng (không lưu)', noLoc: 'Chưa có vị trí', marked: (a, b) => `Đã đánh dấu ${a}/${b} mục`,
      preview: '👁 Xem trước / In', save: '💾 Lưu', saving: 'Đang lưu…',
      contractor: 'Nhà thầu thi công', contractorPh: 'Tên nhà thầu', sub: 'Nhà thầu phụ', subPh: 'Nhà thầu phụ (nếu có)',
      locPh: 'VD: 2F, B1 phía Đông', date: 'Ngày kiểm tra', timing: 'Thời điểm kiểm tra', legend: 'Ký hiệu kết quả:',
      std: 'Tiêu chuẩn: ', notePh: 'Tình trạng kiểm tra thực tế (có thể để trống)', itemAria: n => `Kết quả mục ${n}`,
      review: 'Kết quả kiểm tra lại lỗi', reviewDone: 'Đã khắc phục xong (kèm ảnh trước, trong và sau khi khắc phục)',
      reviewPending: 'Chưa khắc phục xong, lập "Phiếu theo dõi khắc phục lỗi" để theo dõi khắc phục',
      reviewDate: 'Ngày kiểm tra lại', reviewTitle: 'Chức danh người kiểm tra lại', reviewTitlePh: 'Chức danh',
      remarks: 'Ghi chú',
      remarkList: [
        'Kết quả kiểm tra đạt ghi "○", không đạt ghi "╳", hạng mục không cần kiểm tra ghi "/".',
        'Tiêu chuẩn kiểm tra và tình trạng kiểm tra thực tế phải căn cứ theo bản vẽ thiết kế, quy chuẩn và tình hình thực tế, ghi rõ trị số định lượng và đơn vị.',
        'Phiếu này do nhân viên thi công tại hiện trường kiểm tra thực tế, ghi chép đúng sự thật và ký xác nhận.',
      ],
      signReview: 'Chữ ký người kiểm tra lại', signManager: 'Chữ ký người phụ trách công trường (hoặc chỉ huy trưởng)',
      signWorker: 'Chữ ký nhân viên thi công hiện trường (người kiểm tra)',
      signPad: ' (khu vực ký tay)', signClear: 'Xóa', signHint: 'Vui lòng ký trong khung',
      extraTitle: 'Hạng mục kiểm tra khác (tự điền)', extraHint: 'Các hạng mục cần kiểm tra ngoài mẫu; dòng để trống sẽ không được lưu',
      extraName: 'Nội dung kiểm tra', extraStd: 'Tiêu chuẩn quản lý', extraAdd: '＋ Thêm dòng', extraDel: 'Xóa dòng này',
      reset: '↺ Xóa trắng, điền lại', remove: '🗑 Xóa phiếu này',
      resetConfirm: 'Xóa toàn bộ nội dung đã điền của phiếu này (đánh dấu, ghi chú, kết quả kiểm tra lại, chữ ký)?\n\nChỉ có hiệu lực sau khi nhấn "Lưu"; nếu không muốn xóa, nhấn ✕ để đóng.',
      resetDone: 'Đã xóa trắng, nhấn "Lưu" để áp dụng',
      discardConfirm: 'Phiếu này có nội dung chưa lưu, bạn có chắc muốn đóng không?\n\nĐể giữ lại nội dung, nhấn "Hủy" rồi nhấn "💾 Lưu".',
      removeConfirm: n => `Xác nhận xóa "${n}"?\nSau khi xóa không thể khôi phục.`,
      pvBack: '← Quay lại', pvTitle: n => `Xem trước: ${n}`, pvHint: 'Hiển thị nội dung đang điền (kể cả phần chưa lưu)',
      pvFit: p => `Đã tự động thu nhỏ còn ${p}% để in vừa một trang`,
      pvLang: 'Ngôn ngữ in', print: '🖨 In', pdf: '⬇ Tải PDF', pdfBusy: 'Đang tạo…',
    },
  };
  const T = key => UI[state.lang][key];
  const PRINT_LANGS = [['zh', '中文'], ['vi', 'Tiếng Việt'], ['bi', '中越對照 / Song ngữ']];

  const MARKS = [
    { v: 'o', sym: '○', key: 'pass' },
    { v: 'x', sym: '✕', key: 'fail' },
    { v: '/', sym: '／', key: 'na' },
  ];
  const TIMING = ['before', 'during', 'after'];
  const REVIEW = [['done', 'reviewDone'], ['pending', 'reviewPending']];
  const SIGNS = { review: 'signReview', manager: 'signManager', worker: 'signWorker' };

  // 資料來源：主網站用 js/server-store.js（伺服器），離線版用 offline-store.js（裝置本身）
  const store$ = () => window.SK_STORE;
  const isAdmin = () => store$().canDelete();
  const tplOf = f => state.tpl.templates[f.template];
  // 目前語言的範本內容（標題、分項、檢查項目）；沒有越南文時退回中文
  const tplText = f => (state.lang === 'vi' && tplOf(f).vi) || tplOf(f);
  const itemsOf = f => tplText(f).items;
  // 畫面上的中文名稱精簡：「自主檢查表」→「自檢表」、類別省略結尾「工程」（列印的表格仍用完整名稱）
  const shortTitle = t => (state.lang === 'zh' ? t.replace('自主檢查表', '自檢表') : t);
  const nameOf = f => shortTitle(tplText(f).title);
  // 清單只留工項名稱（例：放樣工程施工自主檢查表 → 放樣），讓手機一眼看到右側「填表」；填表視窗與列印仍用完整名稱
  const itemName = t => (state.lang === 'zh' ? t.replace(/(工程)?(施工)?(工程)?自主檢查表/, '') || t : t);
  const listName = f => itemName(tplText(f).title);
  const catLabel = c => (state.lang === 'vi'
    ? (state.tpl.viCategories && state.tpl.viCategories[c]) || c
    : c.replace(/工程$/, '') || c);
  const ymd = s => (s ? s.replace(/-/g, '/') : '—');
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // 從範本帶入表單名稱（中文）、類別；畫面顯示用 nameOf／catLabel 依語言轉換
  function decorate(f) {
    const t = tplOf(f);
    return { ...f, name: t.title, trade: t.category };
  }
  // 依工作類別 → 範本編號 → 建立時間排序，同一種表的多份會排在一起
  function sortForms() {
    const cat = state.tpl.categories;
    state.forms.sort((a, b) =>
      cat.indexOf(a.trade) - cat.indexOf(b.trade) ||
      a.template.localeCompare(b.template) ||
      a.createdAt - b.createdAt);
  }
  const forms = () => state.forms;

  const markedCount = f => f.marks.filter(Boolean).length;
  // 不合格數包含自行填寫的「其他檢查項目」；完成度只看範本項目
  const failCount = f => f.marks.filter(m => m === 'x').length + (f.extras || []).filter(x => x.mark === 'x').length;
  const EXTRA_ROWS = 3; // 與 Word 範本相同，預設 3 列空白
  const blankExtra = () => ({ name: '', std: '', mark: null, note: '' });
  const isBlankExtra = x => !x.name.trim() && !x.std.trim() && !x.mark && !x.note.trim();
  function statusOf(f) {
    const n = markedCount(f);
    if (n === 0) return 'todo';
    return n === f.marks.length ? 'done' : 'doing';
  }

  /* ---------- 標題 ---------- */
  function tabsHTML() {
    return `
      <div class="sk-tabs">
        <h1 class="sk-tab active">
          <span class="sk-tab-icon">🛡</span>${T('title')}<span class="sk-tab-count">（${forms().length}）</span>
        </h1>
        <span class="sk-project" title="${esc(T('projectHint'))}">${esc(store$().projectName())}</span>
        <div class="sk-lang" role="group" aria-label="語言 / Ngôn ngữ">
          <button class="${state.lang === 'zh' ? 'on' : ''}" data-lang="zh" aria-pressed="${state.lang === 'zh'}">中文</button>
          <button class="${state.lang === 'vi' ? 'on' : ''}" data-lang="vi" aria-pressed="${state.lang === 'vi'}" lang="vi">Tiếng Việt</button>
        </div>
        ${state.tpl ? `<div class="sk-new-btns">
          <button class="sk-fill sk-new-btn" data-act="new">${T('newForm')}</button>
          ${store$().toolbarHTML ? store$().toolbarHTML() : ''}
        </div>` : ''}
      </div>`;
  }

  /* ---------- 類別篩選標籤 ---------- */
  // 綠 ✓：該類別全部完成　藍 ●：有填寫中　灰：都還沒填
  function chipsHTML() {
    const all = forms();
    const chip = (key, label, list) => {
      let cls = 'todo', mark = '';
      if (key === 'all') cls = 'all';
      else if (list.every(f => statusOf(f) === 'done')) { cls = 'done'; mark = '✓'; }
      else if (list.some(f => statusOf(f) !== 'todo')) { cls = 'doing'; mark = '<i></i>'; }
      return `<button class="sk-chip sk-chip-${cls} ${state.trade === key ? 'active' : ''}" data-trade="${esc(key)}">${mark}${esc(label)}（${list.length}）</button>`;
    };
    return `
      <div class="sk-chips">
        ${chip('all', T('all'), all)}
        ${state.tpl.categories
          .map(t => [t, all.filter(f => f.trade === t)])
          .filter(([, list]) => list.length)
          .map(([t, list]) => chip(t, catLabel(t), list)).join('')}
      </div>`;
  }

  /* ---------- 清單 ---------- */
  function tableHTML() {
    const rows = forms().filter(f => state.trade === 'all' || f.trade === state.trade);
    return `
      <div class="sk-table-wrap">
        <table class="sk-table">
          <thead><tr><th>${T('colCat')}</th><th>${T('colItem')}</th><th>${T('colLoc')}</th><th>${T('colDate')}</th><th>${T('colStatus')}</th><th></th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(f => {
              const s = statusOf(f);
              const fails = failCount(f);
              return `
                <tr>
                  <td><span class="sk-trade">${esc(catLabel(f.trade))}</span></td>
                  <td class="sk-name" title="${esc(nameOf(f))}">${esc(listName(f))}${fails ? `<span class="sk-fail-tag">${T('fails')(fails)}</span>` : ''}${
                    f.location || f.date ? `<small class="sk-m-meta">${esc([f.location, f.date && ymd(f.date)].filter(Boolean).join('・'))}</small>` : ''}</td>
                  <td>${esc(f.location || '—')}</td>
                  <td>${ymd(f.date)}</td>
                  <td><span class="sk-status sk-status-${s}"><i></i>${T(s)}</span></td>
                  <td class="sk-act"><button class="sk-fill" data-form="${esc(f.id)}">${T('fill')}</button></td>
                </tr>`;
            }).join('') : `<tr><td colspan="6" class="sk-empty">${T('empty')}</td></tr>`}
          </tbody>
        </table>
      </div>`;
  }

  function bodyHTML() {
    if (state.error) return `<div class="sk-empty">${esc(state.error)}</div>`;
    if (!state.tpl) return `<div class="sk-empty">${T('loading')}</div>`;
    return chipsHTML() + tableHTML();
  }

  /* ---------- 新增檢查表視窗 ---------- */
  function newDialogHTML() {
    const { categories, templates } = state.tpl;
    const ids = Object.keys(templates).sort();
    const inCat = c => ids.filter(id => templates[id].category === c);
    // 預設選目前篩選類別的第一種表（「全部」時選第一個類別）
    const pick = inCat(state.trade)[0] || inCat(categories[0])[0];
    const title = id => itemName(tplText({ template: id }).title);
    return `
      <form class="sk-new" method="dialog">
        <h3>${T('newTitle')}</h3>
        <label>${T('formType')}
          <select name="template" required>
            ${categories.map(c => `
              <optgroup label="${esc(catLabel(c))}">
                ${inCat(c).map(id =>
                  `<option value="${id}" ${id === pick ? 'selected' : ''}>${esc(title(id))}</option>`).join('')}
              </optgroup>`).join('')}
          </select>
        </label>
        <label>${T('location')}<input name="location" placeholder="${esc(T('locEg'))}" maxlength="100" /></label>
        <div class="sk-new-msg" hidden></div>
        <div class="sk-new-actions">
          <button type="button" class="sk-btn" data-act="cancel">${T('cancel')}</button>
          <button type="submit" class="sk-btn sk-btn-primary">${T('create')}</button>
        </div>
      </form>`;
  }

  /* ---------- 填表視窗 ---------- */
  function signHTML(key) {
    const label = T(SIGNS[key]);
    return `
      <div class="sk-sign ${state.draft.signs[key] ? 'signed' : ''}">
        <div class="sk-sign-head">
          <span>${label}</span>
          <button type="button" class="sk-sign-clear" data-act="clear-sign" data-sign="${key}">${T('signClear')}</button>
        </div>
        <canvas class="sk-sign-pad" data-sign="${key}" aria-label="${esc(label + T('signPad'))}"></canvas>
        <div class="sk-sign-hint">${T('signHint')}</div>
      </div>`;
  }

  function footerHTML() {
    const rv = state.draft.review;
    return `
      <section class="sk-section">
        <h4>${T('review')}</h4>
        ${REVIEW.map(([v, key]) => `
          <label class="sk-check"><input type="radio" name="skReview" data-review="${v}" ${rv.status === v ? 'checked' : ''} />${esc(T(key))}</label>`).join('')}
        <div class="sk-review-grid">
          <label>${T('reviewDate')}<input type="date" data-review-field="date" value="${esc(rv.date)}" /></label>
          <label>${T('reviewTitle')}<input data-review-field="title" value="${esc(rv.title)}" placeholder="${esc(T('reviewTitlePh'))}" /></label>
        </div>
        ${signHTML('review')}
      </section>
      <section class="sk-section sk-remarks">
        <h4>${T('remarks')}</h4>
        <ol>${T('remarkList').map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      </section>
      <section class="sk-section sk-signs">
        ${signHTML('manager')}
        ${signHTML('worker')}
      </section>
      <div class="sk-dlg-danger">
        <button type="button" class="sk-btn" data-act="reset">${T('reset')}</button>
        ${isAdmin() ? `<button type="button" class="sk-btn sk-btn-danger" data-act="delete">${T('remove')}</button>` : ''}
      </div>`;
  }

  function dialogHTML() {
    const d = state.draft;
    const items = itemsOf(d);
    return `
      <div class="sk-dlg-head">
        <button class="sk-dlg-x" data-act="close" aria-label="${esc(T('close'))}">✕</button>
        <div class="sk-dlg-title">
          <h3>${esc(nameOf(d))}</h3>
          <div class="sk-dlg-meta">
            <span>${esc(catLabel(d.trade))}</span><span data-meta="location">${esc(d.location || T('noLoc'))}</span><span data-meta="date">${ymd(d.date)}</span>
            <b>${T('marked')(markedCount(d), items.length)}</b>
          </div>
          <div class="sk-dlg-msg" hidden></div>
        </div>
        <div class="sk-dlg-actions">
          <button class="sk-btn" data-act="preview">${T('preview')}</button>
          <button class="sk-btn sk-btn-primary" data-act="save">${T('save')}</button>
        </div>
      </div>
      <div class="sk-dlg-body">
        <div class="sk-info">
          <label>${T('contractor')}<input data-field="contractor" value="${esc(d.contractor)}" placeholder="${esc(T('contractorPh'))}" maxlength="100" /></label>
          <label>${T('sub')}<input data-field="sub" value="${esc(d.sub)}" placeholder="${esc(T('subPh'))}" maxlength="100" /></label>
          <label>${T('location')}<input data-field="location" value="${esc(d.location)}" placeholder="${esc(T('locPh'))}" maxlength="100" /></label>
          <label>${T('date')}<input type="date" data-field="date" value="${esc(d.date)}" required /></label>
          <div class="sk-timing">
            <div class="sk-info-label">${T('timing')}</div>
            ${TIMING.map(v => `
              <label class="sk-check"><input type="checkbox" data-timing="${v}" ${d.timing.includes(v) ? 'checked' : ''} />${T(v)}</label>`).join('')}
          </div>
        </div>
        <div class="sk-legend">${T('legend')}
          ${MARKS.map(m => `<span class="sk-legend-${m.v === '/' ? 'na' : m.v}">${m.sym} ${T(m.key)}</span>`).join('')}
        </div>
        <ol class="sk-items">
          ${items.map(([name, std], i) => {
            const m = d.marks[i];
            const cls = m === 'o' ? 'pass' : m === 'x' ? 'fail' : m === '/' ? 'na' : '';
            const cont = i > 0 && items[i - 1][0] === name; // 同一檢查項目的第 2 條以後標準（Word 合併儲存格）
            return `
              <li class="sk-item ${cls ? 'is-' + cls : ''} ${cont ? 'is-cont' : ''}">
                <div class="sk-item-main">
                  <div class="sk-item-text">
                    <div class="sk-item-name"><span class="sk-item-no">${i + 1}.</span>${esc(name)}</div>
                    ${std ? `<div class="sk-item-std">${T('std')}${esc(std)}</div>` : ''}
                  </div>
                  <div class="sk-marks" role="group" aria-label="${esc(T('itemAria')(i + 1))}">
                    ${MARKS.map(mk => `
                      <button class="sk-mark sk-mark-${mk.v === '/' ? 'na' : mk.v} ${m === mk.v ? 'on' : ''}" data-mark="${mk.v}" data-i="${i}"
                        aria-pressed="${m === mk.v}" title="${esc(T(mk.key))}">${mk.sym}</button>`).join('')}
                  </div>
                </div>
                <input class="sk-note" data-i="${i}" value="${esc(d.notes[i])}" placeholder="${esc(T('notePh'))}" maxlength="500" />
              </li>`;
          }).join('')}
        </ol>
        ${extrasHTML(items.length)}
        ${footerHTML()}
      </div>`;
  }

  /* ---------- 其他檢查項目（自行填寫，對應 Word 範本最後的空白列） ---------- */
  function extrasHTML(start) {
    const rows = state.draft.extras;
    return `
      <section class="sk-section sk-extras">
        <h4>${T('extraTitle')}</h4>
        <div class="sk-extras-hint">${T('extraHint')}</div>
        <ol class="sk-items">
          ${rows.map((x, j) => {
            const cls = x.mark === 'o' ? 'pass' : x.mark === 'x' ? 'fail' : x.mark === '/' ? 'na' : '';
            const no = start + j + 1;
            return `
              <li class="sk-item sk-extra ${cls ? 'is-' + cls : ''}">
                <div class="sk-item-main">
                  <span class="sk-item-no">${no}.</span>
                  <div class="sk-extra-fields">
                    <input data-xfield="name" data-xi="${j}" value="${esc(x.name)}" placeholder="${esc(T('extraName'))}" maxlength="200" />
                    <input data-xfield="std" data-xi="${j}" value="${esc(x.std)}" placeholder="${esc(T('extraStd'))}" maxlength="200" />
                  </div>
                  <div class="sk-marks" role="group" aria-label="${esc(T('itemAria')(no))}">
                    ${MARKS.map(mk => `
                      <button class="sk-mark sk-mark-${mk.v === '/' ? 'na' : mk.v} ${x.mark === mk.v ? 'on' : ''}" data-xmark="${mk.v}" data-xi="${j}"
                        aria-pressed="${x.mark === mk.v}" title="${esc(T(mk.key))}">${mk.sym}</button>`).join('')}
                  </div>
                </div>
                <div class="sk-extra-foot">
                  <input class="sk-note" data-xfield="note" data-xi="${j}" value="${esc(x.note)}" placeholder="${esc(T('notePh'))}" maxlength="500" />
                  <button type="button" class="sk-extra-del" data-act="extra-del" data-xi="${j}" title="${esc(T('extraDel'))}" aria-label="${esc(T('extraDel'))}">✕</button>
                </div>
              </li>`;
          }).join('')}
        </ol>
        <button type="button" class="sk-btn sk-extra-add" data-act="extra-add">${T('extraAdd')}</button>
      </section>`;
  }

  /* ---------- 預覽（A4 列印版面） ---------- */
  // 列印語言預設中文（交業主／監造用），每台裝置記住上次的選擇
  const printLang = () => {
    const v = store.get(PRINT_LANG_KEY, 'zh');
    return PRINT_LANGS.some(([k]) => k === v) ? v : 'zh';
  };
  function paperHTML() {
    const d = state.draft;
    return window.SelfCheckPrint.paperHTML(d, tplOf(d), {
      // 離線版的公司名稱由使用者自己填（可空白）；主網站用範本裡的公司名稱
      company: store$().companyName ? store$().companyName() : state.tpl.company,
      project: store$().projectName(),
      lang: printLang(),
    });
  }
  function previewHTML() {
    const d = state.draft;
    const pl = printLang();
    return `
      <div class="sk-pv-bar">
        <button class="sk-btn" data-pv="back">${T('pvBack')}</button>
        <div class="sk-pv-title">
          <b>${esc(T('pvTitle')(nameOf(d)))}</b>
          <span>${T('pvHint')}</span>
          <span class="sk-pv-fit" hidden></span>
        </div>
        <label class="sk-pv-lang">${T('pvLang')}
          <select data-pv-lang>
            ${PRINT_LANGS.map(([k, label]) => `<option value="${k}" ${k === pl ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <button class="sk-btn" data-pv="print">${T('print')}</button>
        <button class="sk-btn sk-btn-primary" data-pv="pdf">${T('pdf')}</button>
      </div>
      <div class="sk-pv-msg" hidden></div>
      <div class="sk-pv-wrap"><div class="sk-paper">${paperHTML()}</div></div>`;
  }
  // PDF 檔名：表單名稱_位置_日期[_語言].pdf（去掉檔名不允許的字元）
  function pdfName(d) {
    const suffix = { zh: '', vi: 'VI', bi: '中越對照' }[printLang()];
    const name = printLang() === 'vi' ? (tplOf(d).vi || tplOf(d)).title : d.name; // 自訂範本沒有越南文
    return [name, d.location, d.date, suffix].filter(Boolean).join('_').replace(/[\\/:*?"<>|]/g, '-') + '.pdf';
  }

  registerPage('self-check', {
    title: '自主檢查表',
    render() {
      // 每次顯示（含切換專案）都重新載入，避免短暫看到上一個專案的表單
      Object.assign(state, { tpl: null, forms: [], error: null, trade: 'all' });
      return `
        <div class="self-check ${state.lang === 'vi' ? 'sk-vi' : ''}" lang="${state.lang === 'vi' ? 'vi' : 'zh-Hant'}">
          <section class="sk-panel">
            <div id="skTabs">${tabsHTML()}</div>
            <div id="skBody">${bodyHTML()}</div>
          </section>
          <dialog class="sk-dialog" id="skDialog"></dialog>
          <dialog class="sk-dialog sk-new-dialog" id="skNew"></dialog>
          <dialog class="sk-preview" id="skPreview"></dialog>
        </div>`;
    },
    mount(el) {
      const tabsEl = el.querySelector('#skTabs');
      const bodyEl = el.querySelector('#skBody');
      const dlg = el.querySelector('#skDialog');
      const newDlg = el.querySelector('#skNew');
      const pvDlg = el.querySelector('#skPreview');

      const refresh = () => {
        tabsEl.innerHTML = tabsHTML();
        bodyEl.innerHTML = bodyHTML();
      };
      const renderDialog = () => {
        dlg.innerHTML = dialogHTML();
        if (dlg.open) setupPads();
      };
      // 保留捲動位置重畫（標記、清空時用）
      const rerenderKeepScroll = () => {
        const top = dlg.querySelector('.sk-dlg-body').scrollTop;
        renderDialog();
        dlg.querySelector('.sk-dlg-body').scrollTop = top;
      };
      /* --- 未儲存提醒：開啟時記下內容，關閉前比對 --- */
      // 只比對會儲存的欄位；空白說明、空白自填列不算修改
      function snapshot(d) {
        const notes = Object.fromEntries(Object.entries(d.notes || {}).filter(([, v]) => String(v).trim()));
        const extras = (d.extras || []).filter(x => !isBlankExtra(x));
        return JSON.stringify([d.location, d.date, d.contractor, d.sub, d.timing, d.marks, notes, d.review, d.signs, extras]);
      }
      let openedSnapshot = null;
      const isDirty = () => !!state.draft && snapshot(state.draft) !== openedSnapshot;
      // 關閉填表視窗：有未儲存內容時先詢問，避免誤觸就遺失（電腦版常見）
      function tryClose() {
        if (isDirty() && !confirm(T('discardConfirm'))) return;
        dlg.close();
      }
      // Esc 鍵：同樣先詢問
      dlg.addEventListener('cancel', e => {
        e.preventDefault();
        tryClose();
      });

      function showMsg(text) {
        const m = dlg.querySelector('.sk-dlg-msg');
        m.textContent = text;
        m.hidden = !text;
      }

      /* --- 載入範本與清單 --- */
      (async () => {
        try {
          const [tpl, list] = await Promise.all([
            store$().templates(),
            store$().listForms(),
          ]);
          state.tpl = tpl;
          state.forms = list.map(decorate);
          sortForms();
          state.error = null;
        } catch (e) {
          state.error = T('loadFail')(e.message);
        }
        refresh();
      })();

      /* --- 手寫簽名板：畫面重畫時依 draft.signs 的圖片還原 --- */
      function setupPads() {
        const dpr = window.devicePixelRatio || 1;
        dlg.querySelectorAll('.sk-sign-pad').forEach(cv => {
          const { width, height } = cv.getBoundingClientRect();
          cv.width = Math.round(width * dpr);
          cv.height = Math.round(height * dpr);
          const ctx = cv.getContext('2d');
          ctx.scale(dpr, dpr);
          ctx.lineWidth = 2.2;
          ctx.lineCap = ctx.lineJoin = 'round';
          ctx.strokeStyle = '#111827';
          const src = state.draft.signs[cv.dataset.sign];
          if (src) {
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0, width, height);
            img.src = src;
          }
        });
      }
      let stroke = null; // { cv, ctx, x, y, pointerId }
      const pos = (cv, e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      dlg.addEventListener('pointerdown', e => {
        const cv = e.target.closest('.sk-sign-pad');
        if (!cv) return;
        e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch (err) {} // 部分裝置／模擬輸入不支援，不影響簽名
        const [x, y] = pos(cv, e);
        const ctx = cv.getContext('2d');
        ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#111827'; ctx.fill();
        stroke = { cv, ctx, x, y, pointerId: e.pointerId };
      });
      dlg.addEventListener('pointermove', e => {
        if (!stroke || e.pointerId !== stroke.pointerId) return;
        const [x, y] = pos(stroke.cv, e);
        const { ctx } = stroke;
        ctx.beginPath(); ctx.moveTo(stroke.x, stroke.y); ctx.lineTo(x, y); ctx.stroke();
        stroke.x = x; stroke.y = y;
      });
      const endStroke = e => {
        if (!stroke || e.pointerId !== stroke.pointerId) return;
        const { cv } = stroke;
        if (state.draft) {
          state.draft.signs[cv.dataset.sign] = cv.toDataURL('image/png');
          cv.closest('.sk-sign').classList.add('signed');
        }
        stroke = null;
      };
      dlg.addEventListener('pointerup', endStroke);
      dlg.addEventListener('pointercancel', endStroke);

      /* --- 開啟／儲存／清空／刪除 --- */
      async function open(id) {
        let f;
        try {
          f = decorate(await store$().getForm(id));
        } catch (e) {
          alert(T('openFail')(e.message));
          return;
        }
        state.openId = id;
        state.draft = {
          ...f,
          marks: [...f.marks],
          notes: { ...f.notes },
          timing: [...f.timing],
          date: f.date || today(), // 新表單預設今天，可自行修改
          review: { status: null, date: '', title: '', ...f.review },
          // 已填的自填項目，不足 3 列補空白列（空白列儲存時會略過）
          extras: [...(f.extras || []).map(x => ({ ...blankExtra(), ...x })),
            ...Array.from({ length: Math.max(0, EXTRA_ROWS - (f.extras || []).length) }, blankExtra)],
          signs: { ...f.signs },
        };
        openedSnapshot = snapshot(state.draft);
        renderDialog();
        dlg.showModal();
        setupPads();
        dlg.querySelector('.sk-dlg-body').scrollTop = 0;
      }

      async function save(btn) {
        const d = state.draft;
        if (!d.date) {
          const input = dlg.querySelector('[data-field="date"]');
          input.reportValidity();
          input.focus();
          return;
        }
        btn.disabled = true;
        btn.textContent = T('saving');
        showMsg('');
        try {
          const body = {
            version: d.version, location: d.location, date: d.date,
            contractor: d.contractor, sub: d.sub, timing: d.timing,
            marks: d.marks, notes: d.notes, review: d.review, signs: d.signs,
            extras: d.extras.filter(x => !isBlankExtra(x))
              .map(x => ({ name: x.name.trim(), std: x.std.trim(), mark: x.mark, note: x.note.trim() })),
          };
          const saved = decorate(await store$().saveForm(d.id, body));
          const i = state.forms.findIndex(f => f.id === saved.id);
          const { signs, ...summary } = saved;
          state.forms[i] = { ...summary, signed: Object.keys(signs) };
          dlg.close();
          refresh(); // 直接更新清單，不只依賴 close 事件（背景分頁時瀏覽器可能延後觸發）
        } catch (e) {
          showMsg(e.message);
          btn.disabled = false;
          btn.textContent = T('save');
        }
      }

      function reset() {
        if (!confirm(T('resetConfirm'))) return;
        const d = state.draft;
        Object.assign(d, {
          contractor: '', sub: '', date: today(), timing: [],
          marks: d.marks.map(() => null), notes: {},
          extras: Array.from({ length: EXTRA_ROWS }, blankExtra),
          review: { status: null, date: '', title: '' }, signs: {},
        });
        renderDialog();
        dlg.querySelector('.sk-dlg-body').scrollTop = 0;
        showMsg(T('resetDone'));
      }

      async function remove() {
        const d = state.draft;
        if (!confirm(T('removeConfirm')(nameOf(d) + (d.location ? `（${d.location}）` : '')))) return;
        try {
          await store$().deleteForm(d.id);
          state.forms = state.forms.filter(f => f.id !== d.id);
          dlg.close();
          refresh();
        } catch (e) {
          showMsg(e.message);
        }
      }

      /* --- 預覽／列印／PDF --- */
      // 紙張固定 A4 寬，螢幕較窄時等比例縮小
      // 用 transform 縮小外觀而不是 CSS zoom：版面仍以原尺寸計算，
      // iPhone Safari 才不會把「看起來很小」的字自動放大（會造成字體不一、文字重疊）
      function fitPaper() {
        const wrap = pvDlg.querySelector('.sk-pv-wrap');
        const paper = pvDlg.querySelector('.sk-paper');
        if (!wrap || !paper) return;
        paper.style.transform = paper.style.transformOrigin = paper.style.marginLeft = paper.style.marginBottom = '';
        const avail = wrap.clientWidth - 24;
        const scale = Math.min(1, avail / paper.offsetWidth);
        if (scale >= 1) return;
        paper.style.transformOrigin = 'top left';
        paper.style.transform = `scale(${scale.toFixed(4)})`;
        paper.style.marginLeft = `${(wrap.clientWidth - paper.offsetWidth * scale) / 2 - 12}px`; // 置中（扣掉左右留白）
        paper.style.marginBottom = `${-paper.offsetHeight * (1 - scale)}px`;                   // 收回縮小後多出的空白
      }
      // 稍微超出一頁時自動縮成一頁（列印、PDF 都照這個版面），並在標題列顯示縮小比例
      function layoutPaper() {
        const paper = pvDlg.querySelector('.sk-paper');
        paper.style.transform = ''; // 量測前先還原螢幕縮放（offsetHeight 本來就不受 transform 影響，這裡只是保險）
        const s = window.SelfCheckPrint.fitOnePage(paper);
        const badge = pvDlg.querySelector('.sk-pv-fit');
        badge.textContent = s < 1 ? T('pvFit')(Math.round(s * 100)) : '';
        badge.hidden = s >= 1;
        fitPaper();
      }
      function openPreview() {
        pvDlg.innerHTML = previewHTML();
        pvDlg.showModal();
        layoutPaper();
      }
      window.addEventListener('resize', () => { if (pvDlg.open) fitPaper(); });
      pvDlg.addEventListener('change', e => {
        if (!e.target.matches('[data-pv-lang]')) return;
        store.set(PRINT_LANG_KEY, e.target.value);
        pvDlg.querySelector('.sk-paper').innerHTML = paperHTML();
        layoutPaper();
      });
      pvDlg.addEventListener('click', async e => {
        const b = e.target.closest('[data-pv]');
        if (!b) return;
        const msg = pvDlg.querySelector('.sk-pv-msg');
        msg.hidden = true;
        if (b.dataset.pv === 'back') pvDlg.close();
        if (b.dataset.pv === 'print') window.SelfCheckPrint.print(pvDlg.querySelector('.sk-paper'));
        if (b.dataset.pv === 'pdf') {
          b.disabled = true;
          b.textContent = T('pdfBusy');
          try {
            await window.SelfCheckPrint.downloadPdf(pvDlg.querySelector('.pp-fit'), pdfName(state.draft));
          } catch (err) {
            msg.textContent = err.message;
            msg.hidden = false;
          }
          b.disabled = false;
          b.textContent = T('pdf');
        }
      });

      /* --- 新增檢查表 --- */
      function openNew() {
        newDlg.innerHTML = newDialogHTML();
        newDlg.showModal();
        newDlg.querySelector('[name="location"]').focus();
      }
      newDlg.addEventListener('click', e => {
        if (e.target === newDlg || e.target.closest('[data-act="cancel"]')) newDlg.close();
      });
      newDlg.addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.target;
        const btn = form.querySelector('[type="submit"]');
        const msg = form.querySelector('.sk-new-msg');
        btn.disabled = true;
        try {
          const created = decorate(await store$().createForm({
            template: form.template.value, location: form.location.value,
          }));
          state.forms.push({ ...created, signed: [] });
          sortForms();
          newDlg.close();
          refresh();
          open(created.id);
        } catch (err) {
          msg.textContent = err.message;
          msg.hidden = false;
          btn.disabled = false;
        }
      });

      /* --- 事件 --- */
      el.querySelector('.self-check').addEventListener('click', e => {
        if (e.target.closest('dialog')) return;
        const lg = e.target.closest('[data-lang]');
        if (lg) {
          state.lang = lg.dataset.lang;
          store.set(LANG_KEY, state.lang);
          const root = el.querySelector('.self-check');
          root.classList.toggle('sk-vi', state.lang === 'vi'); // 越南文改用含越南字母的字型
          root.lang = state.lang === 'vi' ? 'vi' : 'zh-Hant';
          refresh();
          return;
        }
        if (e.target.closest('[data-act="new"]')) { openNew(); return; }
        const tr = e.target.closest('[data-trade]');
        if (tr) { state.trade = tr.dataset.trade; refresh(); return; }
        const fill = e.target.closest('[data-form]');
        if (fill) open(fill.dataset.form);
      });

      dlg.addEventListener('click', e => {
        if (e.target === dlg) return; // 點到視窗外不關閉（以前會直接關閉且不儲存，電腦版容易誤觸）
        const xm = e.target.closest('[data-xmark]');
        if (xm) {
          const x = state.draft.extras[+xm.dataset.xi];
          x.mark = x.mark === xm.dataset.xmark ? null : xm.dataset.xmark; // 再點一次取消
          rerenderKeepScroll();
          if (x.mark === 'x') dlg.querySelector(`.sk-note[data-xfield="note"][data-xi="${xm.dataset.xi}"]`).focus();
          return;
        }
        const mk = e.target.closest('[data-mark]');
        if (mk) {
          const i = +mk.dataset.i;
          const marks = state.draft.marks;
          marks[i] = marks[i] === mk.dataset.mark ? null : mk.dataset.mark; // 再點一次取消
          rerenderKeepScroll();
          if (marks[i] === 'x') dlg.querySelector(`.sk-note[data-i="${i}"]`).focus();
          return;
        }
        const act = e.target.closest('[data-act]');
        if (!act) return;
        const a = act.dataset.act;
        if (a === 'close') tryClose();
        if (a === 'save') save(act);
        if (a === 'preview') openPreview();
        if (a === 'reset') reset();
        if (a === 'delete') remove();
        if (a === 'extra-add') {
          state.draft.extras.push(blankExtra());
          rerenderKeepScroll();
          const inputs = dlg.querySelectorAll('[data-xfield="name"]');
          inputs[inputs.length - 1].focus();
        }
        if (a === 'extra-del') {
          state.draft.extras.splice(+act.dataset.xi, 1);
          if (!state.draft.extras.length) state.draft.extras.push(blankExtra()); // 至少留一列
          rerenderKeepScroll();
        }
        if (a === 'clear-sign') {
          const key = act.dataset.sign;
          delete state.draft.signs[key];
          const cv = dlg.querySelector(`.sk-sign-pad[data-sign="${key}"]`);
          cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
          cv.closest('.sk-sign').classList.remove('signed');
        }
      });

      dlg.addEventListener('input', e => {
        const t = e.target;
        const d = state.draft;
        if (t.dataset.xfield) d.extras[+t.dataset.xi][t.dataset.xfield] = t.value;
        else if (t.matches('.sk-note')) d.notes[t.dataset.i] = t.value;
        else if (t.dataset.field) {
          const f = t.dataset.field;
          d[f] = t.value;
          if (f === 'date') dlg.querySelector('[data-meta="date"]').textContent = ymd(t.value);
          if (f === 'location') dlg.querySelector('[data-meta="location"]').textContent = t.value || T('noLoc');
        }
        else if (t.dataset.review) d.review.status = t.dataset.review;
        else if (t.dataset.reviewField) d.review[t.dataset.reviewField] = t.value;
        else if (t.dataset.timing) {
          d.timing = TIMING.filter(v => v === t.dataset.timing ? t.checked : d.timing.includes(v));
        }
      });

      dlg.addEventListener('close', () => {
        if (dlg.open) return; // close 事件是非同步的；若已重新開啟另一份表單就不清除
        state.openId = null;
        state.draft = null;
        refresh();
      });
    },
  });
})();
