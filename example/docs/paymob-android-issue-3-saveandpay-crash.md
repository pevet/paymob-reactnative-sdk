# Paymob Android SDK 1.9.2 — `NullPointerException` in `saveAndPay` when tapping Pay (new card)

Report for Paymob support / the `Paymob-SDK` Android maintainers. One of three
independent issues found with the embedded `PaymobCheckoutView`; see
[the overview](paymob-android-sdk-issue.md) for the full set. This one **blocks
completing a payment** on Android. The iOS SDK completes the same payment.

## Environment

| | |
| --- | --- |
| SDK | `com.paymob.sdk:Paymob-SDK:1.9.2` (Android, embedded `PaymobCheckoutView`) |
| Integration | Oman intention API, MIGS/MPGS gateway |
| React Native | 0.75.4 (old architecture; Hermes) |
| Device | Android emulator, API 35 (arm64), Pixel 7 profile |
| Build | AGP/Gradle for RN 0.75, JDK 17, compileSdk/targetSdk 35 |

**Version note:** 1.9.2 is the latest embedded Android SDK Paymob ships — the
upstream React Native SDK (vendored 2026-06-16) and the Flutter SDK (updated
2026-07-04) both depend on `com.paymob.sdk:Paymob-SDK:1.9.2`, and the artifact is
not published to Maven Central or JitPack (both 404). So there is no newer
version to upgrade to; a fix must land in a future Paymob release.

## Summary

Entering a card in the embedded new-card form and tapping **Pay** crashes
synchronously (on the click, before 3-D Secure). This is not a race — it
reproduces every time Pay is tapped on the new-card form.

## Stack trace

```
FATAL EXCEPTION: main
java.lang.NullPointerException
    at com.paymob.paymob_sdk.ui.embedded.new_card.NewCardEmbeddedView.saveAndPay(NewCardEmbeddedView.kt:516)
    at com.paymob.paymob_sdk.ui.embedded.PaymobCheckoutView.setClickListener$lambda$1(PaymobCheckoutView.kt:192)
    at android.view.View.performClick(View.java:8028)
    at com.google.android.material.button.MaterialButton.performClick(MaterialButton.java:1218)
    ...
```

## Diagnosis

At `NewCardEmbeddedView.kt:516` the code runs
`viewModel.payCard(paymentMethod.getKey(), tenure)` with an
`Intrinsics.checkNotNull(paymentMethod)` immediately before it — so the crash is
`this.paymentMethod` (a `PaymentMethod`) being **null** at Pay time. The SDK
never populated the new-card view's `paymentMethod`, then dereferences it.

## Payload (looks correct; iOS accepts it)

The intention is created with a card integration and full billing data:

```
payment_methods: [70072]      // Oman card (MIGS/MPGS) integration
currency: "OMR"
billing_data: { first_name, last_name, phone_number, email }
card_tokens: [ ...saved-card tokens... ]   // embedded flow offers saved cards + new card
```

The same intention completes payment on the iOS SDK. Only the Android SDK leaves
`paymentMethod` null and crashes.

## Steps to reproduce

1. Create an intention (Oman) with `payment_methods: [<card integration id>]`
   and valid `billing_data`.
2. Mount the embedded `PaymobCheckoutView`, `configure(...)`, then
   `setPaymentKeys(...)`.
3. In the new-card form, enter a test card (number / expiry / CVV).
4. Tap **Pay**.
5. Observe: immediate crash with the stack above (before any 3-D Secure step).

## Impact

Blocks completing a **new-card** payment in the embedded checkout on Android
entirely. It cannot be worked around from the host app, since `paymentMethod` is
set and read entirely inside the SDK.

## Question for Paymob

- Under what conditions does the embedded new-card view set `paymentMethod`, and
  why would it be null at Pay time for an intention that has a valid card
  integration in `payment_methods`? Does the presence of `card_tokens` (a mixed
  saved-card + new-card checkout) affect new-card `paymentMethod` initialization?
