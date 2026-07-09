# Demo architecture — payments and saved cards

How the example app, the demo backend, and Paymob divide the work. The guiding
rules: the **secret key stays server-side**, and the **webhook is the source of
truth** for the transaction result and the saved card.

> Scope: this describes the demo in [`example/`](example) — the React Native app
> and the minimal backend in [`example/server/`](example/server). It is not part
> of the published SDK.

## Flow

```mermaid
sequenceDiagram
    participant App as Mobile app (RN, iOS)
    participant BE as Backend (Express)
    participant PM as Paymob (Oman)
    Note over BE: holds the secret key<br/>and saved-cards.json
    App->>BE: 1. POST /intentions {amount}
    BE->>PM: 2. create intention (+ card_tokens, secret key)
    PM-->>BE: 3. client_secret
    BE-->>App: 4. clientSecret + reference + savedCards
    App->>PM: 5. embedded checkout: card + 3-D Secure
    PM->>BE: 6. webhook: TRANSACTION + TOKEN (via cloudflared tunnel)
    BE->>BE: persist saved card -> saved-cards.json
    App->>BE: 7. GET /tx/:reference (poll)
    BE-->>App: status + saved card
```

1. **App → Backend** — the app sends only the amount (`POST /intentions`).
   Nothing sensitive leaves the device.
2. **Backend → Paymob** — the backend creates the intention with the **secret
   key** and the persisted **`card_tokens`** (read from `saved-cards.json`), so
   the checkout can offer saved cards.
3. **Paymob → Backend** — returns the intention's `client_secret`.
4. **Backend → App** — returns `clientSecret`, a `reference` for looking the
   result up later, and the `savedCards` list.
5. **App → Paymob** — the native `PaymobCheckoutView` handles card entry and
   3-D Secure directly. The backend is not in this loop.
6. **Paymob → Backend** — two server-to-server callbacks arrive over the
   cloudflared tunnel: `TRANSACTION` (status) and `TOKEN` (saved card). The
   backend correlates them by order id and persists the card to
   `saved-cards.json`.
7. **App → Backend** — the app polls `GET /tx/:reference` for the confirmed
   status and saved card, then shows the result labelled "confirmed by backend".

The top-up screen also lists the saved cards and lets the user **rename** each
one (a nickname is shown in place of the card type), **delete** it, or
**drag to reorder** the list; those changes are persisted through
`PATCH` / `DELETE /saved-cards/:token` and `PUT /saved-cards/order`, so they
also flow into the next intention's card tokens.

## Components

| Component | Role | Responsibility |
| --- | --- | --- |
| Mobile app | Client | Amount entry, saved-card list, embedded checkout, result popup. |
| Backend (`example/server`) | Server | Holds the secret key; creates intentions; receives webhooks; persists cards; serves the result poll. |
| Paymob | Provider | Oman intention API + embedded checkout; sends the authoritative callbacks. |
| `saved-cards.json` | Store | Persists saved-card tokens across restarts (gitignored — holds PII). |
| cloudflared tunnel | Delivery | Exposes the webhook publicly so Paymob can reach `localhost`. |

## Principles

- **The secret key never ships in the app.** Only the backend uses it, and only
  when creating an intention.
- **The webhook is the source of truth.** The in-checkout success callback is
  best-effort UX; order fulfilment and stored tokens follow the server-to-server
  webhook.
- **Two webhooks, correlated by order id.** `TRANSACTION` and `TOKEN` arrive
  separately. The order id is normalized to a string for correlation because
  Paymob sends it as a number in `TRANSACTION.obj.order.id` and a string in
  `TOKEN.obj.order_id`.
- **The poll waits out the token lag.** `TOKEN` trails `TRANSACTION` by a few
  seconds, so the app keeps polling briefly after the status settles before
  showing the saved card.
- **Saved-card tokens pre-load the checkout.** They are passed into the
  intention as `card_tokens`; Paymob silently drops invalid or expired ones.

## Backend endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /intentions` | Create the intention (secret key + `card_tokens`); returns `clientSecret`, `reference`, `savedCards`. |
| `POST /paymob/webhook` | Paymob's `notification_url`; captures the `TRANSACTION` result and `TOKEN` saved card. |
| `GET /tx/:reference` | The result the app polls: status plus saved card. |
| `GET /saved-cards` | Lists the cards persisted from token callbacks. |
| `PATCH /saved-cards/:token` | Set or clear a card's nickname. |
| `DELETE /saved-cards/:token` | Remove a saved card. |
| `PUT /saved-cards/order` | Set the display order (array of tokens). |

## Not production

This is a demo: in-memory transaction results, a local JSON store, test
credentials, and optional HMAC verification. For production, verify the webhook
HMAC on every callback, scope saved cards to the authenticated customer, and use
a real datastore. See [`example/server/README.md`](example/server/README.md) for
running it (including the tunnel requirement).
