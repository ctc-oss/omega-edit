@echo off
setlocal
set "VSCMD="
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" set "VSCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat" if "%VSCMD%"=="" set "VSCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat"
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat" if "%VSCMD%"=="" set "VSCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat"
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\Common7\Tools\VsDevCmd.bat" if "%VSCMD%"=="" set "VSCMD=C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\Common7\Tools\VsDevCmd.bat"
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\Common7\Tools\VsDevCmd.bat" if "%VSCMD%"=="" set "VSCMD=C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\Common7\Tools\VsDevCmd.bat"
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\Common7\Tools\VsDevCmd.bat" if "%VSCMD%"=="" set "VSCMD=C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\Common7\Tools\VsDevCmd.bat"

if "%VSCMD%"=="" (
  echo VsDevCmd.bat not found
  exit /b 2
)

echo Using %VSCMD%
call %VSCMD% -arch=amd64

rem Run the PowerShell build script from the repository root
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"

endlocal
