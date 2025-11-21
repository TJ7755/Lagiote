@echo off
setlocal
set "PROJ_DIR=%~dp0"
pushd "%PROJ_DIR%"
if exist "node_modules\.bin\electron.cmd" (
  node_modules\.bin\electron.cmd .
) else (
  echo electron not present. Run setup-run.bat or run: npm install
  pause
)
popd
endlocal
