# Paymob Android SDK — embedded checkout issues (1.9.2)

A ready-to-file report for Paymob support / the `Paymob-SDK` Android maintainers,
covering three issues with the embedded `PaymobCheckoutView`:

1. `uiCustomization` and `showAddNewCard` are not applied (below).
2. An intermittent `NullPointerException` crash during intention retrieval
   ([Issue 2](#issue-2--intermittent-nullpointerexception-during-intention-retrieval)).
3. A `NullPointerException` in `saveAndPay` when tapping Pay on a new card, which
   blocks completing a payment
   ([Issue 3](#issue-3--nullpointerexception-in-saveandpay-when-tapping-pay-new-card)).

The iOS SDK applies the same configuration correctly and completes payments
without crashing; only Android is affected.

**Version note:** 1.9.2 is the latest embedded Android SDK Paymob ships — the
upstream React Native SDK (vendored 2026-06-16) and the Flutter SDK (updated
2026-07-04) both depend on `com.paymob.sdk:Paymob-SDK:1.9.2`, and the artifact is
not published to Maven Central or JitPack (both 404). So there is no newer
version to upgrade to; both issues need a fix in a future Paymob release.

## Issue 1 — `uiCustomization` / `showAddNewCard` not applied

## Environment

| | |
| --- | --- |
| SDK | `com.paymob.sdk:Paymob-SDK:1.9.2` (Android, embedded `PaymobCheckoutView`) |
| Integration | Oman intention API, MIGS/MPGS gateway |
| React Native | 0.75.4 (old architecture; Hermes) |
| Device | Android emulator, API 35 (arm64), Pixel 7 profile |
| Build | AGP/Gradle for RN 0.75, JDK 17, compileSdk/targetSdk 35 |

## Summary

When the embedded `PaymobCheckoutView.configure(...)` is called with a
`uiCustomization` JSON string and `showAddNewCard = false`, the checkout element
renders with **default** styling and **ignores** `showAddNewCard`:

- the payment button stays the default blue and reads **"Pay"** instead of the
  customized color (`colorPrimary`) and title (`paymentButtonTitle`);
- the container/background color (`colorContainer`) is not applied;
- with `showAddNewCard = false` and an intention scoped to a single saved-card
  token, the element still shows the **new-card entry form** rather than the
  single saved card.

No exception is thrown and no JSON parse error is logged.

## Configuration sent

`configure` is called with:

```json
{
  "uiCustomization": "{\"colorContainer\":\"#FFF8E1\",\"colorPrimary\":\"#07F0D7\",\"colorDisabled\":\"#C7CDD1\",\"textColorForPaymentButton\":\"#051926\",\"radiusBorder\":\"8\",\"paymentButtonTitle\":\"Continue\"}",
  "showAddNewCard": false,
  "showSaveCard": true,
  "saveCardByDefault": false,
  "payFromOutside": false
}
```

The keys match the AAR's `com.paymob.paymob_sdk.ui.embedded.customization.UiCustomizationEmbedded`
field names (`colorContainer`, `colorPrimary`, `colorDisabled`,
`textColorForPaymentButton`, `radiusBorder`, `paymentButtonTitle`, …).

## Evidence the values reach the SDK

The native call is confirmed to run with the expected arguments (logged
immediately before `checkoutView.configure(...)`):

```
D PaymobCheckoutRN: receiveCommand(str=configure, hasArgs=true)
D PaymobCheckoutRN: configure: activity=true uiCustomization=true showAddNewCard=false showSaveCard=true
D PaymobCheckoutRN: receiveCommand(str=setPaymentKeys, hasArgs=true)
```

So the host app passes a non-null `uiCustomization` and `showAddNewCard=false`
into `PaymobCheckoutView.configure(...)`; the SDK accepts them without error but
does not reflect them in the rendered UI.

## Steps to reproduce

1. Create an intention (Oman) scoped to a single saved-card `card_token`.
2. Mount the embedded `PaymobCheckoutView`.
3. Call `configure(...)` with the payload above (custom colors/title,
   `showAddNewCard = false`).
4. Call `setPaymentKeys(publicKey, clientSecret)`.
5. Observe: default blue **"Pay"** button, default background, and the new-card
   form is shown despite `showAddNewCard = false`.

## Expected vs actual

| | Expected | Actual (Android 1.9.2) |
| --- | --- | --- |
| Button color | `#07F0D7` (`colorPrimary`) | default blue |
| Button title | "Continue" (`paymentButtonTitle`) | "Pay" |
| Background | `#FFF8E1` (`colorContainer`) | default white |
| `showAddNewCard=false` | show only the scoped saved card | new-card form shown |

On the **iOS** SDK, the equivalent configuration (with iOS's
`Title_Case_With_Underscores` keys) applies correctly — same app, same
intention, same flow.

## Ruled out

- Not a JSON parse failure — no `JsonSyntaxException`/error logged; keys match
  the SDK's `UiCustomizationEmbedded` fields.
- Not a bridge/plumbing issue — the values are confirmed present at the
  `configure(...)` call site (see log above).
- Not activity context — `currentActivity` is a non-null `ComponentActivity`.

## Issue 2 — intermittent `NullPointerException` during intention retrieval

Entering the embedded checkout intermittently crashes the app ~1–2 seconds
after `setPaymentKeys(...)`, i.e. when the intention finishes loading. It is a
race: the same flow often renders fine, but crashes on some attempts.

### Stack trace

```
FATAL EXCEPTION: main
Process: <app>, PID: ####
java.lang.NullPointerException
    at com.paymob.paymob_sdk.ui.embedded.PaymobCheckoutView.getBinding(PaymobCheckoutView.kt:66)
    at com.paymob.paymob_sdk.ui.embedded.PaymobCheckoutView.access$getBinding(PaymobCheckoutView.kt:48)
    at com.paymob.paymob_sdk.ui.embedded.PaymobCheckoutView$observeStates$2$1.emit(PaymobCheckoutView.kt:150)
    at com.paymob.paymob_sdk.ui.embedded.PaymobCheckoutView$observeStates$2$1.emit(PaymobCheckoutView.kt:135)
    at kotlinx.coroutines.flow.StateFlowImpl.collect(StateFlow.kt:401)
    ...
    at com.paymob.paymob_sdk.ui.embedded.PaymobCheckoutViewModel$retrieveIntention$1.invokeSuspend(PaymobCheckoutViewModel.kt:30)
```

### Diagnosis

`retrieveIntention` emits a state; the `observeStates` collector then reads
`getBinding()` (`PaymobCheckoutView.kt:66`), which returns null — the view's
`ViewBinding` has already been cleared (view detached from window) by the time
the asynchronous emission arrives. The state collection is not cancelled when the
view detaches, and/or `getBinding()` is dereferenced without a null check.

### Impact & likely cause

The embedded `PaymobCheckoutView` is hosted inside a React Native view tree,
which attaches/detaches and re-lays-out children during normal operation. When
the intention result is emitted during a transient detach, the collector
dereferences a null binding and the process is killed.

### Suggested fix (SDK side)

- Cancel the `observeStates` collection when the view detaches
  (`onDetachedFromWindow`) / tie it to the view's lifecycle, and/or
- null-check the binding in the collector before use.

## Issue 3 — `NullPointerException` in `saveAndPay` when tapping Pay (new card)

Entering a card in the embedded new-card form and tapping **Pay** crashes
synchronously (on the click, before 3-D Secure):

```
FATAL EXCEPTION: main
java.lang.NullPointerException
    at com.paymob.paymob_sdk.ui.embedded.new_card.NewCardEmbeddedView.saveAndPay(NewCardEmbeddedView.kt:516)
    at com.paymob.paymob_sdk.ui.embedded.PaymobCheckoutView.setClickListener$lambda$1(PaymobCheckoutView.kt:192)
    at android.view.View.performClick(View.java:8028)
    ...
```

### Diagnosis

At `NewCardEmbeddedView.kt:516` the code runs
`viewModel.payCard(paymentMethod.getKey(), tenure)` with an
`Intrinsics.checkNotNull(paymentMethod)` immediately before it — so the crash is
`this.paymentMethod` (a `PaymentMethod`) being **null** at Pay time. The SDK
never populated the new-card view's `paymentMethod`, then dereferences it.

### Payload (looks correct; iOS accepts it)

The intention is created with a card integration and full billing data:

```
payment_methods: [70072]      // Oman card (MIGS/MPGS) integration
currency: "OMR"
billing_data: { first_name, last_name, phone_number, email }
card_tokens: [ ...saved-card tokens... ]   // embedded flow offers saved cards + new card
```

The same intention completes payment on the iOS SDK. Only the Android SDK leaves
`paymentMethod` null and crashes.

### Impact

This blocks completing a **new-card** payment in the embedded checkout on
Android entirely — it is not an intermittent race like Issue 2; Pay crashes on
the click. It cannot be worked around from the host app, since `paymentMethod` is
set and read entirely inside the SDK.

### Question

- Under what conditions does the embedded new-card view set `paymentMethod`, and
  why would it be null at Pay time for an intention that has a valid card
  integration in `payment_methods`? Does the presence of `card_tokens` (mixed
  saved-card + new-card checkout) affect new-card `paymentMethod` initialization?

## Questions for Paymob

1. Are `uiCustomization` and `showAddNewCard` supported on the embedded
   `PaymobCheckoutView` in 1.9.2, and in what call order relative to
   `setPaymentKeys`?
2. Is there a newer `Paymob-SDK` version where embedded customization/scoping is
   honored and the intention-retrieval crash is fixed on Android?
3. Is the embedded `PaymobCheckoutView` supported when hosted in a view tree that
   may detach/reattach it (e.g. React Native), given the `getBinding()` NPE above?
