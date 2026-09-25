# ASTORIX iOS Apps — Complete Submission Guide
## USPTO SN 99639401 | IC 009 | SOU Target: October 7, 2026
## App Store Deadline: Friday, October 2, 2026

---

## PHASE 1: PUSH CODE TO GITHUB (10 min — your Windows laptop)

### Step 1.1 — Download and extract the zip
1. Download `astorix-ios-apps-v1.0.zip` from this session
2. Extract to `C:\Users\anand\OneDrive\ASTORIX SOU\`
3. You should now have: `C:\Users\anand\OneDrive\ASTORIX SOU\astorix-ios-apps\`

### Step 1.2 — Push to GitHub
Open **Command Prompt** (Windows key → type "cmd" → Enter) and run:

```bat
cd %USERPROFILE%
git clone https://github.com/sapzoker54/astorix-website.git
cd astorix-website
xcopy /E /I /Y "%USERPROFILE%\OneDrive\ASTORIX SOU\astorix-ios-apps" "ios-apps"
git add ios-apps/
git add ios-apps/codemagic.yaml
git commit -m "feat: Add ASTORIX iOS Apps v1.0 - all 4 apps with live data"
git push origin main
```

✅ **Verify:** Go to https://github.com/sapzoker54/astorix-website — you should see an `ios-apps/` folder

---

## PHASE 2: DEPLOY PRIVACY POLICY (5 min)

The `privacy.html` file must be live at **https://astorix.ai/privacy** BEFORE you submit apps. Apple verifies this URL during review.

### If astorix.ai is on Azure Static Web Apps:
1. Copy `privacy.html` from the zip to your website's root folder
2. Also copy it as `privacy/index.html` so the URL `/privacy` works
3. Push to your website's GitHub repo
4. Azure will deploy automatically

### If astorix.ai is elsewhere:
Upload `privacy.html` to your hosting so it's accessible at `https://astorix.ai/privacy`

---

## PHASE 3: APP STORE CONNECT API KEY (10 min — one-time setup)

This API key lets Codemagic upload your apps to Apple automatically.

### Step 3.1 — Generate the key
1. Go to: **https://appstoreconnect.apple.com**
2. Sign in with: ashreekar@gmail.com
3. Click **Users and Access** (top menu)
4. Click **Integrations** tab (left sidebar)
5. Under **App Store Connect API**, click the **+** button
6. Name: `Codemagic`
7. Access: `App Manager`
8. Click **Generate**
9. **Download the .p8 file IMMEDIATELY** — Apple only lets you download it once
10. Note the **Key ID** (shown on screen — looks like: `ABC1234XYZ`)
11. Note the **Issuer ID** (shown on screen — looks like: `12345678-1234-1234-1234-123456789012`)

### Step 3.2 — Save all 3 values
Save these to `C:\Users\anand\OneDrive\ASTORIX SOU\AppStoreConnect_API_Key.txt`:
```
Issuer ID: [paste here]
Key ID: [paste here]
.p8 file: AuthKey_[KeyID].p8  ← keep this file safe
```

---

## PHASE 4: SET UP CODEMAGIC (20 min — one-time)

Codemagic builds your .ipa files on Apple's Mac hardware without you needing a Mac.

### Step 4.1 — Connect GitHub
1. Go to: **https://codemagic.io**
2. Click **Sign up / Log in** → **Continue with GitHub**
3. Authorize Codemagic to access your GitHub account
4. Click **Add new app**
5. Select **GitHub** → find repo `sapzoker54/astorix-website`
6. Select **Ionic/Capacitor** or **Other** as the project type
7. Codemagic will detect `codemagic.yaml` in the repo root — select it

### Step 4.2 — Add Apple credentials
1. In Codemagic, go to **Teams** (top right) → **Settings** → **Integrations**
2. Click **Apple Developer Portal**
3. Select **App Store Connect API key**
4. Enter:
   - **Issuer ID**: (from Step 3.2)
   - **Key ID**: (from Step 3.2)
   - **Private key**: Open the `.p8` file in Notepad, copy ALL the text including the `-----BEGIN PRIVATE KEY-----` lines, paste it in
5. Name it: `Codemagic`
6. Click **Save**

### Step 4.3 — Set up code signing (Automatic)
1. In Codemagic, open your app → **Settings** → **Distribution**
2. Under **iOS code signing**, select **Automatic**
3. Select the **App Store Connect API key** you just added
4. Codemagic will automatically create provisioning profiles for each bundle ID

---

## PHASE 5: CREATE APPS IN APP STORE CONNECT (30 min)

Do this for all 4 apps. Use the exact values from `APP_STORE_METADATA.md`.

### Step 5.1 — Create each app
1. Go to: **https://appstoreconnect.apple.com**
2. Click **My Apps** → **+** (top left) → **New App**
3. Fill in:
   - Platform: **iOS**
   - Name: (see table below)
   - Primary Language: **English (U.S.)**
   - Bundle ID: (see table below) — select from dropdown
   - SKU: (use bundle ID without dots, e.g. `aiastorixhopela`)

| App | Name | Bundle ID | SKU |
|-----|------|-----------|-----|
| 1 | HOPE-LA by ASTORIX | ai.astorix.hopela | aiastorixhopela |
| 2 | CityInfra by ASTORIX | ai.astorix.cityinfra | aiastorixcityinfra |
| 3 | Signal by ASTORIX | ai.astorix.signal | aiastorixsignal |
| 4 | Signal Pro by ASTORIX | ai.astorix.signalpro | aiastorixsignalpro |

**NOTE:** Bundle IDs must be registered in Apple Developer Portal first:
- Go to https://developer.apple.com/account
- Identifiers → + → App IDs → App
- Register all 4 bundle IDs with Team ID GV32459XCX

### Step 5.2 — Fill in App Information (for each app)
After creating the app, click **App Information** (left sidebar):
- **Subtitle**: (from APP_STORE_METADATA.md)
- **Privacy Policy URL**: `https://astorix.ai/privacy`
- **Category**: Utilities
- **Secondary Category**: (see metadata file)
- **Content Rights**: "This app does not contain, show, or access third-party content"

### Step 5.3 — Set up the 1.0 version (for each app)

#### App Store tab → Version Information:
- **Description**: Copy from `APP_STORE_METADATA.md`
- **Keywords**: Copy from `APP_STORE_METADATA.md`
- **Support URL**: `https://astorix.ai/support`
- **Marketing URL**: `https://astorix.ai`
- **What's New**: "First release. Real-time live data from official government APIs."

#### Screenshots:
Upload from the `assets/` folder in the zip:
- **iPhone 6.9" Display**: `screenshot_69_1.png`, `screenshot_69_2.png`, `screenshot_69_3.png`
- **iPhone 6.5" Display**: `screenshot_65_1.png`, `screenshot_65_2.png`, `screenshot_65_3.png`

#### App icon:
- Upload `assets/icon.png` (1024×1024)
- Apple will auto-generate smaller sizes

#### Build:
- Leave blank for now — Codemagic will deliver the build (see Phase 6)

#### App Review Information:
- **First Name**: Anand
- **Last Name**: Shreekar
- **Email**: ashreekar@gmail.com
- **Phone**: (your phone number)
- **Demo account**: Not required (no login needed to use app)
- **Notes**: "This app displays real-time public data from LA City 311, USGS, and NOAA NWS APIs. No login or account required."

#### Age Rating:
- Click **Set Age Rating** → answer all questions as "None" or "No"
- Rating will be: **4+**

#### Pricing:
- Price: **0.00 (Free)**

---

## PHASE 6: RUN CODEMAGIC BUILDS (30–60 min per app)

### Step 6.1 — Trigger builds
1. In Codemagic → your app → **Start new build**
2. Select branch: `main`
3. Select workflow: `hopela-ios`
4. Click **Start build**
5. Repeat for: `cityinfra-ios`, `signal-ios`, `signal-pro-ios`

You can run all 4 simultaneously — Codemagic runs them in parallel.

### Step 6.2 — Monitor builds
- Codemagic will email ashreekar@gmail.com when each build finishes
- Build logs are live at codemagic.io — click on the running build
- Each build takes ~20–40 minutes on macOS M2

### Step 6.3 — What happens automatically
When a build succeeds, Codemagic:
1. Signs the .ipa with your App Store distribution certificate
2. Uploads the .ipa to App Store Connect (TestFlight first)
3. You'll see the build appear in App Store Connect under **TestFlight**

### Step 6.4 — Link build to your App Store listing
1. In App Store Connect → your app → **iOS App** → **Build**
2. Click **+** → select the build Codemagic just uploaded
3. Click **Done**

---

## PHASE 7: SUBMIT FOR REVIEW (5 min per app)

### Step 7.1 — Final checklist before submission
For each app, verify in App Store Connect:
- [ ] Description filled in
- [ ] Keywords filled in (max 100 characters)
- [ ] Screenshots uploaded (6.9" and 6.5")
- [ ] App icon uploaded (1024×1024)
- [ ] Privacy Policy URL set to `https://astorix.ai/privacy`
- [ ] Build attached (from Codemagic)
- [ ] Age rating completed (4+)
- [ ] Price set to Free

### Step 7.2 — Submit
1. Click **Add for Review** (top right blue button)
2. Select: "No, it is not designed for children"
3. Confirm: "This version is ready for submission"
4. Click **Submit to App Review**

### Step 7.3 — Apple review timeline
- Normal review: 24–72 hours
- Submit by **Tuesday Sep 29** to safely hit the Friday Oct 2 deadline
- You'll receive email at ashreekar@gmail.com when approved or if action is needed

---

## PHASE 8: SOU FILING (After all 4 apps are LIVE on App Store)

### Evidence to collect for USPTO IC 009 specimens
For each of the 4 apps, capture:
1. **Screenshot of App Store listing** showing the app name + ASTORIX branding + "Available on the App Store"
2. **Screenshot of the app running** on a real iPhone showing live data
3. The **App Store URL** (https://apps.apple.com/us/app/[app-name]/id[number])

### SOU Filing at teas.uspto.gov
1. Go to: **https://teas.uspto.gov**
2. Select: **Statement of Use (SOU) — 15 U.S.C. §1051(d)**
3. Serial Number: **99639401**
4. Dates of first use:
   - **Date of First Use Anywhere**: 07/10/2026
   - **Date of First Use in Commerce**: 07/10/2026
5. IC 009 Specimen: Upload App Store screenshot for any 1 of the 4 apps
6. IC 042 Specimen: Use signal.demo.astorix.ai screenshot (FROZEN — do not modify)
7. Filing fee: $100 per class × 2 classes = $200

---

## CRITICAL DATES

| Date | Action |
|------|--------|
| **Sep 25, 2026** | ✅ All 4 apps built with live data, icons, screenshots |
| **Sep 26, 2026** | Push to GitHub → Codemagic → App Store Connect setup |
| **Sep 29, 2026** | Submit all 4 apps for Apple review |
| **Oct 2, 2026** | ✅ TARGET: All 4 apps live on App Store |
| **Oct 7, 2026** | ✅ TARGET: File SOU at teas.uspto.gov |
| **Mar 8, 2027** | ⚠️ SOU DEADLINE (6 months from Sep 8, 2026 NOA) |

---

## CONTACT / RESOURCES

| Resource | URL |
|----------|-----|
| App Store Connect | https://appstoreconnect.apple.com |
| Apple Developer Portal | https://developer.apple.com/account |
| Codemagic | https://codemagic.io |
| USPTO TEAS | https://teas.uspto.gov |
| TSDR (check SN 99639401) | https://tsdr.uspto.gov/#caseNumber=99639401 |
| Privacy Policy (must be live) | https://astorix.ai/privacy |
| GitHub Repo | https://github.com/sapzoker54/astorix-website |

---

*Prepared by ASTORIX development team (Gensis.AI Inc.) — September 25, 2026*
*Bundle IDs: ai.astorix.hopela | ai.astorix.cityinfra | ai.astorix.signal | ai.astorix.signalpro*
*Apple Team ID: GV32459XCX*
