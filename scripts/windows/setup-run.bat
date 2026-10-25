@echo off
setlocal
pushd "%~dp0..\.."
call npm ci
if errorlevel 1 goto failed
call npm run start:electron
set "RESULT=%ERRORLEVEL%"
popd
exit /b %RESULT%
:failed
popd
exit /b 1
