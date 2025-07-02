#!/bin/bash

echo "🚀 Starting pickleglass development environment..."

# Check if MongoDB is running
if ! pgrep -x "mongod" > /dev/null; then
    echo "⚠️  MongoDB is not running. Please start MongoDB first."
    echo "   brew services start mongodb-community (macOS)"
    echo "   sudo systemctl start mongod (Linux)"
    exit 1
fi

# Activate virtual environment if exists
if [ -d "venv" ]; then
    echo "🐍 Activating Python virtual environment..."
    source venv/bin/activate
fi

# Start backend server in background
echo "🔧 Starting FastAPI backend server..."
cd backend && python main.py &
BACKEND_PID=$!
cd ..

# Wait for backend server to start
sleep 3

# Start frontend dev server
echo "⚛️  Starting Next.js frontend server..."
npm run dev &
FRONTEND_PID=$!

# Handle termination signals
trap 'echo "🛑 Stopping servers..."; kill $BACKEND_PID $FRONTEND_PID; exit' INT

echo ""
echo "✅ Servers started successfully!"
echo "   Frontend: http://localhost:3000"
echo "   Backend API: http://localhost:8000"
echo "   API Documentation: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop the servers."

# Wait for processes to end
wait 