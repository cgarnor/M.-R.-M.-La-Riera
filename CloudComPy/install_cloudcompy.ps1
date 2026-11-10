# install_cloudcompy.ps1
# Installs CloudComPy (Python 3.12 build) and a Python 3.12 virtual environment for the
# CloudComPy scripts of this repository (run_mrm_cloudcompy.bat, run_rqr_cloudcompy.bat).
#
# Usage (from the repository folder):
#   powershell -ExecutionPolicy Bypass -File CloudComPy\install_cloudcompy.ps1
#
# Installs into C:\CloudComPy (CloudComPy312 + venv312). The launchers use these folders by
# default; other folders can be used by setting CLOUDCOMPY_DIR and VENV_DIR.

$ErrorActionPreference = "Stop"

$INSTALL_DIR = "C:\CloudComPy"
$VENV_DIR = Join-Path $INSTALL_DIR "venv312"
$CLOUDCOMPY_PAGE = "https://www.simulation.openfields.fr/index.php/cloudcompy-downloads/3-cloudcompy-binaries/5-windows-cloudcompy-binaries"
$DOWNLOAD_URL = "https://www.simulation.openfields.fr/index.php/cloudcompy-downloads/3-cloudcompy-binaries/5-windows-cloudcompy-binaries/129-cloudcompy312-20260610"
$ARCHIVE_NAME = "CloudComPy312_20260610.7z"
$PY_VERSION = "3.12.9"
$PY_URL = "https://www.python.org/ftp/python/$PY_VERSION/python-$PY_VERSION-amd64.exe"

function Step($text) { Write-Host $text -ForegroundColor Yellow }
function Fail($text) { Write-Host ""; Write-Host "  $text" -ForegroundColor Red; Write-Host ""; exit 1 }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " CloudComPy installer for the MRM scripts" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Python 3.12 -----------------------------------------------------------
Step "[1/5] Looking for Python 3.12..."

function Find-Python312 {
    try {
        $out = & py -3.12 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $out -and (Test-Path $out.Trim())) { return $out.Trim() }
    } catch {}
    foreach ($p in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "C:\Python312\python.exe", "C:\Program Files\Python312\python.exe")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

$py312 = Find-Python312
if (-not $py312) {
    Write-Host "  Python 3.12 was not found (CloudComPy312 requires exactly Python 3.12)." -ForegroundColor Red
    $answer = Read-Host "  Download and install Python $PY_VERSION from python.org now? (y/n)"
    if ($answer -ne 'y') { Fail "Install Python 3.12 from https://www.python.org/downloads/ and run this script again." }
    $pyInstaller = Join-Path $env:TEMP "python-$PY_VERSION-amd64.exe"
    Step "  Downloading $PY_URL ..."
    Invoke-WebRequest -Uri $PY_URL -OutFile $pyInstaller -UseBasicParsing
    # Only run the installer if it carries a valid signature of the Python Software Foundation.
    $sig = Get-AuthenticodeSignature -FilePath $pyInstaller
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
        Remove-Item $pyInstaller -Force -ErrorAction SilentlyContinue
        Fail "The downloaded Python installer does not have a valid Python Software Foundation signature. Aborted."
    }
    Step "  Running the Python installer (current user only)..."
    $proc = Start-Process -FilePath $pyInstaller -ArgumentList "/passive", "InstallAllUsers=0", "PrependPath=0", "Include_launcher=1" -Wait -PassThru
    Remove-Item $pyInstaller -Force -ErrorAction SilentlyContinue
    if ($proc.ExitCode -ne 0) { Fail "The Python installer finished with code $($proc.ExitCode)." }
    $py312 = Find-Python312
    if (-not $py312) { Fail "Python 3.12 is still not found. Check the installation and run this script again." }
}
Write-Host "  Found: $py312" -ForegroundColor Green

# --- 2. Install folder --------------------------------------------------------
Step "[2/5] Install folder: $INSTALL_DIR"
New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null

# --- 3. CloudComPy archive ----------------------------------------------------
function Test-7z($path) {
    if (-not (Test-Path $path)) { return $false }
    $fs = [System.IO.File]::OpenRead($path)
    try { $b = New-Object byte[] 6; $n = $fs.Read($b, 0, 6) } finally { $fs.Close() }
    return ($n -eq 6 -and $b[0] -eq 0x37 -and $b[1] -eq 0x7A -and $b[2] -eq 0xBC -and $b[3] -eq 0xAF -and $b[4] -eq 0x27 -and $b[5] -eq 0x1C)
}

$archivePath = Join-Path $INSTALL_DIR $ARCHIVE_NAME
if (Test-7z $archivePath) {
    Step "[3/5] CloudComPy archive already downloaded."
} else {
    Step "[3/5] Downloading CloudComPy312 (about 94 MB)..."
    try {
        Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $archivePath -UseBasicParsing -MaximumRedirection 10
    } catch {
        Write-Host "  Download error: $($_.Exception.Message)" -ForegroundColor Red
    }
    # The download site may return a web page instead of the archive: check the 7z signature.
    if (-not (Test-7z $archivePath)) {
        Remove-Item $archivePath -Force -ErrorAction SilentlyContinue
        Write-Host ""
        Write-Host "  The archive could not be downloaded automatically. Please download it manually:" -ForegroundColor Red
        Write-Host "    1. Open $CLOUDCOMPY_PAGE" -ForegroundColor White
        Write-Host "    2. Download 'CloudComPy312_20260610' (file $ARCHIVE_NAME)" -ForegroundColor White
        Write-Host "    3. Save it in $INSTALL_DIR and run this script again." -ForegroundColor White
        exit 1
    }
}

# --- 4. Extraction --------------------------------------------------------------
Step "[4/5] Extracting the archive..."
function Find-7Zip {
    foreach ($p in @("C:\Program Files\7-Zip\7z.exe", "C:\Program Files (x86)\7-Zip\7z.exe", "$env:LOCALAPPDATA\Programs\7-Zip\7z.exe")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}
if (Test-Path (Join-Path $INSTALL_DIR "CloudComPy312\envCloudComPy.bat")) {
    Write-Host "  Already extracted." -ForegroundColor Green
} else {
    $sevenZip = Find-7Zip
    if (-not $sevenZip -and (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host "  7-Zip not found. Installing it with winget..." -ForegroundColor Yellow
        & winget install --id 7zip.7zip -e --accept-package-agreements --accept-source-agreements
        $sevenZip = Find-7Zip
    }
    if (-not $sevenZip) { Fail "7-Zip is required. Install it from https://www.7-zip.org and run this script again." }
    & $sevenZip x $archivePath "-o$INSTALL_DIR" -y | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $INSTALL_DIR "CloudComPy312\envCloudComPy.bat"))) {
        Fail "Extraction failed (7-Zip exit code $LASTEXITCODE)."
    }
    Write-Host "  Extracted to $INSTALL_DIR\CloudComPy312" -ForegroundColor Green
}

# --- 5. Python environment ------------------------------------------------------
Step "[5/5] Creating the Python 3.12 environment..."
$venvPython = Join-Path $VENV_DIR "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    & $py312 -m venv $VENV_DIR
    if ($LASTEXITCODE -ne 0) { Fail "Could not create the virtual environment." }
}
& $venvPython -m pip install --quiet --upgrade pip
& $venvPython -m pip install --quiet numpy scipy requests psutil matplotlib numpy-quaternion
if ($LASTEXITCODE -ne 0) { Fail "pip could not install the required packages." }
Write-Host "  Environment ready: $VENV_DIR" -ForegroundColor Green

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Installation complete" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host " MRM:       CloudComPy\run_mrm_cloudcompy.bat model.obj" -ForegroundColor Cyan
Write-Host " Roughness: CloudComPy\run_rqr_cloudcompy.bat model_MRM_mesh.ply" -ForegroundColor Cyan
Write-Host ""
