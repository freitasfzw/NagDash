@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==========================================
echo       PAINEL DE COMMIT PARA GITHUB
echo ==========================================

set /p title="Título do commit: "

if "%title%"=="" (
    set title=Atualização automática
)

set /p body="Descrição (opcional): "

echo.
echo Criando commit com:
echo -----------------------
echo Título: %title%
echo Descrição: %body%
echo -----------------------
echo.

git add .

if "%body%"=="" (
    git commit -m "%title%"
) else (
    git commit -m "%title%" -m "%body%"
)

git push

echo.
echo ==========================================
echo                Concluído!
echo ==========================================
pause
