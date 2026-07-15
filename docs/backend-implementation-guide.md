# Backend implementation guide — Paymob payments for the mobile app

|          |                                    |
| -------- | ---------------------------------- |
| Audience | Backend engineer building the production payments service |
| Status   | Implementation guide                |
| Region   | Paymob **Oman** (adjust base URL for other regions) |

This describes the backend the mobile app talks to. The app **never** calls
Paymob directly — it only calls this service. A working reference implementation
lives in [`example/server/index.js`](../example/server/index.js) (a demo: in-memory
stores, optional HMAC, no auth). This guide is the contract plus what must change
to make it production-grade. See [`ARCHITECTURE.md`](../ARCHITECTURE.md) for the
end-to-end picture and [`docs/saved-card-flow-spec.md`](saved-card-flow-spec.md)
for the user journeys.

> **Testing note:** the backend is platform-agnostic and unaffected by the
> client-side SDK bugs, but end-to-end testing currently works only on **iOS** —
> the **Android** embedded checkout is blocked by three Paymob Android SDK 1.9.2
> defects (crashes on Pay / render, customization ignored). See the reports filed
> with Paymob: [issue 1](paymob-android-issue-1-embedded-customization.md),
> [issue 2](paymob-android-issue-2-getbinding-crash.md),
> [issue 3](paymob-android-issue-3-saveandpay-crash.md)
> ([overview](paymob-android-sdk-issue.md)).

## 1. What the backend is responsible for

1. **Hold the Paymob secret key.** It is used only here, only to create
   intentions. It must never ship in the app.
2. **Create payment intentions** with Paymob and return the `client_secret` the
   app feeds to the embedded SDK.
3. **Receive Paymob webhooks** (`TRANSACTION` and `TOKEN`), verify their HMAC,
   and treat them as the **authoritative** result — not the in-app callback.
4. **Persist saved-card tokens** (scoped to the authenticated customer) and serve
   them back for the card list.
5. **Expose a result-lookup endpoint** the app polls after payment.

## 2. Prerequisites (from the Paymob dashboard)

- **Secret key** (`*_sk_*`) — server-side only.
- **Public key** (`*_pk_*`) — given to the app (safe to ship).
- **Integration ID(s)** for the card gateway (the demo uses `70072` for Oman
  MIGS/MPGS). These go in `payment_methods`.
- **HMAC secret** — used to verify every webhook. **Required in production.**
- A **public HTTPS URL** for the webhook (`notification_url`). Locally, expose
  the service with a tunnel (cloudflared/ngrok).

Configuration (env): `PAYMOB_SECRET_KEY`, `PAYMOB_HMAC_SECRET`, the public base
URL, the card integration id(s), and the region base URL.

## 3. API contract the app depends on

These request/response shapes are what the app's
[`api/paymob.ts`](../example/src/api/paymob.ts) expects — keep them stable.

### `POST /intentions`
Create an intention for a top-up.

- **Request:** `{ "amount": <number, major units e.g. OMR> }`, optionally with
  `"cardTokens"`:
  - omitted → offer **all** the customer's saved cards + new card;
  - `["<token>"]` → scope the checkout to **that one** saved card;
  - `[]` → **new card only**.
- **Response:** `{ "clientSecret": string, "reference": string, "savedCards": SavedCard[] }`
- `reference` is your own unique id (the intention's `special_reference`); the app
  later polls `/tx/:reference` with it.

### `GET /tx/:reference`
The authoritative result the app polls after payment.

- **Response:** `{ "found": boolean, "status"?: "Created"|"Success"|"Failed"|"Pending", "transactionId"?: number|null, "amountCents"?: number|null, "savedCard"?: SavedCard|null }`
- Return `{ "found": false }` until the first webhook lands.

### Saved-card management
| Endpoint | Body | Returns |
| --- | --- | --- |
| `GET /saved-cards` | — | `SavedCard[]` (display order) |
| `PATCH /saved-cards/:token` | `{ "nickname": string }` (empty string clears) | updated `SavedCard` |
| `DELETE /saved-cards/:token` | — | `200` |
| `PUT /saved-cards/order` | `{ "tokens": string[] }` (top→bottom) | `SavedCard[]` |

### `SavedCard` shape
```ts
{
  token: string;        // Paymob card token — reusable, opaque
  maskedPan: string;    // "xxxx-xxxx-xxxx-1111"
  cardType: string;     // "Visa" | "MasterCard" | ...
  nickname: string|null;// user-set label (managed by this backend)
  order: number|null;   // display order (managed by this backend)
  email: string|null;
  reference: string|null;
  receivedAt: string;   // ISO timestamp
}
```

## 4. Authentication & customer scoping

The demo endpoints are unauthenticated and share **one global** saved-card store.
Production must authenticate every app-facing request and scope **all** state to
the authenticated customer.

**How.** Reuse the app's existing auth: the app sends `Authorization: Bearer
<token>` (session/JWT) on every call and the backend validates it to a
`customerId`. The request/response **bodies stay exactly as in §3** — the only
additions are the header and server-side scoping. A missing/invalid token → `401`.

**Per-endpoint ownership rules:**

| Endpoint | Rule once per-customer |
| --- | --- |
| `POST /intentions` | Derive `card_tokens` from **this customer's** cards. If the client sends a `cardTokens` scope, **validate every token belongs to the customer** (else `403`). Take the amount from a **server-side order/cart** owned by the customer — never trust the client amount for a real charge. Fill `billing_data` from the customer profile. **Record `customerId` with the `reference`/order id** (see below). |
| `GET /tx/:reference` | The `reference` must belong to the authenticated customer (stored at creation) — else `404`. |
| `GET /saved-cards` | Return only this customer's cards. |
| `PATCH` / `DELETE /saved-cards/:token` | Verify the token belongs to the customer — else `404`/`403`. |
| `PUT /saved-cards/order` | Every token in the array must belong to the customer. |

**The webhook is the exception.** `POST /paymob/webhook` is called by Paymob, not
the customer — there is no session, so it is authenticated by **HMAC** (§6), and
the customer is resolved from an association you store at intention creation:

- When you create an intention, persist `{ reference, orderId, customerId }`.
- On `TRANSACTION`, look up the customer by `reference` / `orderId` and fulfil
  **that** customer's order.
- On `TOKEN`, attribute the saved card to the **same** customer — store it under
  their `customerId`, never in a shared list.

**Token ownership:** a card `token` is only ever meaningful for the customer who
created it. Never return, charge, or expose a token across customers — resolve
`customerId` first, then filter by it.

## 5. Creating the intention (backend → Paymob)

`POST https://oman.paymob.com/v1/intention/` (Oman; swap host per region)

- **Header:** `Authorization: Token <SECRET_KEY>`
- **Body:**
```jsonc
{
  "amount": 5000,                       // smallest subunit (see §7)
  "currency": "OMR",
  "payment_methods": [70072],           // your card integration id(s)
  "card_tokens": ["..."],               // saved-card tokens to offer (or [])
  "items": [],
  "billing_data": {                     // use the real customer profile in prod
    "first_name": "…", "last_name": "…",
    "phone_number": "+968…", "email": "…"
  },
  "extras": {},
  "special_reference": "<your unique reference>",
  "expiration": 3600,
  "notification_url": "https://<public-host>/paymob/webhook"
}
```
- **Response:** contains `client_secret` → return it to the app as `clientSecret`.
- Seed your store with `{ reference, status: "Created" }` so the poll gets a
  definite "not settled yet" answer before webhooks arrive.

## 6. Webhooks (the source of truth)

Paymob POSTs to `notification_url` with `{ type, obj }` and an `hmac` query
param. Two types matter:

**`TRANSACTION`** — the payment result:
- `obj.success` (bool), `obj.pending` (bool) → map to `Success` / `Pending` /
  `Failed`.
- `obj.id` → transaction id; `obj.amount_cents` → amount.
- `obj.order.merchant_order_id` → **your** `special_reference`.
- `obj.order.id` → Paymob order id.

**`TOKEN`** — the saved card (only when the customer chose to save):
- `obj.token`, `obj.masked_pan`, `obj.card_subtype`, `obj.email`.
- `obj.order_id` → Paymob order id.

**Correlation gotcha:** `TRANSACTION` sends the order id as a **number**
(`obj.order.id`); `TOKEN` sends it as a **string** (`obj.order_id`). Normalize to
a string key before correlating. The two callbacks are independent and `TOKEN`
usually trails `TRANSACTION` by a few seconds, sometimes arriving first — buffer
whichever lands first and reconcile when its partner arrives.

**HMAC verification (mandatory in production):** compute SHA-512 over Paymob's
ordered field concatenation for the callback type, keyed with `PAYMOB_HMAC_SECRET`,
and compare (constant-time) to the `hmac` query param. Reject with `403` on
mismatch. The demo implements only the `TRANSACTION` field order and makes it
optional — a production build must verify **every** callback. See Paymob's docs
for the exact field list per type.

Return `200` quickly; do the persistence/side effects idempotently (Paymob
retries, and may deliver duplicates or out-of-order).

## 7. Amounts & currency

OMR has **3 decimal places**. Paymob expects the smallest subunit (baisa):
`subunit = round(amountOMR * 1000)` (e.g. `5.000 OMR → 5000`). Adjust the
multiplier per currency (EGP/AED use 2 decimals → ×100). **Never trust the amount
from the client for a real charge** — derive it from a server-side order/cart.

## 8. Production hardening — what must change from the demo

The demo cuts corners a production service cannot:

- [ ] **Authenticate the customer and scope all state to them** — see §4. The
      demo has no auth and one global card store shared by everyone.
- [ ] **Verify the webhook HMAC** on every callback (demo makes it optional).
- [ ] **Use a real datastore** (Postgres/etc.) instead of in-memory maps + a
      local JSON file. Transaction results and card records must be durable and
      queryable.
- [ ] **Idempotent webhook processing** — dedupe by transaction/order id; handle
      retries and out-of-order delivery.
- [ ] **Treat card tokens as PII** — encrypt at rest, restrict access, log
      carefully (never log full tokens/PII).
- [ ] **Real `billing_data`** from the customer profile, not placeholders.
- [ ] **Fulfilment on the webhook, not the app callback** — credit the wallet /
      complete the order only after a verified `TRANSACTION` success.
- [ ] **Rate-limit / validate** intention creation; tie each intention to an
      authenticated user and a server-derived amount.

## 9. Reference

- Demo backend: [`example/server/index.js`](../example/server/index.js) and its
  [`README`](../example/server/README.md).
- End-to-end flows and diagrams: [`ARCHITECTURE.md`](../ARCHITECTURE.md).
- User journeys / acceptance criteria:
  [`docs/saved-card-flow-spec.md`](saved-card-flow-spec.md).
