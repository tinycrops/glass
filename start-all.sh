#!/bin/bash

# pickleglass Integrated Startup Script
echo "🚀 pickleglass Initial Setup"

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# PID files
WEB_BACKEND_PID_FILE="./data/web_backend.pid"
WEB_FRONTEND_PID_FILE="./data/web_frontend.pid"
ELECTRON_PID_FILE="./data/electron.pid"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down applications...${NC}"
    
    # Stop web backend
    if [ -f "$WEB_BACKEND_PID_FILE" ]; then
        WEB_BACKEND_PID=$(cat "$WEB_BACKEND_PID_FILE")
        if kill -0 "$WEB_BACKEND_PID" 2>/dev/null; then
            echo -e "${BLUE}📱 Stopping web backend... (PID: $WEB_BACKEND_PID)${NC}"
            kill "$WEB_BACKEND_PID"
            rm -f "$WEB_BACKEND_PID_FILE"
        fi
    fi
    
    # Stop web frontend
    if [ -f "$WEB_FRONTEND_PID_FILE" ]; then
        WEB_FRONTEND_PID=$(cat "$WEB_FRONTEND_PID_FILE")
        if kill -0 "$WEB_FRONTEND_PID" 2>/dev/null; then
            echo -e "${BLUE}🌐 Stopping web frontend... (PID: $WEB_FRONTEND_PID)${NC}"
            kill "$WEB_FRONTEND_PID"
            rm -f "$WEB_FRONTEND_PID_FILE"
        fi
    fi
    
    # Stop Electron app
    if [ -f "$ELECTRON_PID_FILE" ]; then
        ELECTRON_PID=$(cat "$ELECTRON_PID_FILE")
        if kill -0 "$ELECTRON_PID" 2>/dev/null; then
            echo -e "${BLUE}⚡ Stopping Electron app... (PID: $ELECTRON_PID)${NC}"
            kill "$ELECTRON_PID"
            rm -f "$ELECTRON_PID_FILE"
        fi
    fi
    
    echo -e "${GREEN}✅ All applications have been stopped.${NC}"
    exit 0
}

# Signal handling (Ctrl+C etc.)
trap cleanup SIGINT SIGTERM

# Check data folder
if [ ! -d "./data" ]; then
    echo -e "${YELLOW}📁 Creating data folder...${NC}"
    mkdir -p ./data
fi

# Start web backend
echo -e "${BLUE}🔧 Starting web backend...${NC}"
cd pickleglass_web
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}🐍 Creating Python virtual environment...${NC}"
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Run backend (background)
cd backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
WEB_BACKEND_PID=$!
echo $WEB_BACKEND_PID > "../../$WEB_BACKEND_PID_FILE"
echo -e "${GREEN}✅ Web backend started (PID: $WEB_BACKEND_PID) - http://localhost:8000${NC}"

# Return to pickleglass_web directory for frontend
cd ..

# Wait a moment for backend to start
echo -e "${YELLOW}⏳ Waiting for backend initialization...${NC}"
sleep 3

# Start web frontend
echo -e "${BLUE}🌐 Starting web frontend...${NC}"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing Node.js dependencies...${NC}"
    npm install
fi

npm run dev &
WEB_FRONTEND_PID=$!
echo $WEB_FRONTEND_PID > "../$WEB_FRONTEND_PID_FILE"
echo -e "${GREEN}✅ Web frontend started (PID: $WEB_FRONTEND_PID) - http://localhost:3000${NC}"

# Return to original directory
cd ..

# Wait a moment for frontend to start
echo -e "${YELLOW}⏳ Waiting for frontend initialization...${NC}"
sleep 3

# Start Electron app
echo -e "${BLUE}⚡ Starting Electron app...${NC}"
npm start &
ELECTRON_PID=$!
echo $ELECTRON_PID > "$ELECTRON_PID_FILE"
echo -e "${GREEN}✅ Electron app started (PID: $ELECTRON_PID)${NC}"

# Status output
echo -e "\n${GREEN}🎉 All applications are running!${NC}"
echo -e "${BLUE}🔧 Web backend API: http://localhost:8000${NC}"
echo -e "${BLUE}🌐 Web frontend: http://localhost:3000${NC}"
echo -e "${BLUE}⚡ Electron app: Running in separate window${NC}"
echo -e "${BLUE}🗄️  Shared database: ./data/pickleglass.db${NC}"
echo -e "\n${YELLOW}💡 Press Ctrl+C to stop all applications${NC}"

# Infinite wait (while processes are running)
while true; do
    # Check web backend status
    if [ -f "$WEB_BACKEND_PID_FILE" ]; then
        WEB_BACKEND_PID=$(cat "$WEB_BACKEND_PID_FILE")
        if ! kill -0 "$WEB_BACKEND_PID" 2>/dev/null; then
            echo -e "${RED}❌ Web backend unexpectedly stopped.${NC}"
            rm -f "$WEB_BACKEND_PID_FILE"
        fi
    fi
    
    # Check web frontend status
    if [ -f "$WEB_FRONTEND_PID_FILE" ]; then
        WEB_FRONTEND_PID=$(cat "$WEB_FRONTEND_PID_FILE")
        if ! kill -0 "$WEB_FRONTEND_PID" 2>/dev/null; then
            echo -e "${RED}❌ Web frontend unexpectedly stopped.${NC}"
            rm -f "$WEB_FRONTEND_PID_FILE"
        fi
    fi
    
    # Check Electron app status
    if [ -f "$ELECTRON_PID_FILE" ]; then
        ELECTRON_PID=$(cat "$ELECTRON_PID_FILE")
        if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
            echo -e "${RED}❌ Electron app unexpectedly stopped.${NC}"
            rm -f "$ELECTRON_PID_FILE"
        fi
    fi
    
    sleep 5
done 