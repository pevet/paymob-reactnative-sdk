# Product specification — App-steered saved-card top-up

|            |                     |
| ---------- | ------------------- |
| Document   | PS-002              |
| Version    | 1.0                 |
| Status     | Implemented (demo)  |
| Platform   | iOS                 |
| Flow       | Saved cards         |

> Scope: this describes the **Saved cards** journey in the demo app
> ([`example/`](../example)) and its supporting backend
> ([`example/server/`](../example/server)). See [`ARCHITECTURE.md`](../ARCHITECTURE.md)
> for how the pieces fit together, and the sibling embedded-checkout journey it
> contrasts with.

## 1. Summary

A returning customer tops up their walletii balance by choosing one of their
previously saved cards straight from the app, without hunting for it inside a
payment form.

In the alternative "Paymob checkout" journey, the embedded element decides how
saved cards are presented and ordered. This journey inverts that: the **app**
presents a single-select list of saved cards and lets the customer choose
before payment begins. The selected token then _scopes_ the Paymob intention so
the checkout opens on exactly that card and collects only its CVV and 3-D Secure
step. It gives the customer a familiar "pay with this card" moment while keeping
every sensitive credential inside Paymob's UI.

> **Why not charge the card silently?** A truly headless token charge was
> prototyped and isn't viable on this integration — Paymob requires the card's
> CVV through its own UI, and it ignores the order of `card_tokens`. A no-CVV
> charge would need a MOTO integration, which this account does not have.
> Scoping the intention to one token is the workaround: the app owns the choice,
> Paymob still owns the secure fields.

## 2. Scope

**In scope**

- Selecting a saved card (or "New card") in-app
- Renaming and deleting saved cards
- Amount entry with quick-add and a live balance preview
- Scoped embedded checkout + result confirmation

**Out of scope**

- Headless / no-CVV token charges (needs MOTO)
- Multi-user card ownership & authentication
- Android (this build targets iOS)
- Reordering cards in this flow (it's a dropdown, not a list)

## 3. Actors & systems

| Actor      | Role in this journey                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Customer   | Enters an amount, picks a saved card or a new card, consents, and completes the CVV / 3-D Secure step.                       |
| Mobile app | Owns card selection and the top-up UI; requests a scoped intention; renders the embedded checkout; confirms the result.      |
| Backend    | Holds the secret key; creates the scoped intention; receives Paymob's webhooks; persists saved cards; answers the poll.      |
| Paymob     | Oman intention API + embedded checkout; collects CVV / 3-D Secure; sends the authoritative transaction and token callbacks.  |

## 4. Preconditions

- **Reachable backend** — the demo backend is running and publicly reachable
  (via the cloudflared tunnel) so Paymob's webhook can be delivered.
- **Known cards** — zero or more saved cards exist for the customer. Cards are
  created as a by-product of any earlier successful payment that saved a token.
- **Entry point** — the customer has opened the app and chosen **Saved cards**
  on the "how would you like to pay" selector.

## 5. The journey — main flow (happy path)

1. **Choose the flow** _(Customer)_ — from the top-up selector the customer taps
   **Saved cards**, opening the top-up screen in its app-steered variant.
2. **Enter an amount** _(Customer)_ — the customer types an amount (OMR, up to 3
   decimals) or taps a quick-add chip (`+5`, `+10`, `+15`, `+20`). The balance
   preview updates live as the amount changes.
3. **Pick a card** _(Customer · App)_ — the **Pay with** dropdown shows the
   pre-selected card (the first saved card, or "New card" if none exist). Opening
   it reveals all saved cards plus a "New card" option; the customer selects one
   and the dropdown collapses to show the choice.
4. **Consent & continue** _(Customer)_ — the customer ticks the secure-redirect
   consent and taps **Continue**. The button is enabled only when the amount is
   positive, a card is selected, and consent is given.
5. **Create a scoped intention** _(App → Backend → Paymob)_ — the app calls
   `POST /intentions` with the amount and the chosen token as
   `cardTokens: [token]`. The backend creates the Paymob intention with the
   secret key, scoped to that one card, and returns a `clientSecret` and a
   `reference`.
6. **Pay in the scoped element** _(Customer · Paymob)_ — the embedded checkout
   mounts showing **only the chosen card** (the add-new-card form is hidden). The
   customer enters the CVV and completes 3-D Secure directly with Paymob.
7. **Confirm via the webhook** _(Paymob → Backend · App)_ — on success the app
   shows a "Payment in progress" overlay and polls `GET /tx/:reference` while
   Paymob's `TRANSACTION` and `TOKEN` webhooks reach the backend. The overlay is
   replaced by a result popup — success (with the saved card, when returned),
   failed, or pending.
8. **Return to start** _(Customer · App)_ — confirming the result popup resets
   the amount, selection, and consent and returns the customer to the flow
   selector, ready for the next top-up.

## 6. Card selection — the dropdown

Card selection is a single-select dropdown, not a radio list — the current
choice stays visible while the rest of the screen (amount, consent) does its job.

- **Closed state** — shows the selected card (brand mark, its nickname or type,
  and last-4), or "+ New card", or "Select a card" if nothing is chosen yet.
- **Open state** — lists every saved card with a ✓ on the current choice, plus a
  "+ New card" row at the bottom. Choosing a row selects it and closes the panel.
- **Manage a card** — each card row carries an edit (✎) action to rename (a
  nickname replaces the card type on screen) or delete it. Changes persist to the
  backend.
- **Pre-selection** — on open, the first saved card is pre-selected. With no
  saved cards, "New card" is pre-selected so the customer can still pay.

## 7. Business rules

| ID   | Rule                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| BR-1 | Selecting a saved card scopes the intention to that single token (`card_tokens = [token]`), so the element shows only that card. |
| BR-2 | Selecting "New card" scopes the intention to _no_ saved cards (`card_tokens = []`), so the element shows the new-card form.       |
| BR-3 | **Continue** is enabled only when amount > 0 _and_ a card (or "New card") is selected _and_ the consent box is ticked.            |
| BR-4 | The secret key never leaves the backend; the app only ever sends an amount and an optional token to `/intentions`.               |
| BR-5 | The webhook is the source of truth. The in-element success callback is best-effort UX; the confirmed result comes from the backend. |
| BR-6 | Amounts are Omani Rial (OMR), formatted to 3 decimal places; the decimal separator may be entered as "." or ",".                 |
| BR-7 | Renaming or deleting a card persists immediately and affects which tokens are available to future intentions.                    |

## 8. Alternate & exception flows

| Condition                  | Behaviour                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| No saved cards             | The dropdown pre-selects "New card"; on Continue the intention is unscoped and the element shows the new-card form. A newly saved card is captured via the token webhook for next time. |
| Payment fails              | The result popup reads "Payment failed" with the reason when available; confirming returns to the flow selector. No balance change.        |
| Payment pending            | The result popup reads "Payment pending"; the transaction is still being processed. Confirming returns to the flow selector.               |
| Token webhook lags         | The `TOKEN` callback trails `TRANSACTION` by a few seconds. The app keeps polling briefly after the status settles so the saved card can still appear. |
| Webhook not yet confirmed  | If the poll times out, the app shows the device-side result labelled "webhook pending" rather than blocking the customer.                  |
| Intention cannot be created| An alert explains the payment could not be started; the customer stays on the top-up screen to retry.                                      |
| Customer backs out         | "Start over" on the checkout, or the back chevron on top-up, discards the in-progress selection and returns to the selector.               |

## 9. Data & interfaces

| Interface                    | Purpose in this journey                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /intentions`           | Create the scoped intention. Body carries the amount and `cardTokens`: one token for a saved card, empty for "New card". Returns `clientSecret`, `reference`, `savedCards`. |
| `GET /saved-cards`           | Loads the cards shown in the dropdown when the top-up screen opens.                                                                   |
| `PATCH /saved-cards/:token`  | Sets or clears a card's nickname.                                                                                                     |
| `DELETE /saved-cards/:token` | Removes a saved card.                                                                                                                 |
| `POST /paymob/webhook`       | Paymob's callback target; captures the transaction result and the saved-card token, correlated by order id.                          |
| `GET /tx/:reference`         | The result the app polls after payment: confirmed status plus the saved card.                                                        |

## 10. Acceptance criteria

- [ ] Choosing "Saved cards" opens the top-up screen with a card dropdown, not a radio list.
- [ ] With saved cards present, the first is pre-selected and visible on the closed dropdown.
- [ ] With no saved cards, "New card" is pre-selected and the customer can still complete a payment.
- [ ] Selecting a saved card and continuing opens the checkout showing _only_ that card, prompting for CVV.
- [ ] Selecting "New card" and continuing opens the checkout on the new-card form.
- [ ] Continue stays disabled until amount > 0, a selection exists, and consent is ticked.
- [ ] A "Payment in progress" overlay is shown while backend confirmation is awaited, then replaced by a result popup.
- [ ] On success, when a saved card is returned it is shown on the result popup.
- [ ] Renaming a card shows the nickname in the dropdown; deleting removes it and clears it if it was selected.
- [ ] Confirming any result popup returns the customer to the flow selector with a clean state.

---

**Not production.** This specification describes the demo implementation — in-memory
results, a local card store, and test credentials. A production build would
authenticate the customer, scope saved cards to that customer, and verify every
webhook's HMAC.
