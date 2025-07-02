# pickleglass - AI Assistant

A personalized AI assistant application implemented based on screenshots.

## Features

- **Personalized Context**: Choose from various presets (School, Meetings, Sales, Recruiting, Customer Support) or create custom contexts
- **Activity Management**: Track and manage user's past activity records
- **User Profile**: Manage personal information and settings

## Tech Stack

### Frontend
- **Next.js 14**: React 프레임워크
- **TypeScript**: 타입 안전성
- **Tailwind CSS**: 스타일링
- **Lucide React**: 아이콘

### Backend
- **FastAPI**: Python 웹 프레임워크
- **MongoDB**: NoSQL 데이터베이스
- **Motor**: 비동기 MongoDB 드라이버
- **Pydantic**: 데이터 검증

## Installation and Setup

### Prerequisites

- Node.js 18+ 
- Python 3.8+
- MongoDB (local or cloud)

### 1. Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
pip install -r requirements.txt
```

### 2. Environment Variables

Create a `.env` file and add the following:

```env
MONGODB_URL=mongodb://localhost:27017
DATABASE_NAME=pickleglass
SECRET_KEY=your_secret_key_here
ENVIRONMENT=development
```

### 3. Logo Image Setup

Add the `@symbol.png` file to the `public` folder:
- Recommended size: 32x32px or 64x64px
- Format: PNG (transparent background recommended)
- Path: `public/@symbol.png`

### 4. MongoDB Setup

Make sure MongoDB is running locally or use a cloud service like MongoDB Atlas.

### 5. Run Application

**Start backend server:**
```bash
cd backend
python main.py
```

**Start frontend dev server:**
```bash
npm run dev
```

### 6. Access Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs

## Project Structure

```
pickleglass/
├── app/                    # Next.js app directory
│   ├── personalize/       # Personalize page
│   ├── activity/          # Activity page
│   └── globals.css        # Global styles
├── components/            # React components
│   └── Sidebar.tsx        # Sidebar component
├── backend/               # FastAPI backend
│   ├── main.py           # Main API server
│   ├── models.py         # Data models
│   └── database.py       # Database configuration
├── package.json          # Node.js dependencies
├── requirements.txt      # Python dependencies
└── README.md            # Project documentation
```

## API Endpoints

### User Management
- `GET /api/user/profile` - Get user profile
- `GET /api/user/context` - Get user context
- `POST /api/user/context` - Update user context

### Activity Management
- `GET /api/user/activities` - Get user activity list
- `POST /api/user/activities` - Add new activity

## Development

### Code Style
- Frontend: ESLint + Prettier
- Backend: Black + isort

### Build
```bash
# Build frontend
npm run build

# Run frontend
npm start
```

## Deployment

For production environment, consider:

1. Secure environment variable configuration
2. MongoDB connection security settings
3. HTTPS usage
4. User authentication system implementation
5. Error logging and monitoring

## License

MIT License 