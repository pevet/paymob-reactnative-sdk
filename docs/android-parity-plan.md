# Android parity plan — bring Android to the iOS demo's state

|          |                          |
| -------- | ------------------------ |
| Document | PLAN-001                 |
| Status   | Approved — not started   |
| Goal     | Android runs both payment flows at feature parity with iOS |

> Scope: the demo in [`example/`](../example). The published SDK's native
> Android bridge already exists; this plan is about the **example app** and its
> build/runtime wiring. See [`ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`docs/saved-card-flow-spec.md`](saved-card-flow-spec.md) for what "parity"
> means functionally.

## Where things stand

Most of the hard part is already done — the gap is wiring and a few
platform-specific JS details, not native code.

| Layer | Status |
| --- | --- |
| Native embedded SDK bridge (Kotlin) | ✅ Complete — `PaymobCheckoutViewManager` implements `configure` + `setPaymentKeys` and emits `onSuccess/onFailure/onPending`, matching iOS. |
| Paymob Android AAR (`1.9.2`) | ✅ Vendored in `android/libs`, wired via `android/settings.gradle`. |
| Shared app logic (`CheckoutScreen.tsx`, `api/paymob.ts`) | ✅ Cross-platform already — flows, dropdown, polling, result popup reused as-is. |
| Backend (`example/server`) | ✅ Platform-agnostic — no changes needed. |
| Env config on Android | ❌ `react-native-config`'s gradle hook not applied → `Config.*` is empty. |
| Checkout customization keys | ❌ `CUSTOMIZATION` uses iOS `Title_Case` keys → ignored by the Android SDK. |
| App → backend reachability | ❌ `localhost:3000` doesn't resolve from an emulator; cleartext HTTP is blocked by default. |
| Card rename dialog | ❌ `Alert.prompt` is iOS-only → rename silently does nothing on Android. |
| Local toolchain | ⚠️ Android SDK + a Pixel_3a API 30 AVD exist, but `JAVA_HOME` is **JDK 15** (RN 0.75 needs **17**) and `ANDROID_HOME` is unset. |

## How iOS handles each gap today (the target behaviour)

- **Env** — `react-native-config` 1.6.1 is a CocoaPod (autolinked); its build
  phase reads [`example/.env`](../example/.env) and populates `Config.*` with no
  extra setup.
- **Customization** — `CUSTOMIZATION` in
  [`CheckoutScreen.tsx`](../example/src/CheckoutScreen.tsx) is a JSON string with
  the iOS SDK's `Title_Case_With_Underscores` keys.
- **Networking** — the iOS simulator shares the Mac's network, so
  `http://localhost:3000` hits the host backend; `Info.plist` sets
  `NSAllowsArbitraryLoads=false` + `NSAllowsLocalNetworking=true`, permitting that
  local cleartext call. The cloudflared tunnel is only for the Paymob→backend
  webhook (platform-independent).
- **Rename** — `openEditCard` uses `Alert.prompt`, the native iOS text-input
  alert.

## Decisions (locked)

- **D1 — App → backend on Android: `10.0.2.2` + cleartext.**
  `Platform.select` in [`api/paymob.ts`](../example/src/api/paymob.ts) so Android
  defaults to `http://10.0.2.2:3000` (the emulator's alias for the host); iOS
  stays on `localhost`. A **debug-only** `network_security_config.xml` permits
  cleartext to `10.0.2.2` / `localhost`. Chosen for stability across restarts and
  offline use; emulator-scoped, which is fine for the demo.
- **D2 — Sequence: document, then implement.** This doc lands first; code
  follows.

## Plan

### Phase 0 — Local toolchain (prerequisite)
1. Install / point to **JDK 17** (Temurin 17) and export `JAVA_HOME`; RN 0.75 +
   AGP will not build on JDK 15.
2. Export `ANDROID_HOME=~/Library/Android/sdk`; add `platform-tools` and
   `emulator` to `PATH`.
3. Boot an AVD. The existing `Pixel_3a_API_30_x86` is x86 (slow on Apple
   Silicon) — prefer a fresh arm64 image (e.g. `Pixel_7_API_34`).

### Phase 1 — Build & run the example on Android
4. Apply the env gradle hook in `example/android/app/build.gradle`:
   `apply from: project(':react-native-config').projectDir.getPath() + "/dotenv.gradle"`
   — this makes `Config.PAYMOB_PUBLIC_KEY` / `PAYMOB_BACKEND_URL` non-empty.
5. Confirm `paymob-reactnative` autolinks via `PackageList`; if the view/module
   don't register, add the package manually in `MainApplication.kt`.
6. First `yarn android` build; resolve any Kotlin / AGP / Gradle version
   mismatches against RN 0.75's expectations.

### Phase 2 — Networking to the backend (per D1)
7. `Platform.select` the backend base URL in `api/paymob.ts`: Android →
   `http://10.0.2.2:3000`, iOS → `http://localhost:3000` (still overridable by
   `Config.PAYMOB_BACKEND_URL`).
8. Add a debug-only `res/xml/network_security_config.xml` allowing cleartext to
   `10.0.2.2` and `localhost`, referenced from `AndroidManifest.xml`
   (`android:networkSecurityConfig`, debug manifest only).

### Phase 3 — Platform-specific JS
9. **Customization** — make `CUSTOMIZATION` a `Platform.select`. Android map
   (verified against the AAR's `UiCustomizationEmbedded`):

   | iOS key | Android key |
   | --- | --- |
   | `Color_Container` | `colorContainer` |
   | `Color_Primary` | `colorPrimary` |
   | `Color_Disabled` | `colorDisabled` |
   | `Text_Color_For_Payment_Button` | `textColorForPaymentButton` |
   | `Radius_Border` | `radiusBorder` |
   | `Payment_Button_Title` | `paymentButtonTitle` |

10. **Card rename** — replace `Alert.prompt` in `openEditCard` with a small
    cross-platform `Modal` + `TextInput` nickname editor (Modal is already
    imported). Delete can stay on `Alert.alert`.
11. Sweep for other iOS-isms (none major expected — `decimal-pad`, the RTL rial
    isolate, and font weights all work on Android).

### Phase 4 — Parity verification
12. Run the acceptance checklist in
    [`docs/saved-card-flow-spec.md`](saved-card-flow-spec.md) §10 on Android for
    **both** flows (embedded checkout and app-steered saved cards).
13. Confirm end-to-end: scoped intention → CVV / 3-D Secure in the element →
    `TRANSACTION` + `TOKEN` webhooks captured → result popup shows the saved
    card; then rename / delete persist.
14. Verify the embedded element picks up the teal/yellow theming and "Continue"
    label (the point of the camelCase fix in step 9).

## Risks & notes

- **JDK 17** is a hard prerequisite; the machine currently has JDK 15.
- The x86 AVD will be slow on Apple Silicon; an arm64 image is worth the setup.
- `network_security_config` must stay **debug-only** so release builds keep
  cleartext disabled.
- Android drag-to-reorder (embedded flow) uses `PanResponder` + `Animated` —
  already cross-platform, but worth a specific check on a touch device.
