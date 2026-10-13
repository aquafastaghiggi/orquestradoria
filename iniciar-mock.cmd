@echo off
rem Inicia o Orquestradoria em modo MOCK forcado: nenhum provider pago (Claude/Codex) e chamado,
rem mesmo que o workspace esteja configurado com eles. Usa o mesmo banco do modo real (seus workspaces aparecem).
cd /d "%~dp0"
for /f "tokens=1 delims=." %%v in ('node -v') do set NODEMAJOR=%%v
if not "%NODEMAJOR%"=="v22" (
  echo [AVISO] Node atual: %NODEMAJOR%. O projeto exige Node 22. Rode: nvm use 22.23.3
  echo Continuando mesmo assim...
)
set ORQ_FORCE_MOCK=1
set DEVELOPER_PROVIDER=mock
set REVIEWER_PROVIDER=mock
set TESTER_PROVIDER=mock
set PROMPT_REFINER_PROVIDER=mock
set MISSION_PLANNER_PROVIDER=mock
set PORT=4000
echo.
echo ================================================
echo   MODO MOCK (sem custo)  -  http://localhost:5173
echo ================================================
echo.
call pnpm dev
