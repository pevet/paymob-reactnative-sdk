# Running the demo on the iOS simulator

How to run the full demo locally: the Cloudflare tunnel, the backend, Metro, and
the app on an iPhone simulator. Focused on **iOS** (see the last section for the
Android emulator differences).

## What you run, and why the tunnel

Four processes:

| Process | Port | Role |
| --- | --- | --- |
| **cloudflared tunnel** | → 3000 | Gives the backend a **public HTTPS URL** so Paymob's webhook can reach it |
| **Backend** (`example/server`) | 3000 | Creates intentions, receives the webhook, serves the result poll |
| **Metro** | 8081 | Serves the app's JS bundle to the simulator |
| **App** | — | Runs in the iPhone simulator |

Two different network hops, which is the thing to keep straight:

- **App → backend** uses `http://localhost:3000`. The iOS simulator shares the
  Mac's network, so localhost works (allowed by `NSAllowsLocalNetworking`). **No
  tunnel involved here.**
- **Paymob → backend** (the `TRANSACTION` / `TOKEN` webhooks) comes from the
  public internet and can't reach `localhost` — that's the **only** reason for the
  tunnel. Paymob is told to call `<tunnel-url>/paymob/webhook`.

## Prerequisites

- Node 18+ and Yarn
- Xcode with an iOS simulator (this guide uses **iPhone 17**)
- CocoaPods (for the iOS native build)
- `cloudflared` — `brew install cloudflared`
- Dependencies installed: `yarn install` at the repo root (and the backend's:
  `cd example/server && npm install`)

## One-time setup: env files

Both are gitignored — create them if missing.

`example/.env` (the app):
```
PAYMOB_PUBLIC_KEY=omn_pk_test_xxxxxxxxxxxxxxxxxxxxxxxx
PAYMOB_BACKEND_URL=http://localhost:3000
```

`example/server/.env` (the backend):
```
PAYMOB_SECRET_KEY=omn_sk_test_xxxxxxxxxxxxxxxxxxxxxxxx
PAYMOB_HMAC_SECRET=
PUBLIC_URL=http://localhost:3000
PORT=3000
```
`PUBLIC_URL` is a placeholder here — step 2 replaces it with the tunnel URL each
run. `PAYMOB_HMAC_SECRET` may be left empty for the demo (webhook HMAC
verification is then skipped).

## Step by step

### 1. Start the Cloudflare tunnel
```
cloudflared tunnel --url http://localhost:3000
```
It prints a URL like `https://<random-words>.trycloudflare.com`. Copy it. Leave
this running.

> Quick tunnels are **ephemeral — the URL changes every time you start one.** So
> steps 2–3 must be redone whenever you restart the tunnel.

### 2. Wire the tunnel URL into the backend
Set `PUBLIC_URL` in `example/server/.env` to the URL from step 1:
```
PUBLIC_URL=https://<random-words>.trycloudflare.com
```
The backend builds its `notification_url` (`<PUBLIC_URL>/paymob/webhook`) from
this at startup, so it must be set **before** the backend starts (or restart the
backend after changing it).

### 3. Start the backend
```
cd example/server
npm start
```
It logs `notification_url -> https://<random-words>.trycloudflare.com/paymob/webhook`.
Confirm that matches your tunnel.

### 4. Start Metro
In a new terminal, from `example/`:
```
yarn start
```

### 5. Build & run the app on the simulator
In a new terminal, from `example/`:
```
yarn ios --simulator "iPhone 17"
```
First run builds the native app (installs Pods, compiles) and can take a few
minutes; later runs are fast. Once installed, the app connects to Metro and loads.

## Verify it's working

```
# backend reachable locally and publicly
curl -s -o /dev/null -w "local %{http_code}\n"  http://localhost:3000/
curl -s -o /dev/null -w "public %{http_code}\n" https://<random-words>.trycloudflare.com/

# Metro up
curl -s http://localhost:8081/status        # -> packager-status:running
```
In the app you should land on the **Top up** flow selector. A completed payment's
result comes back through the webhook → the tunnel → the backend, which the app
then reads via its result poll.

## Stopping everything

```
lsof -ti tcp:3000 | xargs kill -9      # backend
lsof -ti tcp:8081 | xargs kill -9      # Metro
pkill -f "cloudflared tunnel"          # tunnel
```
The simulator can be left running or quit from the Simulator app.

## Troubleshooting

- **Tunnel URL changed / webhooks stopped arriving** — you restarted the tunnel.
  Redo steps 2–3 (update `PUBLIC_URL`, restart the backend).
- **`pod install` fails with a Unicode/locale error** (Ruby 3.4+) — run it with an
  explicit UTF-8 locale, then use `yarn ios` again:
  `cd example/ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install`.
- **`Config.PAYMOB_PUBLIC_KEY` is empty in the app** — `example/.env` is missing
  or the app was built before it existed; recreate it and rebuild (`yarn ios`).
- **App can't reach the backend** — the backend isn't on `localhost:3000`, or
  `PAYMOB_BACKEND_URL` in `example/.env` was overridden. The tunnel is *not* used
  for the app→backend hop; don't point `PAYMOB_BACKEND_URL` at it.
- **Soft keyboard behavior in the sim** — toggle the hardware keyboard from the
  Simulator's I/O menu (or `⌘⇧K`) if on-screen typing behaves unexpectedly.

## Android (emulator) — what differs

The same tunnel/backend/Metro apply, with two changes: the app reaches the host
backend at **`http://10.0.2.2:3000`** (not `localhost`), and the env/networking is
wired per [`android-parity-plan.md`](android-parity-plan.md). Note the **embedded
checkout is currently broken on Android** (Paymob SDK 1.9.2 — see
[`paymob-android-sdk-issue.md`](paymob-android-sdk-issue.md)), so end-to-end
payment testing is iOS-only for now.
