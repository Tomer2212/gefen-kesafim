@echo off
echo Starting Gefen-Ksafim servers...

start "Backend" cmd /k "cd /d C:\CLAUDE_CODE\Project_gefen-ksafim\backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000"

timeout /t 2 /nobreak >nul

start "Frontend" cmd /k "cd /d C:\CLAUDE_CODE\Project_gefen-ksafim\frontend && npm run dev"

echo.
echo Servers starting...
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
timeout /t 4 /nobreak >nul
start http://localhost:5173
