@echo off
setlocal
set "PROJ_DIR=%~dp0"
set "NODE_EXE="
for /f "usebackq delims=" %%i in (`where node 2^>nul`) do if not defined NODE_EXE set "NODE_EXE=%%i"
if not defined NODE_EXE if exist "%USERPROFILE%\Downloads\node-v24.11.1-win-x64\node.exe" set "NODE_EXE=%USERPROFILE%\Downloads\node-v24.11.1-win-x64\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\Apps\nodejs\node.exe" set "NODE_EXE=%USERPROFILE%\Apps\nodejs\node.exe"
if not defined NODE_EXE (
  echo Node.exe not found in PATH or common locations.
  echo Edit this script and set NODE_EXE to the full path of your node.exe, then rerun.
  pause
  exit /b 1
)
for %%D in ("%NODE_EXE%") do set "NODE_DIR=%%~dpD"
set "NPM_CMD="
if exist "%NODE_DIR%npm.cmd" set "NPM_CMD=%NODE_DIR%npm.cmd"
if exist "%PROJ_DIR%node_modules\.bin\npm.cmd" set "NPM_CMD=%PROJ_DIR%node_modules\.bin\npm.cmd"
if defined NPM_CMD (
  pushd "%PROJ_DIR%"
  echo Running: "%NPM_CMD%" install
  "%NPM_CMD%" install
  popd
) else (
  echo npm not found next to node.exe or in project. Skipping install step.
)
pushd "%PROJ_DIR%"
if exist "node_modules\.bin\electron.cmd" (
  echo Launching Electron...
  node_modules\.bin\electron.cmd .
) else (
  echo electron not found in node_modules. Try running npm install first or check package.json.
  pause
)
popd
endlocal
