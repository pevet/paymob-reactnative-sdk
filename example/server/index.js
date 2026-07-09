/**
 * Minimal Paymob demo backend.
 *
 * Responsibilities (all the things that must NOT live in the mobile app):
 *   1. POST /intentions          Create a payment intention with the SECRET key
 *                                and return the client_secret + reference.
 *                                Optional cardTokens scopes the offered cards.
 *   2. POST /paymob/webhook       Receive Paymob's server-to-server callbacks
 *                                (notification_url). This is the AUTHORITATIVE
 *                                transaction result. Paymob sends two kinds:
 *                                  - TRANSACTION: success/pending/failed
 *                                  - TOKEN:       the saved-card token (when the
 *                                                 shopper opted to save the card)
 *   3. GET  /tx/:reference        The app polls this for the result + saved card.
 *   4. GET  /saved-cards          Lists saved cards persisted from TOKEN callbacks.
 *   5. PATCH/DELETE /saved-cards/:token  Rename (nickname) or remove a card.
 *   6. PUT  /saved-cards/order    Set the display order (array of tokens).
 *
 * Transaction results are held in-memory (a Map) to keep the demo minimal;
 * saved cards are also persisted to a local JSON file so tokens survive
 * restarts. Use a real datastore in production.
 *
 * NOTE: Paymob posts the webhook from their servers, so notification_url must be
 * a PUBLIC url. In local dev, expose this server with a tunnel (ngrok/
 * cloudflared) and set PUBLIC_URL to that https origin. Without a tunnel the
 * webhook never arrives and /tx/:reference stays at its seeded "Created" state.
 */

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.PAYMOB_SECRET_KEY;
const HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET; // optional; verification skipped if unset
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const NOTIFICATION_URL = `${PUBLIC_URL.replace(/\/$/, '')}/paymob/webhook`;

const INTENTION_URL = 'https://oman.paymob.com/v1/intention/';
const CURRENCY = 'OMR';
const PAYMENT_METHODS = [70072];

// --- In-memory stores -------------------------------------------------------
const results = new Map(); // reference -> { status, transactionId, amountCents, savedCard, updatedAt }
const refByOrderId = new Map(); // paymob order id -> reference
const pendingTokensByOrderId = new Map(); // paymob order id -> savedCard (TOKEN arrived before TRANSACTION)

// --- Saved-card persistence (local JSON file, keyed by token) ---------------
// Durable so tokens survive restarts. Contains card tokens/PII, so it's
// gitignored. A real integration would use a datastore keyed to the customer.
const SAVED_CARDS_FILE = path.join(__dirname, 'saved-cards.json');

function loadSavedCards() {
  try {
    return JSON.parse(fs.readFileSync(SAVED_CARDS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const savedCards = loadSavedCards(); // token -> record

function writeSavedCards() {
  try {
    fs.writeFileSync(SAVED_CARDS_FILE, JSON.stringify(savedCards, null, 2));
  } catch (err) {
    console.error('[saved-cards] write failed', err);
  }
}

function persistSavedCard(record) {
  if (!record || !record.token) {
    return;
  }
  const existing = savedCards[record.token];
  // Preserve a user-set nickname and manual order if the card is re-tokenized.
  savedCards[record.token] = {
    ...record,
    nickname: existing?.nickname ?? null,
    order: existing?.order ?? null,
  };
  writeSavedCards();
  console.log(
    `[saved-cards] persisted token=${record.token.slice(0, 8)}… (${Object.keys(savedCards).length} total)`
  );
}

// Saved cards in display order: cards with a manual order first (ascending),
// then any others by most-recent. (Demo-global: no customer auth here.)
function listSavedCards() {
  return Object.values(savedCards).sort((a, b) => {
    const ao = a.order;
    const bo = b.order;
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    return String(b.receivedAt).localeCompare(String(a.receivedAt));
  });
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Create a Paymob intention for the given OMR amount and return
// { reference, data }. `cardTokensOverride` scopes which saved cards the
// checkout offers: omit for all persisted cards, `[token]` for just one, or
// `[]` for none (new card only).
async function createPaymobIntention(amountOmr, cardTokensOverride) {
  // OMR has 3 decimals; Paymob expects the smallest subunit (baisa).
  const amount = Math.round(amountOmr * 1000);
  const reference = `rn_demo_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  // Pre-load saved cards into the checkout by passing their tokens. Paymob
  // silently drops invalid/expired tokens, so sending the whole list is safe.
  const cardTokens =
    cardTokensOverride !== undefined
      ? cardTokensOverride
      : listSavedCards()
          .map((c) => c.token)
          .filter(Boolean);

  const body = {
    amount,
    currency: CURRENCY,
    payment_methods: PAYMENT_METHODS,
    card_tokens: cardTokens,
    items: [],
    billing_data: {
      first_name: 'Test',
      last_name: 'Account',
      phone_number: '+96890000000',
      email: 'test@example.com',
    },
    extras: {},
    special_reference: reference,
    expiration: 3600,
    notification_url: NOTIFICATION_URL,
  };

  const resp = await fetch(INTENTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`intention failed (${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text);
  if (!data.client_secret) {
    throw new Error('no client_secret in intention response');
  }
  // Seed so the app's poll gets a definite "not settled yet" answer.
  results.set(reference, { status: 'Created', updatedAt: Date.now() });
  return { reference, data, amount };
}

// --- 1a. Embedded flow: create intention, return client_secret --------------
app.post('/intentions', async (req, res) => {
  try {
    if (!SECRET_KEY) {
      return res
        .status(500)
        .json({ error: 'PAYMOB_SECRET_KEY not configured' });
    }
    const amountOmr = Number(req.body?.amount);
    if (!Number.isFinite(amountOmr) || amountOmr <= 0) {
      return res
        .status(400)
        .json({ error: 'amount must be a positive number' });
    }
    // Optional: scope the checkout to specific saved-card tokens (the app-driven
    // flow sends [token] for one card or [] for a new card only).
    const cardTokens = Array.isArray(req.body?.cardTokens)
      ? req.body.cardTokens
      : undefined;
    const { reference, data, amount } = await createPaymobIntention(
      amountOmr,
      cardTokens
    );
    console.log(`[intention] created reference=${reference} amount=${amount}`);
    res.json({
      clientSecret: data.client_secret,
      reference,
      savedCards: listSavedCards(),
    });
  } catch (err) {
    console.error('[intention] error', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// --- 2. Paymob webhook (authoritative result + saved card) ------------------
app.post('/paymob/webhook', (req, res) => {
  const payload = req.body || {};
  const type = payload.type;
  const obj = payload.obj || {};

  if (HMAC_SECRET && !isValidHmac(type, obj, req.query.hmac)) {
    console.warn('[webhook] HMAC mismatch — rejecting');
    return res.status(403).json({ error: 'invalid hmac' });
  }

  if (type === 'TRANSACTION') {
    const reference = obj?.order?.merchant_order_id;
    // NOTE: TRANSACTION sends order.id as a number but TOKEN sends order_id as
    // a string, so normalize to a string key for correlation.
    const orderKey = obj?.order?.id != null ? String(obj.order.id) : null;
    const status = obj?.success
      ? 'Success'
      : obj?.pending
        ? 'Pending'
        : 'Failed';

    const existing = (reference && results.get(reference)) || {};
    const savedCard =
      existing.savedCard ||
      (orderKey != null ? pendingTokensByOrderId.get(orderKey) : undefined);

    if (reference) {
      results.set(reference, {
        status,
        transactionId: obj?.id,
        amountCents: obj?.amount_cents,
        savedCard: savedCard || undefined,
        updatedAt: Date.now(),
      });
    }
    if (orderKey != null && reference) {
      refByOrderId.set(orderKey, reference);
      pendingTokensByOrderId.delete(orderKey);
    }
    console.log(`[webhook] TRANSACTION ref=${reference} status=${status}`);
  } else if (type === 'TOKEN') {
    const orderKey = obj?.order_id != null ? String(obj.order_id) : null;
    const savedCard = {
      token: obj?.token,
      maskedPan: obj?.masked_pan,
      cardType: obj?.card_subtype,
    };
    const reference = orderKey != null ? refByOrderId.get(orderKey) : undefined;
    if (reference && results.has(reference)) {
      results.get(reference).savedCard = savedCard;
    } else if (orderKey != null) {
      // TOKEN arrived before TRANSACTION; reconcile when TRANSACTION lands.
      pendingTokensByOrderId.set(orderKey, savedCard);
    }

    // Persist the saved card durably (survives restarts).
    persistSavedCard({
      token: savedCard.token,
      maskedPan: savedCard.maskedPan,
      cardType: savedCard.cardType,
      email: obj?.email ?? null,
      orderId: orderKey,
      reference: reference ?? null,
      receivedAt: new Date().toISOString(),
    });

    console.log(
      `[webhook] TOKEN orderId=${orderKey} maskedPan=${savedCard.maskedPan}`
    );
  } else {
    console.log(`[webhook] ignored type=${type}`);
  }

  // Always ack so Paymob doesn't retry endlessly.
  res.sendStatus(200);
});

// --- 3. Result lookup (polled by the app) -----------------------------------
app.get('/tx/:reference', (req, res) => {
  const r = results.get(req.params.reference);
  if (!r) {
    return res.json({ found: false });
  }
  res.json({
    found: true,
    status: r.status,
    transactionId: r.transactionId ?? null,
    amountCents: r.amountCents ?? null,
    savedCard: r.savedCard ?? null,
  });
});

// All persisted saved cards (most recent first).
app.get('/saved-cards', (_req, res) => {
  res.json(listSavedCards());
});

// Set (or clear) a saved card's nickname.
app.patch('/saved-cards/:token', (req, res) => {
  const card = savedCards[req.params.token];
  if (!card) {
    return res.status(404).json({ error: 'card not found' });
  }
  const raw = req.body?.nickname;
  card.nickname = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  writeSavedCards();
  console.log(
    `[saved-cards] renamed token=${req.params.token.slice(0, 8)}… -> ${card.nickname ?? '(cleared)'}`
  );
  res.json(card);
});

// Set the display order of saved cards (array of tokens, top to bottom).
app.put('/saved-cards/order', (req, res) => {
  const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
  tokens.forEach((tok, i) => {
    if (savedCards[tok]) {
      savedCards[tok].order = i;
    }
  });
  writeSavedCards();
  console.log(`[saved-cards] reordered (${tokens.length} tokens)`);
  res.json(listSavedCards());
});

// Delete a saved card.
app.delete('/saved-cards/:token', (req, res) => {
  if (!savedCards[req.params.token]) {
    return res.status(404).json({ error: 'card not found' });
  }
  delete savedCards[req.params.token];
  writeSavedCards();
  console.log(`[saved-cards] deleted token=${req.params.token.slice(0, 8)}…`);
  res.json({ ok: true });
});

app.get('/', (_req, res) =>
  res.json({ ok: true, notificationUrl: NOTIFICATION_URL })
);

/**
 * Verifies Paymob's HMAC (SHA-512 over an ordered field concatenation, compared
 * to the `hmac` query param). Only the TRANSACTION field order is implemented
 * here; enable by setting PAYMOB_HMAC_SECRET. See Paymob docs for the exact
 * field list per callback type.
 */
function isValidHmac(type, obj, provided) {
  if (type !== 'TRANSACTION') {
    // Token HMAC uses a different field set; not implemented in this demo.
    return true;
  }
  const fields = [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    obj.order?.id,
    obj.owner,
    obj.pending,
    obj.source_data?.pan,
    obj.source_data?.sub_type,
    obj.source_data?.type,
    obj.success,
  ];
  const digest = crypto
    .createHmac('sha512', HMAC_SECRET)
    .update(fields.map((v) => `${v}`).join(''))
    .digest('hex');
  return digest === provided;
}

app.listen(PORT, () => {
  console.log(`Paymob demo backend on http://localhost:${PORT}`);
  console.log(`notification_url -> ${NOTIFICATION_URL}`);
  if (!HMAC_SECRET) {
    console.warn(
      'PAYMOB_HMAC_SECRET not set — webhook HMAC verification is DISABLED.'
    );
  }
  if (PUBLIC_URL.includes('localhost')) {
    console.warn(
      'PUBLIC_URL is localhost — Paymob cannot reach the webhook. Set PUBLIC_URL to a tunnel (ngrok/cloudflared) for real delivery.'
    );
  }
});
