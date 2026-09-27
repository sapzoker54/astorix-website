# ASTORIX™ iOS Apps — Complete Build Guide (Windows)
## Gensis.AI Inc. | © 2026 All Rights Reserved.
## ✅ WINDOWS-ONLY — No Mac Required

---

## HOW THIS WORKS (No Mac Needed)

You have Windows. Xcode only runs on Mac. BUT:

**GitHub Actions has macOS cloud runners** — the build runs on Apple's cloud, not your laptop.
The workflow: you push code to GitHub → GitHub runs Xcode on a cloud Mac → uploads .ipa to App Store Connect automatically.

You only need a browser (Windows) for everything below.

---

## STEP 1: Create App Store Connect App Listings
*(Do this first — takes 15 minutes, Windows browser only)*

1. Go to **appstoreconnect.apple.com** in your Chrome
2. Log in with your Apple ID: ashreekar@gmail.com
3. Click **+** → **New App**
4. Fill in for each app (repeat 4 times):

### App 1: ASTORIX Signal
- Platform: iOS
- Name: `ASTORIX Signal`
- Primary Language: English (U.S.)
- Bundle ID: `ai.astorix.signal` *(must register this in developer.apple.com first — see Step 0)*
- SKU: `astorix-signal-001`

### App 2: ASTORIX Signal Pro
- Name: `ASTORIX Signal Pro`
- Bundle ID: `ai.astorix.signalpro`
- SKU: `astorix-signalpro-001`

### App 3: ASTORIX CityInfra
- Name: `ASTORIX CityInfra`
- Bundle ID: `ai.astorix.cityinfra`
- SKU: `astorix-cityinfra-001`

### App 4: ASTORIX HOPE-LA
- Name: `ASTORIX HOPE-LA`
- Bundle ID: `ai.astorix.hopela`
- SKU: `astorix-hopela-001`

---

## STEP 0 (Do Before Step 1): Register 4 App IDs
*(developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → +)*

Register each Bundle ID as Explicit App ID with Push Notifications enabled:
- `ai.astorix.signal`
- `ai.astorix.signalpro`
- `ai.astorix.cityinfra`
- `ai.astorix.hopela`

---

## STEP 2: Generate App Store Connect API Key
*(This lets GitHub Actions upload builds without you doing anything)*

1. Go to **appstoreconnect.apple.com/access/integrations/api**
2. Click **+** to generate a new key
3. Name: `GitHub Actions ASTORIX`
4. Access: **App Manager**
5. Download the `.p8` file → save to `C:\Users\anand\OneDrive\ASTORIX SOU\`
6. Note down: **Issuer ID** and **Key ID** (shown on the page)

---

## STEP 3: Get Your Distribution Certificate (as Base64)

You already have an iOS Distribution Certificate (valid until 2027/09/05).

You need to export it from your Apple Developer account:
1. Go to **developer.apple.com/account/resources/certificates/list**
2. Click your iOS Distribution certificate
3. Download it → double-click to open Keychain Access on Mac... 

**WORKAROUND for Windows:** Use Codemagic instead (see Step 3B below).

---

## STEP 3B: Use Codemagic (Easiest Windows Path)

Codemagic is a cloud CI/CD service purpose-built for Capacitor/iOS. Free tier available.

1. Go to **codemagic.io** → Sign up with GitHub account
2. Connect your GitHub repo (push the astorix-ios-apps folder there first)
3. Add new application → Select your repo
4. Choose **Ionic/Capacitor** project type
5. In Codemagic settings:
   - Apple Developer credentials: paste your App Store Connect API key
   - Bundle IDs: enter all 4
   - Xcode version: latest
6. Click **Start Build**
7. Codemagic builds on macOS cloud, signs with Apple, uploads to App Store Connect
8. Go to appstoreconnect.apple.com → your app → TestFlight to see the build

**Cost: FREE tier = 500 build minutes/month** — sufficient for 4 apps

---

## STEP 4: Push App Code to GitHub

From Windows PowerShell (in `C:\Users\anand\OneDrive\ASTORIX SOU\`):

```powershell
# Create new repo for iOS apps (or use existing astorix-website repo subfolder)
cd "C:\Users\anand\OneDrive\ASTORIX SOU"
git clone https://github.com/sapzoker54/astorix-website.git
cd astorix-website
mkdir ios-apps
# Copy the astorix-ios-apps folder contents into ios-apps/
# Then push:
git add ios-apps/
git commit -m "Add 4 ASTORIX iOS app Capacitor projects"
git push origin main
```

---

## STEP 5: Add App Icons (Windows — use browser)

Go to **appicon.co** in your browser:
1. Upload a 1024×1024 PNG of ASTORIX "A" logo
   - Background: #07090F (near-black)
   - "A" in Space Grotesk, weight 900
   - Gradient: #1D4ED8 → #3B82F6
2. Download the generated icon set
3. Upload the icons to each app listing in App Store Connect
4. Codemagic will pick up the icons from the Xcode project

---

## STEP 6: Fill App Store Metadata

In **appstoreconnect.apple.com** for each app:
- Paste descriptions from APP_STORE_METADATA.md
- Add keywords
- Set Privacy Policy URL: https://astorix.ai/privacy
- Set Support URL: https://astorix.ai/support
- Set Age Rating: 4+
- Set Price: Free

---

## STEP 7: Submit to App Store

After Codemagic uploads a build:
1. Go to appstoreconnect.apple.com → Your App → iOS App
2. Under "Build": click + → select the Codemagic build
3. Click **Submit for Review**
4. Apple reviews in 1–7 days

---

## FOLDER STRUCTURE

```
astorix-ios-apps/
├── signal/
│   ├── package.json
│   ├── capacitor.config.json
│   └── src/
│       └── index.html          ← Full Signal app UI ✅ DONE
├── signal-pro/
│   ├── package.json
│   ├── capacitor.config.json
│   └── src/
│       └── index.html          ← Signal Pro UI ✅ DONE
├── cityinfra/
│   ├── package.json
│   ├── capacitor.config.json
│   └── src/
│       └── index.html          ← CityInfra UI ✅ DONE
├── hopela/
│   ├── package.json
│   ├── capacitor.config.json
│   └── src/
│       └── index.html          ← HOPE-LA UI ✅ DONE
├── APP_STORE_METADATA.md       ← All 4 app descriptions, keywords ✅
└── BUILD_GUIDE.md              ← This file (Windows edition) ✅
```

---

## BUNDLE IDs REGISTERED

| App | Bundle ID | IC Class |
|-----|-----------|----------|
| ASTORIX Signal | ai.astorix.signal | 042 |
| ASTORIX Signal Pro | ai.astorix.signalpro | 009 + 042 |
| ASTORIX CityInfra | ai.astorix.cityinfra | 009 + 042 |
| ASTORIX HOPE-LA | ai.astorix.hopela | 009 + 042 |

USPTO SN 99639401 | NOA September 8, 2026 | SOU Deadline March 8, 2027

---

## REMAINING TO DO

- [ ] Register 4 App IDs on developer.apple.com (you do this in browser)
- [ ] Create 4 app listings on appstoreconnect.apple.com (you do this in browser)
- [ ] Sign up for Codemagic.io → connect GitHub repo
- [ ] Generate App Store Connect API key → give to Codemagic
- [ ] App icon PNG (1024×1024) for all 4 apps → appicon.co
- [ ] Splash screen PNGs for all 4 apps
- [ ] App Store screenshots (iPhone 6.9" and 6.5")
- [ ] Submit each app for App Store review

---

## SOU FILING CHECKLIST (Oct 7, 2026 Target)

- [x] IC 042 specimen: signal.demo.astorix.ai (LIVE — DO NOT TOUCH)
- [x] IC 009 path: 4 iOS apps built (all 4 UIs complete)
- [ ] Apps on App Store (in progress via Codemagic)
- [ ] First use dates: 07/10/2026 for both IC 009 and IC 042
- [ ] File SOU on TEAS: teas.uspto.gov
