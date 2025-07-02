# 🚀 pickleglass Integrated Startup Guide

pickleglass is an integrated system where Electron app and web app share a SQLite database.

## 📋 System Requirements

- **Node.js** (v16 or higher)
- **Python** (v3.9 or higher)
- **npm** or **yarn**

## 🎯 One-Click Startup

### macOS/Linux Users

```bash
./start-all.sh
```

### Windows Users

```cmd
start-all.bat
```

## 🔧 Manual Startup (For Development)

### 1. Start Web Backend

```bash
cd pickleglass_web
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cd backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Start Web Frontend

```bash
# In a new terminal
cd pickleglass_web
npm install
npm run dev
```

### 3. Start Electron App

```bash
# In a new terminal
npm install
npm start
```

## 🌐 Access Information

- **Web Frontend**: http://localhost:3000
- **Web Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Electron App**: Automatically runs in separate window
- **Shared Database**: `./data/pickleglass.db`

## 📊 Key Features

### Shared Data
- ✅ Preset Templates (5 default templates)
- ✅ Conversation History (Electron ↔ Web App shared)
- ✅ User Settings

### Electron App
- 🎤 Real-time Speech Recognition
- 📸 Screen Capture
- 💬 AI Conversation History
- 📋 History View

### Web App
- 🎨 Preset Personalization (`/personalize`)
- 📊 Activity Records (`/activity`)
- ⚙️ Settings Management (`/settings`)
- 🔍 Search Functionality (`/search`)

## 🛑 Shutdown

### When Using Integrated Script
- Press `Ctrl + C` to stop all applications

### When Running Manually
- Press `Ctrl + C` in each terminal to stop individually

## 🗂️ Project Structure

```
pickleglass/
├── data/                    # Shared SQLite database
│   └── pickleglass.db
├── src/                     # Electron app source
├── pickleglass_web/            # Web app source
│   ├── app/                # Next.js pages
│   └── backend/            # FastAPI backend
├── start-all.sh            # macOS/Linux integrated startup
├── start-all.bat           # Windows integrated startup
└── START_GUIDE.md          # This file
```

## 🔧 Troubleshooting

### Port Conflicts
- **Port 3000** (Web Frontend): If in use, stop other applications or change the port in `pickleglass_web/package.json`
- **Port 8000** (Web Backend): If in use, stop other applications or change the port in startup scripts

### Dependency Errors
```bash
# Reinstall Python dependencies
cd pickleglass_web
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Reinstall Node.js dependencies (Web)
cd pickleglass_web
rm -rf node_modules
npm install

# Reinstall Node.js dependencies (Electron)
rm -rf node_modules
npm install
```

### Database Reset
```bash
rm -f data/pickleglass.db
# It will be automatically recreated when you run again
```

## 💡 Development Tips

- **Web backend** runs with `--reload` option for automatic restart on code changes
- **Web frontend** runs with Next.js dev mode for hot reloading
- **Electron app** runs in development mode with developer tools available
- Real-time data synchronization between all apps through shared database

## 🌍 Application Ports

| Application | Port | URL |
|------------|------|-----|
| Web Frontend | 3000 | http://localhost:3000 |
| Web Backend API | 8000 | http://localhost:8000 |
| API Documentation | 8000 | http://localhost:8000/docs |
| Electron App | - | Desktop Application 