# Frontend implementation guide — Paymob checkout in the React Native app

|          |                                    |
| -------- | ---------------------------------- |
| Audience | Mobile/frontend engineer integrating the embedded Paymob checkout |
| Status   | Implementation guide                |
| SDK      | `paymob-reactnative` (embedded `PaymobCheckoutView`) |

This describes how the app integrates payments. The app talks **only to your
backend** (never to Paymob directly for creating intentions) and renders Paymob's
**embedded** checkout element for card entry + 3-D Secure. A full reference
implementation lives in [`example/src/CheckoutScreen.tsx`](../src/CheckoutScreen.tsx)
and [`example/src/api/paymob.ts`](../src/api/paymob.ts). See
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) for the end-to-end picture, the
[backend guide](backend-implementation-guide.md) for the service side, and the
[saved-card spec](saved-card-flow-spec.md) for the journeys.

## 1. What the app is responsible for

1. **Collect the amount** and let the customer pick a saved card or a new card.
2. **Ask the backend to create an intention** (`POST /intentions`) — send only an
   amount (and an optional card-token scope). Nothing sensitive leaves the device.
3. **Render the embedded `PaymobCheckoutView`**, configure it, and hand it the
   `publicKey` + `clientSecret`. Card number / CVV / 3-D Secure happen **inside
   Paymob's element** — the app never sees them.
4. **Confirm the result from the backend** (poll `GET /tx/:reference`), which is
   the source of truth. The in-element success callback is best-effort UX only.
5. **Manage saved cards** through the backend (list / rename / delete / reorder).

## 2. Prerequisites

- **Public key** (`*_pk_*`) — safe to ship; used with the `clientSecret` to start
  the element. Store it in config (the example reads `Config.PAYMOB_PUBLIC_KEY`
  via `react-native-config`), **not** the secret key.
- **Backend base URL** — where `/intentions`, `/tx/:reference`, and the
  saved-card endpoints live.
- The native SDK linked (see §7 for the iOS vs Android setup notes).

## 3. The embedded component API

From `paymob-reactnative`:

```tsx
import {
  PaymobCheckoutView,
  type PaymobCheckoutViewRef,
} from 'paymob-reactnative';
```

**Props** (`PaymobCheckoutViewProps extends ViewProps`):
- `onSuccess(event)` — payment succeeded (in-element; confirm via backend).
- `onFailure(event)` — `event.nativeEvent.error` may carry a reason.
- `onPending(event)` — payment is processing.
- plus normal `style` etc.

**Ref methods** (`PaymobCheckoutViewRef`):
- `configure(config?)` — call **once** before `setPaymentKeys`. Config:
  `{ uiCustomization?: string, showAddNewCard?: boolean, showSaveCard?: boolean, saveCardByDefault?: boolean, payFromOutside?: boolean }`.
- `setPaymentKeys({ publicKey, clientSecret })` — sets the keys and **starts** the
  payment flow (triggers intention retrieval + render).

## 4. The integration flow

```tsx
const checkoutRef = useRef<PaymobCheckoutViewRef>(null);
const [clientSecret, setClientSecret] = useState<string | null>(null);
const referenceRef = useRef<string | null>(null);

// 1. On "Pay": ask the backend to create the intention, then mount the element.
async function startCheckout(amount: number, cardTokens?: string[]) {
  const { clientSecret, reference } = await createIntention(amount, cardTokens);
  referenceRef.current = reference;
  setClientSecret(clientSecret); // mounts <PaymobCheckoutView/>
}

// 2. Once mounted, configure it, then set the keys to start.
useEffect(() => {
  if (!clientSecret) return;
  checkoutRef.current?.configure({
    uiCustomization: JSON.stringify(CUSTOMIZATION), // see §5
    showAddNewCard: true,   // see §6
    showSaveCard: true,
    saveCardByDefault: false,
    payFromOutside: false,
  });
  checkoutRef.current?.setPaymentKeys({ publicKey, clientSecret });
}, [clientSecret]);

// 3. Render.
{clientSecret && (
  <PaymobCheckoutView
    ref={checkoutRef}
    style={{ width: '100%' }}
    onSuccess={handleSuccess}
    onFailure={handleFailure}
    onPending={handlePending}
  />
)}
```

**Order matters:** `configure()` first, then `setPaymentKeys()`. The element
mounts only once you have a `clientSecret`, so gate rendering on it.

## 5. Customization — mind the platform key casing

`uiCustomization` is a **JSON string**, and the two native SDKs decode
**different key formats** — this is the single biggest footgun:

- **iOS** → `Title_Case_With_Underscores` (`Color_Primary`,
  `Text_Color_For_Payment_Button`, `Payment_Button_Title`, `Radius_Border`, …).
- **Android** → camelCase (`colorPrimary`, `textColorForPaymentButton`,
  `paymentButtonTitle`, `radiusBorder`, …).

Key it per platform:

```tsx
const CUSTOMIZATION = Platform.select<Record<string, string>>({
  ios: {
    Color_Container: '#FFF8E1', Color_Primary: '#07F0D7',
    Color_Disabled: '#C7CDD1', Text_Color_For_Payment_Button: '#051926',
    Radius_Border: '8', Payment_Button_Title: 'Continue',
  },
  default: { // Android
    colorContainer: '#FFF8E1', colorPrimary: '#07F0D7',
    colorDisabled: '#C7CDD1', textColorForPaymentButton: '#051926',
    radiusBorder: '8', paymentButtonTitle: 'Continue',
  },
});
```
Colors are hex strings; sizes/radius/weights are passed as strings too. The full
key list is in [`src/index.d.ts`](../../src/index.d.ts)
(`PaymobEmbeddedCustomization`).

## 6. Scoping which cards the checkout offers

The set of cards shown is driven by the intention's `card_tokens` (chosen on the
backend from what you pass to `createIntention`) plus `showAddNewCard`:

| Goal | `createIntention(amount, …)` | `configure` |
| --- | --- | --- |
| Offer all saved cards + new card | `createIntention(amount)` | `showAddNewCard: true` |
| Only one specific saved card | `createIntention(amount, [token])` | `showAddNewCard: false` |
| New card only | `createIntention(amount, [])` | `showAddNewCard: true` |

This is how the app-driven "Saved cards" flow scopes the element to the single
card the user picked while still collecting its CVV inside Paymob's UI.

## 7. Result handling — backend is the source of truth

Treat the in-element callbacks as UX hints and confirm via the backend:

```tsx
async function handleSuccess(event) {
  // Read nativeEvent synchronously — RN pools/nullifies synthetic events,
  // so grab what you need BEFORE any await (or call event.persist()).
  const inAppCard = extractSavedCard(event?.nativeEvent);

  setProcessing(true); // show a "payment in progress" overlay
  const result = await pollBackendResult(referenceRef.current); // GET /tx/:reference
  setProcessing(false);

  showResult(result?.status ?? 'Success', result?.savedCard ?? inAppCard);
}
```
Poll `GET /tx/:reference` until a terminal status (`Success`/`Failed`/`Pending`)
lands. The saved-card `TOKEN` webhook trails the `TRANSACTION` one by a few
seconds, so keep polling briefly after the status settles to pick up the card.
See `pollBackendResult` in [`CheckoutScreen.tsx`](../src/CheckoutScreen.tsx).

## 8. Saved-card management

All via the backend (see the [backend guide](backend-implementation-guide.md) §3);
the app just calls and re-renders:

- `getSavedCards()` → `GET /saved-cards`
- `updateSavedCard(token, nickname)` → `PATCH /saved-cards/:token`
- `deleteSavedCard(token)` → `DELETE /saved-cards/:token`
- `reorderSavedCards(tokens)` → `PUT /saved-cards/order`

Show `cardType` (or `nickname` when set) and the last-4 derived from `maskedPan`.
Use a cross-platform `Modal` + `TextInput` for renaming — `Alert.prompt` is
iOS-only.

## 9. Platform setup & known issues

- **Networking to a local backend:** the iOS simulator reaches the host at
  `localhost`; the Android emulator uses `10.0.2.2`. `Platform.select` the base
  URL (see [`api/paymob.ts`](../src/api/paymob.ts)); debug builds need
  cleartext allowed for the local host.
- **Env (`Config.*`):** iOS gets `react-native-config` via CocoaPods
  automatically; on Android its `dotenv.gradle` hook (and, under some RN
  versions, manual linking) is required.
- **iOS** completes the embedded flow and applies customization correctly.

### Known Paymob Android SDK 1.9.2 bugs (embedded checkout)

Interactive Android testing surfaced **three** defects, all **inside the Paymob
Android AAR** (`com.paymob.paymob_sdk.*`) — none is fixable from the app or the RN
bridge, and iOS is unaffected by all three. Each is written up as a standalone
report filed with Paymob:

- **Bug 1 — customization ignored** (severity: medium). `uiCustomization` and
  `showAddNewCard` have no effect: the button stays the default blue "Pay", the
  container color isn't applied, and the new-card form shows even when the
  intention is scoped to a single card. The RN bridge is confirmed to pass the
  config correctly. → report:
  [`paymob-android-issue-1-embedded-customization.md`](paymob-android-issue-1-embedded-customization.md)
- **Bug 2 — `getBinding()` crash on render/re-entry** (severity: high).
  Intermittent `NullPointerException` in
  `PaymobCheckoutView.getBinding()` ~1–2s after `setPaymentKeys`, when the
  intention finishes loading — most reliably on **Start over → re-enter**. The SDK
  reads its view binding after a transient detach. App-side mitigation (hosting the
  element in a plain `View`, not a `ScrollView`) **reduced but did not eliminate**
  it. → report:
  [`paymob-android-issue-2-getbinding-crash.md`](paymob-android-issue-2-getbinding-crash.md)
- **Bug 3 — `saveAndPay()` crash on Pay** (severity: **blocker**). Tapping **Pay**
  on a new card throws a synchronous `NullPointerException` in
  `NewCardEmbeddedView.saveAndPay()` (the SDK leaves `paymentMethod` null). This
  **blocks completing a payment** and is not app-fixable. → report:
  [`paymob-android-issue-3-saveandpay-crash.md`](paymob-android-issue-3-saveandpay-crash.md)

There is **no newer SDK to upgrade to** — 1.9.2 is the latest Paymob ships (the
upstream RN and Flutter SDKs both pin it; it's not on Maven Central or JitPack),
so all three need an upstream fix. Overview and severities:
[`paymob-android-sdk-issue.md`](paymob-android-sdk-issue.md); demo impact,
mitigation, and decisions: [`android-parity-plan.md`](android-parity-plan.md).
**Plan the Android rollout of the embedded checkout around a fixed SDK release.**

## 10. Reference

- Component usage & flows: [`example/src/CheckoutScreen.tsx`](../src/CheckoutScreen.tsx)
- Backend client: [`example/src/api/paymob.ts`](../src/api/paymob.ts)
- Typed SDK API: [`src/index.d.ts`](../../src/index.d.ts)
- End-to-end architecture: [`ARCHITECTURE.md`](../../ARCHITECTURE.md)
