@echo off
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%PATH%"
echo Starting Zeblaze-BLE App...
call npm run android
pause
