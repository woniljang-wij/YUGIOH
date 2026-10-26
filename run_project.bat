@echo off
setlocal
pushd "%~dp0"
set "ROOT=%CD%"
set "PYTHON=%ROOT%\.venv\Scripts\python.exe"

if not exist "%PYTHON%" (
    echo [ERROR] Python virtual environment not found at .venv.
    echo Create it and install backend requirements first. See backend\README.md.
    popd
    exit /b 1
)

if not exist "%ROOT%\frontend\node_modules" (
    echo [ERROR] Frontend dependencies not found in frontend\node_modules.
    echo Run npm --prefix frontend ci first.
    popd
    exit /b 1
)

echo Checking SQL Server Express...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $service = Get-Service -Name 'MSSQL$SQLEXPRESS'; if ($service.Status -ne 'Running') { Start-Service -Name $service.Name; $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30)) }; if ((Get-Service -Name 'MSSQL$SQLEXPRESS').Status -ne 'Running') { exit 1 }"
if errorlevel 1 (
    echo [ERROR] SQL Server Express could not be started. Check the service and permissions.
    popd
    exit /b 1
)

echo Building the React frontend...
call npm.cmd --prefix frontend run build
if errorlevel 1 (
    echo [ERROR] Frontend build failed.
    popd
    exit /b 1
)

set "PROJECT_BACKEND=%ROOT%\backend\app.py"
for /f "usebackq delims=" %%R in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$listener = Get-NetTCPConnection -State Listen -LocalPort 5000 -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $listener) { 5000; exit }; $process = Get-CimInstance Win32_Process | Where-Object ProcessId -eq $listener.OwningProcess; $marker = [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($env:PROJECT_BACKEND)) + [IO.Path]::DirectorySeparatorChar + [IO.Path]::GetFileName($env:PROJECT_BACKEND); if ($process.CommandLine -and ($process.CommandLine.IndexOf($env:PROJECT_BACKEND, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $process.CommandLine.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $process.CommandLine.IndexOf($marker.Replace([char]92, [char]47), [StringComparison]::OrdinalIgnoreCase) -ge 0)) { -1; exit }; for ($port = 5001; $port -le 5010; $port++) { if (-not (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) { $port; exit } }; -2"`) do set "PORT_RESULT=%%R"
if "%PORT_RESULT%"=="-1" (
    set "PORT_STATUS=EXISTING"
    set "PORT=5000"
)
if "%PORT_RESULT%"=="-2" (
    echo [ERROR] Ports 5000 through 5010 are already in use.
    popd
    exit /b 1
)
if not "%PORT_RESULT%"=="-1" if not "%PORT_RESULT%"=="-2" (
    set "PORT_STATUS=AVAILABLE"
    set "PORT=%PORT_RESULT%"
)
if not "%PORT_STATUS%"=="AVAILABLE" if not "%PORT_STATUS%"=="EXISTING" (
    echo [ERROR] Could not determine an available website port.
    popd
    exit /b 1
)

if "%PORT_STATUS%"=="EXISTING" (
    echo Reusing the project backend already running on port %PORT%.
) else (
    echo Starting the backend on port %PORT%...
    set "PORT=%PORT%"
    start "YUGIOH backend" "%PYTHON%" "%ROOT%\backend\app.py"
)

echo Waiting for the website to respond...
for /L %%i in (1,1,30) do (
    curl.exe --silent --output NUL --write-out "%%{http_code}" http://127.0.0.1:%PORT%/ 2>NUL | findstr /R "^2[0-9][0-9]$" >NUL
    if not errorlevel 1 goto open_site
    timeout /t 2 /nobreak >NUL
)

echo [ERROR] The website did not respond within 60 seconds.
echo Check the YUGIOH backend window for startup errors.
popd
exit /b 1

:open_site
echo Website is ready at http://127.0.0.1:%PORT%
start "" "http://127.0.0.1:%PORT%"
popd
exit /b 0
