@echo off
title Zeblaze-BLE Phone Mirror
set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
set "PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools;%PATH%"
echo ==============================================
echo  Opening Zeblaze-BLE Phone Screen on PC...
echo ==============================================
"C:\Users\shaon\AppData\Local\Microsoft\WinGet\Packages\Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe\scrcpy-win64-v5.0.1\scrcpy.exe" --max-size=1600 --video-bit-rate=8M --stay-awake --window-title="Zeblaze-BLE (POCO X3 Pro)"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Connection closed or error occurred. Press any key to exit.
    pause
)
