@echo off
set "PATH=%LOCALAPPDATA%\Programs\MinGit\cmd;C:\Users\PC\AppData\Roaming\Antigravity\bin;C:\Users\PC\AppData\Roaming\npm;%PATH%"
echo ========================================
echo   SLTS - Git Push & Deploy to Vercel
echo ========================================
echo.
echo [1/3] Syncing public web assets...
node build-public.js
echo.
echo [2/3] Pushing code to GitHub (main)...
git add .
git commit -m "Auto update via deploy.bat"
git push origin main
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Git push required authentication or encountered an error.
) else (
    echo.
    echo [OK] Pushed to GitHub successfully!
)
echo.
echo [3/3] Deploying to Vercel Production...
call npx vercel --prod --scope erkawit-ladlais-projects --yes
echo.
pause