@echo off
REM ============================================================
REM ASTORIX iOS Apps — Push to GitHub
REM Run this on your Windows laptop from OneDrive folder
REM Repo: https://github.com/sapzoker54/astorix-website
REM ============================================================

echo === ASTORIX GitHub Push ===
echo.

REM Clone the repo if not already present
IF NOT EXIST "%USERPROFILE%\astorix-website" (
    echo Cloning repo...
    git clone https://github.com/sapzoker54/astorix-website.git "%USERPROFILE%\astorix-website"
)

cd /d "%USERPROFILE%\astorix-website"

REM Pull latest
echo Pulling latest from GitHub...
git pull origin main

REM Create ios-apps folder structure
echo Copying ios-apps folder...
xcopy /E /I /Y "%USERPROFILE%\OneDrive\ASTORIX SOU\ios-apps" "ios-apps"

REM Stage all files
git add ios-apps/
git add codemagic.yaml

REM Commit
git commit -m "feat: Add all 4 ASTORIX iOS apps with real live data

- HOPE-LA: LA 311 Socrata API + NOAA NWS alerts
- CityInfra: LA 311 infra filter + USGS earthquakes + NWS
- Signal: IP geolocation + Browser Network API + 8-endpoint latency
- Signal Pro: All Signal sources + USGS + NWS + 5-dim composite score

All apps: 60-second auto-refresh, dark iOS theme, Capacitor 6
Assets: 1024x1024 icons + 1320x2868 and 1242x2688 screenshots
Codemagic CI/CD: 4 workflows, Team ID GV32459XCX

For USPTO SN 99639401 IC 009 SOU filing, target 10/07/2026"

REM Push
echo Pushing to GitHub...
git push origin main

echo.
echo === Done! Now go to https://codemagic.io and trigger the builds ===
pause
