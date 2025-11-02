@echo off
REM Avvia First Aid Manager Node.js e apre nel browser quando pronto
setlocal enableextensions
set "BASE_URL=http://localhost:3000"
set "HEALTH_PATH=/"

cd /d "%~dp0.."

REM Termina eventuali processi Node.js sulla porta 3000
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do taskkill /f /pid %%a 2>nul

REM Installa dipendenze se necessario
if not exist "node_modules" (
    echo Installazione dipendenze...
    npm install
)

REM Avvia server Node.js in background
echo Avvio server...
start "First Aid Manager Server" /min cmd /c npm start

REM Attesa che l'endpoint risponda 200
echo Attendo che il server sia pronto...
powershell -NoProfile -Command " ^
  $url='http://localhost:3000'.TrimEnd('/') + '/'; ^
  while ($true) { ^
    try { $r=Invoke-WebRequest -UseBasicParsing $url; if ($r.StatusCode -eq 200) { Write-Host 'Server pronto!'; break } } catch {} ; ^
    Start-Sleep -s 1 ^
  }"

REM Apre nel browser predefinito
echo ✅ Apertura applicazione nel browser...
start "" http://localhost:3000

echo.
echo First Aid Manager è ora in esecuzione su http://localhost:3000
echo Chiudi questa finestra per fermare il server.
pause