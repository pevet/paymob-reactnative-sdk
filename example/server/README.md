# Paymob demo backend

Minimal Express server showing the server-side half of a Paymob integration:

- `POST /intentions` — creates a payment intention with the **secret key** and
  returns `{ clientSecret, reference }`. The app calls this instead of hitting
  Paymob directly.
- `POST /paymob/webhook` — Paymob's `notification_url`. Captures the
  authoritative `TRANSACTION` result and the `TOKEN` (saved card) callback,
  correlating them by order id.
- `GET /tx/:reference` — the app polls this for `{ status, savedCard, ... }`.
- `GET /saved-cards` — lists cards persisted from `TOKEN` callbacks.

Saved cards are written to `saved-cards.json` (gitignored — it holds card
tokens/PII) and reloaded on startup, so they survive restarts.

## Run

```bash
cd example/server
npm install
cp .env.example .env   # then fill PAYMOB_SECRET_KEY
npm start              # http://localhost:3000
```

## Receiving the webhook locally

Paymob POSTs the webhook from their servers, so `notification_url` must be a
public URL — it cannot reach `localhost`. For local end-to-end testing, expose
the server with a tunnel and point `PUBLIC_URL` at it:

```bash
ngrok http 3000
# then in .env: PUBLIC_URL=https://<your-subdomain>.ngrok.io
```

Without a tunnel the server still runs and creates intentions; `/tx/:reference`
just stays at the seeded `Created` status because no webhook arrives.

### Simulate a webhook (no tunnel)

```bash
# TRANSACTION (success) — replace <reference> with the value from /intentions
curl -X POST 'http://localhost:3000/paymob/webhook' -H 'Content-Type: application/json' \
  -d '{"type":"TRANSACTION","obj":{"id":123,"success":true,"pending":false,"amount_cents":1500,"order":{"id":999,"merchant_order_id":"<reference>"}}}'

# TOKEN (saved card) — order_id matches the transaction's order.id
curl -X POST 'http://localhost:3000/paymob/webhook' -H 'Content-Type: application/json' \
  -d '{"type":"TOKEN","obj":{"order_id":999,"token":"tok_abc","masked_pan":"xxxx-1111","card_subtype":"Visa"}}'

curl http://localhost:3000/tx/<reference>
```
