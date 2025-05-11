// generate-print-pdf.js
const fs     = require('fs');
const path   = require('path');
const glob   = require('glob');
const sharp  = require('sharp');
const PDFKit = require('pdfkit');

(async () => {
  // ★ DPI と単位変換
  const DPI       = 300;
  const ptPerCm   = 72 / 2.54;   // 1cm = 28.346pt
  const pxPerCm   = DPI / 2.54;  // 1cm = 118.11px

  // 用紙の物理余白（非印刷領域）
  const marginCm = 1.9;         // 上下左右共通 1.9cm
  const printableWcm = 21 - marginCm * 2;   // A4幅 21cm - 余白
  const printableHcm = 29.7 - marginCm * 2; // A4高 29.7cm - 余白

  // 各パーツの実寸 (cm)
  const sizes = {
    cover  : { w:4,   h:4   },
    booklet: { w:4,   h:4   },
    disc   : { w:4,   h:4   },
    back   : { w:5,   h:3.7 },
    spine  : { w:0.5, h:3.7 },
  };

  // 最新フォルダを探す
  const base = path.resolve(__dirname, 'uploads');
  const folders = fs.readdirSync(base)
    .map(f => ({ f, m: fs.statSync(path.join(base,f)).mtime }))
    .sort((a,b) => b.m - a.m);
  const targetDir = path.join(base, folders[0].f);

  // PDF ドキュメント生成：ページサイズを「印刷可能領域」に設定
  const pageWidth  = printableWcm * ptPerCm;
  const pageHeight = printableHcm * ptPerCm;
  const doc = new PDFKit({
    autoFirstPage: false,
    size: [pageWidth, pageHeight],
    margin: 0
  });
  const out = fs.createWriteStream('print_sheet.pdf');
  doc.pipe(out);

  // レイアウト設定：余白なし、横並び配置
  const paddingPt = 0;
  let x = 0;
  let y = 0;

  doc.addPage();

  for (let part of ['cover','booklet','disc','back','spine']) {
    const file = path.join(targetDir, `${part}.png`);
    if (!fs.existsSync(file)) continue;

    // リサイズ (px)
    const mm = sizes[part];
    const pxW = Math.round(mm.w * pxPerCm);
    const pxH = Math.round(mm.h * pxPerCm);
    const buffer = await sharp(file)
      .resize(pxW, pxH)
      .toBuffer();

    // PDF に配置 (pt)
   const scale = 1 / 1.05;  // ≒ 95.2%
   const ptW = mm.w * ptPerCm * scale;
   const ptH = mm.h * ptPerCm * scale;
    doc.image(buffer, x, y, { width: ptW, height: ptH });

    x += ptW; // 次をすぐ隣に
  }

  doc.end();
  out.on('finish', () => console.log('✅ print_sheet.pdf が生成されました (A4 余白込み)'));
})();
