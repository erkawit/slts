/**
 * report-xlsx.js — เขียนไฟล์ Excel (.xlsx) แบบมีรูปแบบ (ฟอนต์ TH SarabunPSK, เส้นตาราง, ผสานเซลล์, ตั้งค่าหน้า)
 * ใช้ JSZip ที่โหลดอยู่แล้วในหน้าเว็บ — แทน ExcelJS ของ summon-report (ไม่ต้องติดตั้ง package บนเซิร์ฟเวอร์)
 *
 *   const wb = SltsXlsx.workbook();
 *   const ws = wb.sheet('ชื่อชีต', { landscape: true, widths: [5, 20, ...] });
 *   ws.cell('A1', 'ข้อความ', { bold: true, size: 16, align: 'center', border: true, fmt: '#,##0.00' });
 *   ws.merge('A1:D1'); ws.height(1, 24);
 *   const blob = await wb.toBlob();
 */
(function (root) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (n) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const colIndex = (letters) => letters.split('').reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  const parseRef = (ref) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return { c: colIndex(m[1]), r: Number(m[2]) }; };

  function workbook() {
    const sheets = [];
    const styles = [];       // key → index (cellXfs)
    const styleKeys = new Map();
    const fonts = []; const fontKeys = new Map();
    const fmts = []; const fmtKeys = new Map();
    const FONT = 'TH SarabunPSK';

    function fontId(o) {
      const k = JSON.stringify([o.size || 15, !!o.bold, o.font || FONT, o.color || '']);
      if (!fontKeys.has(k)) { fontKeys.set(k, fonts.length); fonts.push(k); }
      return fontKeys.get(k);
    }
    function fmtId(code) {
      if (!code) return 0;
      if (code === '#,##0.00') return 4;
      if (code === '#,##0') return 3;
      if (!fmtKeys.has(code)) { fmtKeys.set(code, 164 + fmts.length); fmts.push(code); }
      return fmtKeys.get(code);
    }
    function styleId(o) {
      o = o || {};
      const k = JSON.stringify([fontId(o), fmtId(o.fmt), !!o.border, o.align || '', o.valign || 'center', !!o.wrap, !!o.shrink, o.fill || '']);
      if (!styleKeys.has(k)) { styleKeys.set(k, styles.length); styles.push(k); }
      return styleKeys.get(k);
    }
    styleId({}); // index 0 = ค่าเริ่มต้น

    function sheet(name, opt) {
      opt = opt || {};
      const ws = { name: String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), cells: new Map(), merges: [], heights: {}, opt };
      ws.cell = (ref, value, o) => { const p = parseRef(ref); ws.cells.set(`${p.r}:${p.c}`, { r: p.r, c: p.c, v: value, s: styleId(o) }); return ws; };
      ws.at = (r, c, value, o) => ws.cell(colName(c) + r, value, o);
      ws.merge = (range) => { ws.merges.push(range); return ws; };
      ws.height = (r, h) => { ws.heights[r] = h; return ws; };
      /** ใส่สไตล์ให้ทุกเซลล์ในช่วง (เช่นเส้นตารางของเซลล์ที่ผสาน) */
      ws.styleRange = (range, o) => {
        const [a, b] = range.split(':').map(parseRef);
        for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) {
          const k = `${r}:${c}`; const cur = ws.cells.get(k);
          ws.cells.set(k, { r, c, v: cur ? cur.v : null, s: styleId(o) });
        }
        return ws;
      };
      sheets.push(ws);
      return ws;
    }

    function sheetXml(ws) {
      const rows = new Map();
      ws.cells.forEach((cell) => { if (!rows.has(cell.r)) rows.set(cell.r, []); rows.get(cell.r).push(cell); });
      Object.keys(ws.heights).forEach((r) => { if (!rows.has(Number(r))) rows.set(Number(r), []); });
      const rowNums = Array.from(rows.keys()).sort((a, b) => a - b);
      let data = '';
      rowNums.forEach((r) => {
        const cells = rows.get(r).sort((a, b) => a.c - b.c);
        const ht = ws.heights[r] ? ` ht="${ws.heights[r]}" customHeight="1"` : '';
        data += `<row r="${r}"${ht}>`;
        cells.forEach((c) => {
          const ref = colName(c.c) + c.r;
          if (c.v === null || c.v === undefined || c.v === '') data += `<c r="${ref}" s="${c.s}"/>`;
          else if (typeof c.v === 'number' && Number.isFinite(c.v)) data += `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`;
          else if (typeof c.v === 'object' && c.v.formula) data += `<c r="${ref}" s="${c.s}"><f>${esc(c.v.formula)}</f></c>`;
          else data += `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
        });
        data += '</row>';
      });
      const cols = (ws.opt.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
      const merges = ws.merges.length ? `<mergeCells count="${ws.merges.length}">${ws.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
      const land = ws.opt.landscape ? 'landscape' : 'portrait';
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"${ws.opt.zoom ? ` zoomScale="${ws.opt.zoom}"` : ''}/></sheetViews>
<sheetFormatPr defaultRowHeight="21"/>${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${data}</sheetData>${merges}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
<pageSetup paperSize="9" orientation="${land}" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
    }

    function stylesXml() {
      const fontXml = fonts.map((k) => {
        const [size, bold, name, color] = JSON.parse(k);
        return `<font>${bold ? '<b/>' : ''}<sz val="${size}"/>${color ? `<color rgb="FF${color.replace('#', '')}"/>` : ''}<name val="${esc(name)}"/><family val="2"/></font>`;
      }).join('');
      const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
      const fillIdx = new Map();
      const xfs = styles.map((k) => {
        const [f, nf, border, align, valign, wrap, shrink, fill] = JSON.parse(k);
        let fi = 0;
        if (fill) {
          if (!fillIdx.has(fill)) { fillIdx.set(fill, fills.length); fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${fill.replace('#', '')}"/><bgColor indexed="64"/></patternFill></fill>`); }
          fi = fillIdx.get(fill);
        }
        const al = `<alignment${align ? ` horizontal="${align}"` : ''} vertical="${valign}"${wrap ? ' wrapText="1"' : ''}${shrink ? ' shrinkToFit="1"' : ''}/>`;
        return `<xf numFmtId="${nf}" fontId="${f}" fillId="${fi}" borderId="${border ? 1 : 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`;
      }).join('');
      const numFmts = fmts.length ? `<numFmts count="${fmts.length}">${fmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(c)}"/>`).join('')}</numFmts>` : '';
      const thin = '<left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/>';
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts}
<fonts count="${fonts.length}">${fontXml}</fonts>
<fills count="${fills.length}">${fills.join('')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${thin}</border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${styles.length}">${xfs}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    }

    async function build(type, JSZipLib) {
      const JSZip = JSZipLib || root.JSZip || (typeof require === 'function' ? require('jszip') : null);
      const zip = new JSZip();
      const ov = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
      zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ov}</Types>`);
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
      zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
      sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
      zip.file('xl/styles.xml', stylesXml());
      return zip.generateAsync({ type, compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    return { sheet, toBlob: () => build('blob'), toBuffer: (JSZip) => build('nodebuffer', JSZip), colName };
  }

  const api = { workbook, colName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SltsXlsx = api;
})(typeof window !== 'undefined' ? window : globalThis);
