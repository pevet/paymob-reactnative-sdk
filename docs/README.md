# Documentation

Docs for the **walletii payments demo** — the React Native example app in
[`example/`](../example) and its backend in [`example/server/`](../example/server),
built on the `paymob-reactnative` SDK. The demo covers a wallet top-up with two
payment journeys (embedded Paymob checkout and an app-steered saved-card flow),
saved-card management, and webhook-confirmed results.

New here? Read in this order: **Run the demo → Architecture → the guide for your
side (backend or frontend)**.

## Start here

| Doc | What it's for |
| --- | --- |
| [Running the demo](running-the-demo.md) | Step-by-step to run it on the iOS simulator: Cloudflare tunnel, backend, Metro, app — and how the pieces wire together. |
| [Architecture](../ARCHITECTURE.md) | The big picture: the two payment flows, webhook-as-source-of-truth, components, endpoints, and Android platform status. |

## Implementation guides

| Doc | Audience |
| --- | --- |
| [Backend implementation guide](backend-implementation-guide.md) | Backend engineer building the production payments service — API contract, intention creation, webhooks, **authentication & customer scoping**, and production hardening. |
| [Frontend implementation guide](frontend-implementation-guide.md) | Mobile engineer integrating the embedded checkout — the `PaymobCheckoutView` API, the create-intention → configure → confirm flow, platform key-casing, card scoping, and result handling. |

## Specifications

| Doc | What it's for |
| --- | --- |
| [Saved-card flow spec](saved-card-flow-spec.md) | Product / use-case spec for the app-steered saved-card journey — actors, main flow, business rules, and acceptance criteria. |

## Android

| Doc | What it's for |
| --- | --- |
| [Android parity plan](android-parity-plan.md) | Plan and outcome of bringing Android to the iOS demo's state — what works, and the SDK-side limitations that don't. |
| [Paymob Android SDK issues — overview](paymob-android-sdk-issue.md) | Index of the three embedded-checkout defects found in Paymob Android SDK 1.9.2, with severities. |
| ├ [Issue 1 — customization ignored](paymob-android-issue-1-embedded-customization.md) | `uiCustomization` / `showAddNewCard` have no effect (medium). |
| ├ [Issue 2 — `getBinding()` crash](paymob-android-issue-2-getbinding-crash.md) | Intermittent NPE on render / re-entry (high). |
| └ [Issue 3 — `saveAndPay()` crash](paymob-android-issue-3-saveandpay-crash.md) | NPE on tapping Pay — blocks payment (blocker). |

## Related references (outside `docs/`)

| Doc | What it's for |
| --- | --- |
| [SDK README](../README.md) | Installing and using the `paymob-reactnative` package. |
| [Example app README](../example/README.md) | The example app itself. |
| [Backend README](../example/server/README.md) | Running the demo backend (incl. the tunnel requirement). |

---

> The demo uses test credentials, an in-memory/local store, and optional webhook
> HMAC — it is not a production integration. The implementation guides call out
> what must change for production.
