/**
 * 自主檢查表：列印／PDF 用的 A4 版面（依公司 Word 範本的表格格式）
 *   SelfCheckPrint.paperHTML(form, tpl, ctx)  回傳 A4 頁面 HTML
 *     form：填寫內容（可用草稿，含未儲存的修改）
 *     tpl ：範本 { title, sub, items, vi: { title, sub, items } }
 *     ctx ：{ company, project, lang }   lang：'zh' 中文／'vi' 越南文／'bi' 中越對照
 *   SelfCheckPrint.fitOnePage(scope)          稍微超出一頁（15% 內）時等比例縮小成一頁，回傳比例
 *   SelfCheckPrint.print(paperEl)             只列印這張紙
 *   SelfCheckPrint.downloadPdf(contentEl, filename)  產生 PDF 檔下載（html2pdf.js，內建於 js/vendor）
 *
 * 公司名稱為專有名詞，各語言都顯示中文；使用者手填的內容（廠商、位置、實際檢查情形、
 * 其他檢查項目 form.extras）照原樣顯示，接在範本檢查項目之後。
 */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SYMBOL = { o: '○', x: '╳', '/': '／' };
  const box = on => (on ? '☑' : '□');
  const nl = s => esc(s).replace(/\n/g, '<br>');

  // 表單固定文字 [中文, 越南文]
  const L = {
    no: ['編號：', 'Số: '],
    project: ['工程名稱', 'Tên công trình'],
    sub: ['分項工程名稱', 'Tên hạng mục'],
    contractor: ['承攬廠商', 'Nhà thầu thi công'],
    subc: ['協力廠商', 'Nhà thầu phụ'],
    location: ['檢查位置', 'Vị trí kiểm tra'],
    date: ['檢查日期', 'Ngày kiểm tra'],
    timing: ['檢查時機', 'Thời điểm kiểm tra'],
    before: ['施工前', 'Trước thi công'],
    during: ['施工中', 'Trong thi công'],
    after: ['施工完成', 'Sau khi hoàn thành'],
    result: ['檢查結果', 'Kết quả kiểm tra'],
    ok: ['檢查合格', 'Kiểm tra đạt'],
    ng: ['有缺失需改正', 'Có lỗi cần khắc phục'],
    na: ['無此檢查項目', 'Không có hạng mục này'],
    colItem: ['檢查項目', 'Nội dung kiểm tra'],
    colStd: ['管理標準', 'Tiêu chuẩn quản lý'],
    colActual: ['實際檢查結果<br>(量化檢查數據)', 'Kết quả kiểm tra thực tế<br>(số liệu định lượng)'],
    colResult: ['檢查結果', 'Kết quả'],
    review: ['缺失複查結果：', 'Kết quả kiểm tra lại lỗi:'],
    reviewDone: ['已完成改善（檢附改善前中後照片）', 'Đã khắc phục xong (kèm ảnh trước, trong và sau khi khắc phục)'],
    reviewPending: ['未完成改善，填具「缺失改善追蹤表」進行追蹤改善', 'Chưa khắc phục xong, lập "Phiếu theo dõi khắc phục lỗi" để theo dõi khắc phục'],
    reviewDate: ['複查日期：', 'Ngày kiểm tra lại: '],
    reviewTitle: ['複查人員職稱：', 'Chức danh người kiểm tra lại: '],
    sign: ['簽名：', 'Chữ ký: '],
    remarks: ['備註：', 'Ghi chú:'],
    r1: ['1.檢查結果合格者註明「○」，不合格者註明「╳」，如無需檢查之項目則打「/」。',
         '1. Kết quả kiểm tra đạt ghi "○", không đạt ghi "╳", hạng mục không cần kiểm tra ghi "/".'],
    r2: ['2.檢查標準及實際檢查情形應依設計圖說、規範及實際檢查情形，具體敘述量化之數值及單位。',
         '2. Tiêu chuẩn kiểm tra và tình trạng kiểm tra thực tế phải căn cứ theo bản vẽ thiết kế, quy chuẩn và tình hình thực tế, ghi rõ trị số định lượng và đơn vị.'],
    r3: ['3.本表由工地現場施工人員實地檢查後覈實記載簽認。',
         '3. Phiếu này do nhân viên thi công tại hiện trường kiểm tra thực tế, ghi chép đúng sự thật và ký xác nhận.'],
    signManager: ['工地負責人(或工地主任)簽名：', 'Chữ ký người phụ trách công trường (hoặc chỉ huy trưởng): '],
    signWorker: ['現場施工人員（檢查人員）簽名：', 'Chữ ký nhân viên thi công hiện trường (người kiểm tra): '],
  };

  function paperHTML(form, tpl, ctx) {
    const lang = ctx.lang || 'zh';
    const vi = tpl.vi || tpl;
    // 依列印語言輸出文字；中越對照時越南文放在中文下方（小字）
    const pick = (zh, v, html = false) => {
      const z = html ? zh : esc(zh);
      const w = html ? v : esc(v);
      if (lang === 'zh') return z;
      if (lang === 'vi') return w;
      return `${z}<span class="pp-vi">${w}</span>`;
    };
    const lb = (key, html = false) => pick(L[key][0], L[key][1], html);
    const multi = (zh, v) => pick(nl(zh), nl(v), true); // 多行文字（檢查項目、標準）

    function dateText(s) {
      if (!s) return lang === 'vi' ? 'ngày ____ tháng ____ năm ______' : '　　　年　　月　　日';
      const [y, m, d] = s.split('-').map(Number);
      return lang === 'vi' ? `ngày ${d} tháng ${m} năm ${y}` : `${y} 年 ${m} 月 ${d} 日`;
    }
    const sign = src => (src ? `<img class="pp-sign-img" src="${src}" alt="簽名">` : '<span class="pp-sign-blank"></span>');

    function itemRows() {
      const rows = [];
      const items = tpl.items;
      for (let i = 0; i < items.length; i++) {
        const [name, std] = items[i];
        const [vName, vStd] = vi.items[i] || items[i];
        // 連續同名項目 = Word 中合併的「檢查項目」儲存格
        let span = 1;
        if (i === 0 || items[i - 1][0] !== name) {
          while (i + span < items.length && items[i + span][0] === name) span++;
        } else {
          span = 0;
        }
        rows.push(`
          <tr class="pp-item">
            ${span ? `<td class="pp-name" rowspan="${span}">${multi(name, vName)}</td>` : ''}
            <td>${std || vStd ? multi(std, vStd) : ''}</td>
            <td>${nl(form.notes[i] || '')}</td>
            <td class="pp-mark">${SYMBOL[form.marks[i]] || ''}</td>
          </tr>`);
      }
      // 其他檢查項目（使用者自行填寫，對應 Word 範本最後的空白列）：內容照原樣顯示
      // 填表畫面為了方便輸入會補空白列，列印時略過完全空白的列
      const filled = x => [x.name, x.std, x.note].some(v => String(v || '').trim()) || x.mark;
      (form.extras || []).filter(filled).forEach(x => {
        rows.push(`
          <tr class="pp-item pp-extra">
            <td class="pp-name">${nl(x.name)}</td>
            <td>${nl(x.std)}</td>
            <td>${nl(x.note)}</td>
            <td class="pp-mark">${SYMBOL[x.mark] || ''}</td>
          </tr>`);
      });
      return rows.join('');
    }

    const rv = form.review || {};
    const company = (ctx.company || '').split('').join(' ');
    // .pp-fit：自動縮成一頁用的外框（見 fitOnePage）
    return `<div class="pp-fit">
      <div class="pp-content pp-lang-${lang}">
        <div class="pp-company">${esc(company)}</div>
        <div class="pp-title">${pick(tpl.title, vi.title)}</div>
        <div class="pp-no">${lb('no')}<span class="pp-no-line"></span></div>
        <table class="pp-table pp-info">
          <colgroup><col style="width:18%"><col style="width:32%"><col style="width:18%"><col style="width:32%"></colgroup>
          <tr><th>${lb('project')}</th><td colspan="3">${esc(ctx.project)}</td></tr>
          <tr><th>${lb('sub')}</th><td colspan="3">${pick(tpl.sub, vi.sub)}</td></tr>
          <tr><th>${lb('contractor')}</th><td>${esc(form.contractor)}</td><th>${lb('subc')}</th><td>${esc(form.sub)}</td></tr>
          <tr><th>${lb('location')}</th><td>${esc(form.location)}</td><th>${lb('date')}</th><td>${dateText(form.date)}</td></tr>
          <tr><th>${lb('timing')}</th><td colspan="3" class="pp-opts">
            ${['before', 'during', 'after'].map(v => `<span>${box(form.timing.includes(v))}${lb(v)}</span>`).join('')}
          </td></tr>
          <tr><th>${lb('result')}</th><td colspan="3" class="pp-opts">
            <span>○ ${lb('ok')}</span><span>╳ ${lb('ng')}</span><span>／ ${lb('na')}</span>
          </td></tr>
        </table>
        <table class="pp-table pp-items">
          <colgroup><col style="width:24%"><col style="width:34%"><col style="width:28%"><col style="width:14%"></colgroup>
          <tr class="pp-head"><th>${lb('colItem')}</th><th>${lb('colStd')}</th><th>${lb('colActual', true)}</th><th>${lb('colResult')}</th></tr>
          ${itemRows()}
          <tr class="pp-block"><td colspan="4">
            <div>${lb('review')}</div>
            <div>${box(rv.status === 'done')}${lb('reviewDone')}</div>
            <div>${box(rv.status === 'pending')}${lb('reviewPending')}</div>
            <div class="pp-review">
              <span>${lb('reviewDate')}${dateText(rv.date)}</span>
              <span>${lb('reviewTitle')}${esc(rv.title) || '　　　　　　'}</span>
              <span class="pp-review-sign">${lb('sign')}${sign(form.signs.review)}</span>
            </div>
          </td></tr>
          <tr class="pp-block"><td colspan="4">
            <div>${lb('remarks')}</div>
            <div>${lb('r1')}</div>
            <div>${lb('r2')}</div>
            <div>${lb('r3')}</div>
          </td></tr>
        </table>
        <div class="pp-signs">
          <div>${lb('signManager')}${sign(form.signs.manager)}</div>
          <div>${lb('signWorker')}${sign(form.signs.worker)}</div>
        </div>
      </div></div>`;
  }

  /* ---------- 自動縮成一頁 ---------- */
  // A4 扣掉上下邊界的可用高度（與 PDF 邊界 10/12mm、列印邊界 10mm 一致，取較嚴格者）
  const PAGE_MM = 275;
  const PX_PER_MM = 96 / 25.4;
  const MAX_SHRINK = 0.15; // 超出 15% 以內才縮小（最小約 87%），超出更多就照常分頁
  // 版面須已放進畫面且未被縮放（預覽的 zoom 要先還原）；回傳縮放比例，1 = 未縮小
  function fitOnePage(scope) {
    const wrap = scope.querySelector('.pp-fit');
    const c = wrap && wrap.querySelector('.pp-content');
    if (!c) return 1;
    c.style.transform = c.style.transformOrigin = c.style.marginLeft = '';
    wrap.style.height = wrap.style.overflow = '';
    const h = c.offsetHeight / PX_PER_MM;
    if (h <= PAGE_MM || h > PAGE_MM * (1 + MAX_SHRINK)) return 1;
    const s = (PAGE_MM - 1) / h; // 留 1mm 餘裕
    c.style.transformOrigin = 'top left';
    c.style.transform = `scale(${s.toFixed(4)})`;
    c.style.marginLeft = `${((c.offsetWidth / PX_PER_MM) * (1 - s)) / 2}mm`; // 縮小後置中
    wrap.style.height = `${h * s}mm`;
    wrap.style.overflow = 'hidden';
    return s;
  }

  // 列印：把紙張複製到 body 最外層，列印時隱藏其他所有內容
  function print(paperEl) {
    const root = document.createElement('div');
    root.id = 'skPrintRoot';
    root.innerHTML = paperEl.querySelector('.pp-fit').outerHTML; // 連同自動縮小的設定一起列印
    document.body.appendChild(root);
    document.body.classList.add('sk-printing');
    const done = () => {
      document.body.classList.remove('sk-printing');
      root.remove();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  }

  // PDF：需要時才載入 html2pdf.js（已內建在 js/vendor，不需網路；版本 0.10.1，來源 cdnjs，SRI 已核對）
  const HTML2PDF_URL = 'js/vendor/html2pdf.bundle.min.js';
  let loading = null;
  function loadHtml2pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    loading = loading || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HTML2PDF_URL;
      s.onload = () => resolve(window.html2pdf);
      s.onerror = () => { loading = null; reject(new Error('無法載入 PDF 元件。可改按「列印」，在列印視窗選「另存為 PDF」。')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  async function downloadPdf(contentEl, filename) {
    const html2pdf = await loadHtml2pdf();
    await html2pdf().set({
      margin: [10, 10, 12, 10],
      filename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.pp-signs'] },
    }).from(contentEl).save();
  }

  window.SelfCheckPrint = { paperHTML, fitOnePage, print, downloadPdf };
})();
