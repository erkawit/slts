@echo off
set "PATH=%LOCALAPPDATA%\Programs\MinGit\cmd;C:\Users\PC\AppData\Roaming\Antigravity\bin;C:\Users\PC\AppData\Roaming\npm;%PATH%"
echo ========================================
echo   SLTS - Git Push & Deploy to Vercel
echo ========================================
echo.
echo [1/2] Pushing code to GitHub (main)...
git push origin main
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Git push required authentication or encountered an error.
) else (
    echo.
    echo [OK] Pushed to GitHub successfully!
)
echo.
echo [2/2] Deploying to Vercel...
call vercel --prod
echo.
pause