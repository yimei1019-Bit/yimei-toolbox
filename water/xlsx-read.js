/**
 * 讀 Excel（.xlsx）的第一張工作表，不需要外部套件。
 *   XLSXRead.firstSheet(file) → Promise<[[儲存格文字或數字...]...]>（依列、欄排好，空格是 ''）
 * Excel、Google 試算表存的 .xlsx 都是壓縮過的 zip，用瀏覽器內建的 DecompressionStream 解壓
 * （iPhone 需 iOS 16.4 以上、Android Chrome 80 以上）。
 */
(function () {
  'use strict';
  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('這支手機的瀏覽器太舊，無法讀 Excel；請更新系統或改用電腦');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // 從 zip 的中央目錄找出每個檔案（有些程式寫的本地檔頭沒有大小，所以看中央目錄）
  async function unzip(buf) {
    const b = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('這不是 Excel（.xlsx）檔');
    const count = dv.getUint16(end + 10, true);
    let p = dv.getUint32(end + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      files[name] = { method, size, off };
    }
    const read = async name => {
      const f = files[name]; if (!f) return null;
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      const raw = b.subarray(start, start + f.size);
      return dec.decode(f.method === 8 ? await inflate(raw) : raw);
    };
    return { names: Object.keys(files), read };
  }
  const xmlDoc = s => new DOMParser().parseFromString(s, 'application/xml');
  const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
  const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

  async function firstSheet(file) {
    const z = await unzip(await file.arrayBuffer());
    const shared = [];
    const ss = await z.read('xl/sharedStrings.xml');
    if (ss) tags(xmlDoc(ss), 'si').forEach(si => shared.push(tags(si, 't').map(t => t.textContent).join('')));
    // 第一張工作表：照 workbook.xml 的順序找 r:id → 檔名
    let path = 'xl/worksheets/sheet1.xml';
    const wb = await z.read('xl/workbook.xml'), rels = await z.read('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const first = tags(xmlDoc(wb), 'sheet')[0];
      const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      const rel = tags(xmlDoc(rels), 'Relationship').find(r => r.getAttribute('Id') === rid);
      if (rel) { const t = rel.getAttribute('Target').replace(/^\//, ''); path = t.startsWith('xl/') ? t : `xl/${t}`; }
    }
    const sx = await z.read(path) || await z.read(z.names.find(n => /^xl\/worksheets\/.+\.xml$/.test(n)));
    if (!sx) throw new Error('Excel 裡找不到工作表');
    const rows = [];
    for (const row of tags(xmlDoc(sx), 'row')) {
      const r = Number(row.getAttribute('r')) - 1, out = [];
      for (const c of tags(row, 'c')) {
        const i = colIndex(c.getAttribute('r') || ''), t = c.getAttribute('t'), v = tags(c, 'v')[0]?.textContent ?? '';
        out[i] = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? tags(c, 't').map(x => x.textContent).join('') : t === 'str' || t === 'b' || t === 'e' ? v : v === '' ? '' : Number(v);
      }
      rows[r] = Array.from(out, x => x ?? '');
    }
    return Array.from(rows, x => x || []);
  }
  window.XLSXRead = { firstSheet };
})();
