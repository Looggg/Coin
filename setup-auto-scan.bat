@echo off
rem Registers a Windows scheduled task that runs the discovery scan every
rem 4 hours and appends output to scan.log. Run this file ONCE.
rem To remove later: schtasks /delete /tn "CoinScan" /f

for /f "delims=" %%i in ('where node') do set NODE=%%i
schtasks /create /tn "CoinScan" ^
  /tr "cmd /c \"\"%NODE%\" \"%~dp0coin.js\" scan >> \"%~dp0scan.log\" 2>&1\"" ^
  /sc hourly /mo 4 /f
if %errorlevel%==0 (
  echo.
  echo OK: discovery scan runs every 4 hours ^(machine must be on^)
  echo shortlist:  %~dp0candidates.json  ^(latest scan^)
  echo history:    %~dp0scans.log
  echo output log: %~dp0scan.log
) else (
  echo FAILED — try running this file as Administrator
)
pause
