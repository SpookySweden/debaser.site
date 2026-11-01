@echo off
rem Builds "Debaser Servers.exe" onto the desktop with Windows' own C# compiler (nothing is downloaded).
rem Run it again after changing DebaserServers.cs.
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set OUT=%USERPROFILE%\Desktop\Debaser Servers.exe
"%CSC%" /nologo /target:winexe /optimize+ /out:"%OUT%" /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0DebaserServers.cs"
if errorlevel 1 exit /b 1
echo Built: %OUT%
