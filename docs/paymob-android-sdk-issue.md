# Paymob Android SDK 1.9.2 — embedded checkout issues (overview)

Three independent issues were found with the embedded `PaymobCheckoutView` in
`com.paymob.sdk:Paymob-SDK:1.9.2`. Each has its own standalone, ready-to-file
report so they can be raised separately with Paymob:

| # | Issue | Severity | Report |
| --- | --- | --- | --- |
| 1 | `uiCustomization` and `showAddNewCard` are ignored (default styling; new-card form shown despite scoping) | Medium | [issue 1 — customization](paymob-android-issue-1-embedded-customization.md) |
| 2 | Intermittent `NullPointerException` in `getBinding()` during intention retrieval (crash on render / re-entry) | High | [issue 2 — getBinding crash](paymob-android-issue-2-getbinding-crash.md) |
| 3 | `NullPointerException` in `saveAndPay()` on tapping Pay — **blocks completing a payment** | Blocker | [issue 3 — saveAndPay crash](paymob-android-issue-3-saveandpay-crash.md) |

Common context (in each report):

- The **iOS** SDK applies the same configuration and completes payments without
  crashing — same app, same backend, same intention. Only Android is affected.
- **1.9.2 is the latest** embedded Android SDK Paymob ships: both the upstream
  React Native SDK (vendored 2026-06-16) and the Flutter SDK (updated
  2026-07-04) depend on `com.paymob.sdk:Paymob-SDK:1.9.2`, and it is not on Maven
  Central or JitPack. So there is no newer version to upgrade to; fixes must land
  in a future Paymob release.

Together, issues 2 and 3 mean the embedded checkout cannot reliably render or
complete a payment on Android with 1.9.2. See
[`android-parity-plan.md`](android-parity-plan.md) for how this affects the demo.
