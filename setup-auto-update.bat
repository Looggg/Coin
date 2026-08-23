@echo off
rem Registers a daily Windows scheduled task that runs the journal update
rem at 20:00 and appends output to update.log. Run this file ONCE.
rem To remove later: schtasks /delete /tn "CoinJournalUpdate" /f

for /f "delims=" %%i in ('where node') do set NODE=%%i
schtasks /create /tn "CoinJournalUpdate" ^
  /tr "cmd /c \"\"%NODE%\" \"%~dp0coin.js\" update >> \"%~dp0update.log\" 2>&1\"" ^
  /sc daily /st 20:00 /f
if %errorlevel%==0 (
  echo.
  echo OK: journal will auto-update daily at 20:00 ^(machine must be on^)
  echo log file: %~dp0update.log
) else (
  echo FAILED — try running this file as Administrator
)
pause
