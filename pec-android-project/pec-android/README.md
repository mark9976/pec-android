# PEC — Power Equipment Checkout (Android)

Native Android application for the Power Equipment Checkout system. Built with
Capacitor wrapping the existing PEC handheld web application, providing native
NFC badge scanning, camera access, and offline-first data sync.

## Architecture

```
pec-android/
├── www/                        ← Web assets (your app)
│   ├── index.html
│   ├── css/handheld.css
│   └── js/
│       ├── capacitor-bridge.js ← Native API bridge (camera, preferences)
│       ├── db.js               ← IndexedDB (offline storage)
│       ├── sync.js             ← Server sync engine
│       ├── auth.js             ← Badge + PIN authentication
│       ├── nfc-native.js       ← Overrides Web NFC with Android NFC
│       └── app.js              ← Main UI controller
├── android/                    ← Android Studio project (auto-generated + customized)
│   └── app/src/main/
│       ├── java/com/abarta/pec/
│       │   ├── MainActivity.java   ← NFC foreground dispatch
│       │   └── PecNfcPlugin.java   ← Capacitor NFC plugin
│       ├── AndroidManifest.xml     ← Permissions (NFC, camera, internet)
│       └── res/xml/nfc_tech_filter.xml
├── capacitor.config.ts         ← Capacitor configuration
└── package.json
```

### How NFC Works

Android NFC uses Intents, not the browser's Web NFC API. The flow is:

1. `MainActivity` registers for NFC foreground dispatch in `onResume()`
2. When a tag is tapped, Android delivers an `ACTION_TAG_DISCOVERED` Intent
3. `MainActivity.handleNfcIntent()` extracts the raw tag UID bytes
4. It calls `evaluateJavascript()` to dispatch a `nfc-tag-discovered` custom event
5. `nfc-native.js` listens for that event and resolves the Promise that
   `PecAuth.readNfcBadge()` is waiting on

The tag UID is formatted as colon-separated uppercase hex (e.g. `04:33:15:A2:81:18:90`)
matching the format already used by your CRAW backend.

## Prerequisites

- **Android Studio** (latest stable — Ladybug or newer)
- **JDK 17** (bundled with Android Studio)
- **Node.js 18+** and npm
- **Android SDK** with API level 35 (compileSdk) and API 22+ (minSdk)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Sync web assets into the Android project
npx cap sync android

# 3. Open in Android Studio
npx cap open android
```

In Android Studio: **Run → Run 'app'** with an NFC-capable device connected.

## First Run — Server Configuration

On first launch the app shows a **Settings** screen. Enter:

- **Server URL**: Your CRAW server's PEC module URL
  (e.g. `https://craw.abartacocacola.com/pec`)
- **Device Token**: A mobile auth token from `appsettings.json → MobileAuth → Devices`
  (e.g. `pec-mobile-4d8e1a7c`)

These are persisted in Android SharedPreferences and survive app updates.
You can return to Settings any time from the login screen (gear icon).

## Development Workflow

```bash
# After changing any file in www/:
npx cap sync android          # copies www/ into android/app/src/main/assets/public/

# Or for live-reload during development:
# 1. Serve the www/ folder on your dev machine:
npx serve www -l 8100

# 2. Set the server URL in capacitor.config.ts:
#    server: { url: 'http://YOUR_IP:8100' }

# 3. Run the app — it loads from your dev server
npx cap run android
```

## Building for Google Play Store

### Step 1: Create a Signing Keystore

```bash
keytool -genkeypair \
  -v \
  -keystore android/app/pec-release.keystore \
  -alias pec \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass YOUR_STORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD \
  -dname "CN=ABARTA Coca-Cola Beverages, O=ABARTA, L=Pittsburgh, ST=PA, C=US"
```

⚠️ **Keep this keystore safe.** You need the same keystore for every future update.
If you lose it, you cannot update the app on the Play Store.

### Step 2: Configure Signing

Uncomment the `signingConfigs` block in `android/app/build.gradle` and set
environment variables:

```bash
export KEYSTORE_PASSWORD=YOUR_STORE_PASSWORD
export KEY_PASSWORD=YOUR_KEY_PASSWORD
```

### Step 3: Build the Release AAB

```bash
# Sync latest web assets
npx cap sync android

# Build the Android App Bundle (AAB) — required format for Play Store
cd android
./gradlew bundleRelease
```

The signed AAB will be at:
`android/app/build/outputs/bundle/release/app-release.aab`

### Step 4: Test Locally (optional)

```bash
# Build an APK for direct device testing
cd android
./gradlew assembleRelease

# Install on a connected device
adb install app/build/outputs/apk/release/app-release.apk
```

### Step 5: Publish to Google Play

1. Go to [Google Play Console](https://play.google.com/console)
2. Create a new app → "Power Equipment Checkout"
3. Fill out the store listing:
   - Title: **Power Equipment Checkout**
   - Short description: *Equipment safety inspection and checkout for warehouse operations*
   - Category: **Business** → **Internal/Enterprise**
   - Use `app-icon-512.png` as the Play Store icon
4. Upload the `.aab` file to **Production** (or **Internal Testing** first)
5. Set distribution to **Private** (recommended — restrict to your organization's
   Google Workspace domain via Managed Google Play)
6. Submit for review

### Private Distribution (Recommended)

For an internal corporate app, use **Managed Google Play**:

1. In Play Console → **Setup → Advanced settings → App availability**
2. Set to **Private** and add your organization's Google Workspace domain
3. The app will only be visible to users in your domain
4. Or use **Internal app sharing** for faster testing without review

## Updating the App

```bash
# 1. Make changes to www/ files
# 2. Bump versionCode and versionName in android/app/build.gradle
# 3. Sync and build
npx cap sync android
cd android && ./gradlew bundleRelease

# 4. Upload new AAB to Play Console
```

The `versionCode` must increase with every upload (1, 2, 3, ...).
The `versionName` is the human-readable version (1.0.0, 1.1.0, etc.).

## Permissions

| Permission | Purpose |
|------------|---------|
| `NFC` | Badge scanning for operator login |
| `CAMERA` | Photo capture on checklist failures |
| `INTERNET` | Sync with CRAW server |

## Offline Behavior

The app works fully offline after the first sync:
- Operator roster, equipment, checklists, shifts stored in IndexedDB
- Completed sessions queued in `pendingSessions` store
- Auto-syncs when connectivity is restored
- Periodic sync check every 60 seconds

## Troubleshooting

**"NFC read timed out"**: Make sure NFC is enabled in Android Settings.
The tag must be tapped within 20 seconds.

**"Badge not recognized"**: The app needs to sync operator data first.
Check the sync indicator (green dot = synced, red = error).

**Settings not saving**: The device token in Settings must match a token
in your server's `appsettings.json → MobileAuth → Devices` array.

**Camera not working**: Grant camera permission when prompted. If denied,
go to Android Settings → Apps → PEC → Permissions → Camera → Allow.
