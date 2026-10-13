@echo off
rem Inicia o Orquestradoria em modo REAL: usa os providers configurados (Claude Code, Codex...), o que CONSOME CREDITOS.
rem Banco principal: apps\api\orchestrator.db
cd /d "%~dp0"
for /f "tokens=1 delims=." %%v in ('node -v') do set NODEMAJOR=%%v
if not "%NODEMAJOR%"=="v22" (
  echo [AVISO] Node atual: %NODEMAJOR%. O projeto exige Node 22. Rode: nvm use 22.23.3
)
echo.
echo ================================================
echo   MODO REAL  -  CONSOME CREDITOS dos providers pagos
echo ================================================
set /p CONFIRMA=Digite SIM para continuar:
if /i not "%CONFIRMA%"=="SIM" (
  echo Cancelado. Use iniciar-mock.cmd para testar sem custo.
  exit /b 1
)
set ORQ_FORCE_MOCK=
set PORT=4000
echo.
echo   http://localhost:5173
echo.
call pnpm dev
