@echo off
chcp 65001 >nul
title Lead Local - servidor
echo.
echo  Iniciando o Lead Local...
echo.
cd /d "%~dp0"
start "" http://localhost:8000/index.html
python -m http.server 8000
if errorlevel 1 (
  echo.
  echo  Nao encontrei o Python. Duas saidas:
  echo    1^) instale o Python em python.org e rode este arquivo de novo
  echo    2^) use a extensao Live Server no VS Code
  echo.
  pause
)
