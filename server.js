require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');

// ✅ 静的ファイル
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ✅ Stripe Webhook（rawボディで処理）
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('✅ Webhookイベントタイプ:', event.type);
  } catch (err) {
    console.error('❌ Webhook署名検証失敗:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const meta = event.data.object.metadata;
    console.log('✅ 決済完了: Session ID:', event.data.object.id);
    console.log('🎵 Music URL:', meta.musicURL);
  }

  res.sendStatus(200);
});

// ✅ JSONパーサー（Webhookの後に）
app.use(express.json({ limit: '20mb' }));

// ✅ Stripe Checkout セッション作成
app.post('/create-checkout-session', async (req, res) => {
  const { quantity, musicURL } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'jpy',
          product_data: { name: 'CD型NFCキーホルダー' },
          unit_amount: 2500,
        },
        quantity,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/complete.html?orderId={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/purchase.html`,
      metadata: {
        musicURL
      }
    });
    res.json({ id: session.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 画像保存（メール＋日時をフォルダ名に）
app.post('/save-images', async (req, res) => {
  const {
    sessionId,
    musicURL,
    email,
    coverImage,
    bookletImage,
    discImage,
    backImage,
    spineImage
  } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'メールアドレスが必要です' });
  }

  // フォルダ名をメール + タイムスタンプで生成
  const sanitizedEmail = email.replace(/[@.]/g, '_');
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0]; // 20250504T184512
  const folderName = `${sanitizedEmail}_${timestamp}`;
  const dir = path.join(__dirname, 'uploads', folderName);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const saveImage = (dataUrl, filename) => {
    if (!dataUrl) return;
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(path.join(dir, filename), base64, 'base64');
  };

  try {
    saveImage(coverImage, 'cover.png');
    saveImage(bookletImage, 'booklet.png');
    saveImage(discImage, 'disc.png');
    saveImage(backImage, 'back.png');
    saveImage(spineImage, 'spine.png');

    console.log(`✅ /save-images: 保存完了 → ${dir}`);
    res.status(200).json({ message: '保存完了', folder: folderName });
  } catch (err) {
    console.error('❌ /save-images: 保存エラー', err);
    res.status(500).json({ error: '保存に失敗しました' });
  }
});

// ✅ 起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
