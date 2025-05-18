// server.js

// ── 環境変数読み込み＆デバッグ ──
const path = require('path');

console.log('Working dir:', process.cwd());
console.log('__dirname:', __dirname);
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? '○OK' : '×NG');

// ── モジュール読み込み ──
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
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
          unit_amount: 1,
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

  // Cloudinaryに画像をアップロードする関数
  const uploadImage = async (dataUrl, filename) => {
    if (!dataUrl) return null;
    try {
      const result = await cloudinary.uploader.upload(
        dataUrl,
        {
          folder: `nfc-orders/${email.replace(/[@.]/g, '_')}`,
          public_id: filename,
          overwrite: true
        }
      );
      return result.secure_url;
    } catch (err) {
      console.error(`❌ Cloudinary upload error (${filename}):`, err);
      return null;
    }
  };

  try {
    const [coverUrl, bookletUrl, discUrl, backUrl, spineUrl] = await Promise.all([
      uploadImage(coverImage, 'cover'),
      uploadImage(bookletImage, 'booklet'),
      uploadImage(discImage, 'disc'),
      uploadImage(backImage, 'back'),
      uploadImage(spineImage, 'spine')
    ]);

    // メール送信
    const mailOptions = {
      from: process.env.MAIL_USER,
  to: [email, 'riku.nakagawa.11@gmail.com'],
      subject: '【CD型NFCキーホルダー】ご注文ありがとうございます',
      text: `${name} 様

ご注文を承りました。

【注文番号】 ${sessionId}
【数量】       ${quantity} 個
【合計金額】   ¥${quantity * 3300}

【お届け先】
${postal}
${address}

【音楽URL】
${musicURL}

【アップロード画像URL】
- 表紙: ${coverUrl}
- ブックレット: ${bookletUrl}
- ディスク: ${discUrl}
- 裏面: ${backUrl}
- 背面: ${spineUrl}

商品発送まで今しばらくお待ちください。
`
    };

    await transporter.sendMail(mailOptions);
    console.log('✅ Cloudinary保存＆メール送信完了');
    res.json({ message: '保存＆メール送信完了', images: { coverUrl, bookletUrl, discUrl, backUrl, spineUrl } });
  } catch (err) {
    console.error('❌ 保存またはメール送信失敗:', err);
    res.status(500).json({ error: '保存またはメール送信に失敗しました' });
  }
});


// ── サーバ起動 ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
