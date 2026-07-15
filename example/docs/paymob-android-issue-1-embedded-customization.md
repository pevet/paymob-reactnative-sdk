# Paymob Android SDK 1.9.2 — embedded `uiCustomization` / `showAddNewCard` not applied

Report for Paymob support / the `Paymob-SDK` Android maintainers. One of three
independent issues found with the embedded `PaymobCheckoutView`; see
[the overview](paymob-android-sdk-issue.md) for the full set. The iOS SDK applies
the same configuration correctly.

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

## Questions for Paymob

1. Are `uiCustomization` and `showAddNewCard` supported on the embedded
   `PaymobCheckoutView` in 1.9.2, and in what call order relative to
   `setPaymentKeys`?
2. Is there a newer `Paymob-SDK` version where embedded customization/scoping is
   honored on Android?
