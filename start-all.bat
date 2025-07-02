@echo off
chcp 65001 >nul
title pickleglass Integrated Startup

echo 🚀 pickleglass Initial Setup

REM Check data folder
if not exist "data" (
    echo 📁 Creating data folder...
    mkdir data
)

REM Start web backend
echo 🔧 Starting web backend...
cd pickleglass_web

REM Check and create Python virtual environment
if not exist "venv" (
    echo 🐍 Creating Python virtual environment...
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

REM Run backend (in new window)
cd backend
start "pickleglass Web Backend" cmd /k "python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
echo ✅ Web backend started - http://localhost:8000

REM Return to pickleglass_web directory for frontend
cd ..

REM Wait a moment for backend to start
echo ⏳ Waiting for backend initialization...
timeout /t 3 /nobreak >nul

REM Start web frontend
echo 🌐 Starting web frontend...
if not exist "node_modules" (
    echo 📦 Installing Node.js dependencies...
    npm install
)

start "pickleglass Web Frontend" cmd /k "npm run dev"
echo ✅ Web frontend started - http://localhost:3000

REM Return to original directory
cd ..

REM Wait a moment for frontend to start
echo ⏳ Waiting for frontend initialization...
timeout /t 3 /nobreak >nul

REM Start Electron app
echo ⚡ Starting Electron app...
start "pickleglass Electron" npm start
echo ✅ Electron app started

echo.
echo 🎉 All applications are running!
echo 🔧 Web backend API: http://localhost:8000
echo 🌐 Web frontend: http://localhost:3000
echo ⚡ Electron app: Running in separate window
echo 🗄️  Shared database: .\data\pickleglass.db
echo.
echo 💡 Closing this window will end the script.
echo    Each application will continue running in separate windows.
echo.
pause 