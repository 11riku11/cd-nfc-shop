// server.js

// ── 環境変数読み込み＆デバッグ ──
const path = require('path');
const dotenvResult = require('dotenv').config({
  path: path.resolve(__dirname, '.env'),
  debug: true
});
if (dotenvResult.error) {
  console.error('❌ dotenv load error:', dotenvResult.error);
} else {
  console.log('✅ dotenv parsed keys:', dotenvResult.parsed);
}
console.log('Working dir:', process.cwd());
console.log('__dirname:', __dirname);
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? '○OK' : '×NG');

// ── モジュール読み込み ──
const express = require('express');
const fs = require('fs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');  // メール追加

// ── メール送信用トランスポート設定 ──
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

// ── Express アプリ初期化 ──
const app = express();

// ── 静的ファイル公開 & JSON パーサー ──
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json({ limit: '20mb' }));

// ── Index ルート ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Stripe Webhook エンドポイント ──
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    console.log('✅ checkout.session.completed:', event.data.object.id);
  }
  res.sendStatus(200);
});

// ── Checkout Session 作成 ──
app.post('/create-checkout-session', async (req, res) => {
  const { quantity, musicURL } = req.body;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'jpy',
          product_data: { name: 'CD型NFCキーホルダー' },
          unit_amount: 3300,
        },
        quantity,
      }],
      mode: 'payment',
      automatic_tax: {
        enabled: true
      },
      success_url: `${req.headers.origin}/complete.html?orderId={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/purchase.html`,
       metadata: { musicURL }
     });
    res.json({ id: session.id });
  } catch (err) {
    console.error('❌ create-checkout-session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 画像＋顧客情報保存 & メール送信 ──
app.post('/save-images', async (req, res) => {
  const {
    sessionId,
    musicURL,
    email,
    name,
    postal,
    address,
    coverImage,
    bookletImage,
    discImage,
    backImage,
    spineImage,
    quantity
  } = req.body;

  if (!email || !name || !address) {
    return res.status(400).json({ error: 'メール・お名前・住所は必須です' });
  }

  // フォルダ名生成
  const sanitized = email.replace(/[@.]/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  const folder = `${sanitized}_${timestamp}`;
  const dir = path.join(__dirname, 'uploads', folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // 画像保存
  const saveImage = (dataUrl, filename) => {
    if (!dataUrl) return;
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(path.join(dir, filename), base64, 'base64');
  };
  saveImage(coverImage, 'cover.png');
  saveImage(bookletImage, 'booklet.png');
  saveImage(discImage, 'disc.png');
  saveImage(backImage, 'back.png');
  saveImage(spineImage, 'spine.png');

  // 顧客詳細をテキストにまとめて保存
  const details = [
    `Session ID: ${sessionId}`,
    `Name     : ${name}`,
    `Email    : ${email}`,
    `Postal   : ${postal}`,
    `Address  : ${address}`,
    `Quantity : ${quantity}`,
    `MusicURL : ${musicURL}`
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'details.txt'), details, 'utf8');

  // 注文確認メール送信
  const mailOptions = {
    from: process.env.MAIL_USER,
    to: email,
    subject: '【CD型NFCキーホルダー】ご注文ありがとうございます',
    text: `${name} 様

ご注文を承りました。

【注文番号】 ${sessionId}
【数量】       ${quantity} 個
【合計金額】   ¥${quantity * 3300}

【お届け先】
${postal}
${address}

添付リンク
${musicURL}

商品発送まで今しばらくお待ちください。
`
  };
  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ saved & email sent → ${dir}`);
    res.json({ message: '保存＆メール送信完了', folder });
  } catch (err) {
    console.error('❌ email send error:', err);
    res.status(500).json({ error: 'メール送信に失敗しました' });
  }
});

// ── サーバ起動 ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
