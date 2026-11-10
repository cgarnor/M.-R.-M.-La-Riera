@echo off
REM CloudComPy launcher for the roughness script (mrm_roughness_cloudcompy.py).
REM Usage: run_rqr_cloudcompy.bat <input_MRM_mesh.ply> [output.ply]
REM The installation folders can be changed with the CLOUDCOMPY_DIR and VENV_DIR variables
REM (defaults: those created by install_cloudcompy.ps1).

if "%~1"=="" (
  echo Uso / Usage: run_rqr_cloudcompy.bat ^<input_MRM_mesh.ply^> [output.ply]
  exit /b 1
)
if not defined CLOUDCOMPY_DIR set "CLOUDCOMPY_DIR=C:\CloudComPy\CloudComPy312"
if not defined VENV_DIR set "VENV_DIR=C:\CloudComPy\venv312"

if not exist "%VENV_DIR%\Scripts\activate.bat" (
  echo No se encuentra el entorno de Python: "%VENV_DIR%". Ejecuta install_cloudcompy.ps1 o define VENV_DIR.
  exit /b 1
)
if not exist "%CLOUDCOMPY_DIR%\envCloudComPy.bat" (
  echo No se encuentra CloudComPy: "%CLOUDCOMPY_DIR%". Ejecuta install_cloudcompy.ps1 o define CLOUDCOMPY_DIR.
  exit /b 1
)

call "%VENV_DIR%\Scripts\activate.bat"
call "%CLOUDCOMPY_DIR%\envCloudComPy.bat"

python "%~dp0mrm_roughness_cloudcompy.py" %*
