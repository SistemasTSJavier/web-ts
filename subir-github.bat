@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   Subir web-ts a GitHub
echo   https://github.com/SistemasTSJavier/web-ts
echo ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: Git no esta instalado o no esta en el PATH.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo ERROR: Esta carpeta no es un repositorio git.
  pause
  exit /b 1
)

REM Asegura el remoto correcto
git remote set-url origin https://github.com/SistemasTSJavier/web-ts.git 2>nul
if errorlevel 1 (
  git remote add origin https://github.com/SistemasTSJavier/web-ts.git
)

echo Estado actual:
git status -sb
echo.

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Actualiza Sala de Juntas a TypeScript, Vite y UI corporativa"

echo Agregando cambios (respeta .gitignore: no sube .env ni node_modules)...
git add -A

git diff --cached --quiet
if errorlevel 1 (
  echo Creando commit...
  git commit -m "%MSG%"
  if errorlevel 1 (
    echo ERROR: No se pudo crear el commit.
    pause
    exit /b 1
  )
) else (
  echo No hay cambios nuevos para commit.
)

echo.
echo Subiendo a origin/main...
git push -u origin HEAD
if errorlevel 1 (
  echo.
  echo ERROR: Fallo el push. Revisa autenticacion de GitHub.
  echo Tip: usa GitHub CLI "gh auth login" o un Personal Access Token.
  pause
  exit /b 1
)

echo.
echo Listo. Repo: https://github.com/SistemasTSJavier/web-ts
echo.
pause
endlocal
