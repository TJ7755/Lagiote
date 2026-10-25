@echo off
setlocal
pushd "%~dp0..\.."
call npm run start:electron
set "RESULT=%ERRORLEVEL%"
popd
exit /b %RESULT%
