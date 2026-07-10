# Paymob Android SDK 1.9.2 — intermittent `NullPointerException` during intention retrieval

Report for Paymob support / the `Paymob-SDK` Android maintainers. One of three
independent issues found with the embedded `PaymobCheckoutView`; see
[the overview](paymob-android-sdk-issue.md) for the full set. The iOS SDK does
not crash on the same flow.

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

Entering the embedded checkout intermittently crashes the app ~1–2 seconds
after `setPaymentKeys(...)`, i.e. when the intention finishes loading. It is a
race: the same flow often renders fine, but crashes on some attempts. It is most
reproducible when the view is re-mounted (e.g. leaving the checkout and
re-entering it).

## Stack trace

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

## Diagnosis

`retrieveIntention` emits a state; the `observeStates` collector then reads
`getBinding()` (`PaymobCheckoutView.kt:66`), which returns null — the view's
`ViewBinding` has already been cleared (view detached from window) by the time
the asynchronous emission arrives. The state collection is not cancelled when the
view detaches, and/or `getBinding()` is dereferenced without a null check.

## Impact & likely cause

The embedded `PaymobCheckoutView` is hosted inside a React Native view tree,
which attaches/detaches and re-lays-out children during normal operation. When
the intention result is emitted during a transient detach, the collector
dereferences a null binding and the process is killed.

Host-side mitigation only narrows the window: removing a `ScrollView` around the
view (to reduce layout churn) cut the crash rate on first entry but did not
eliminate it, and the crash still fires reliably on re-entry.

## Steps to reproduce

1. Create an intention (Oman) and mount the embedded `PaymobCheckoutView`.
2. Call `configure(...)` then `setPaymentKeys(publicKey, clientSecret)`.
3. Observe the checkout for ~1–2s while the intention loads.
4. Leave the checkout and re-enter it (re-mount the view) a few times.
5. Observe: on some attempts the process crashes with the stack above; on others
   the element renders normally.

## Suggested fix (SDK side)

- Cancel the `observeStates` collection when the view detaches
  (`onDetachedFromWindow`) / tie it to the view's lifecycle, and/or
- null-check the binding in the collector before use.

## Question for Paymob

- Is the embedded `PaymobCheckoutView` supported when hosted in a view tree that
  may detach/reattach it (e.g. React Native)? The `getBinding()` dereference in
  the `observeStates` collector assumes the view is still attached when the
  intention result arrives.
