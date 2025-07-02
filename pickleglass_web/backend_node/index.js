const express = require('express');
const cors = require('cors');
const db = require('./db');
const { identifyUser } = require('./middleware/auth');

// 앱을 생성하는 함수로 변경 (환경변수가 설정된 후 호출)
function createApp() {
    const app = express();

    // 환경변수 확인 및 로깅
    const webUrl = process.env.pickleglass_WEB_URL || 'http://localhost:3000';
    console.log(`🔧 Backend CORS configured for: ${webUrl}`);

    // CORS 미들웨어 설정 (환경변수 기반)
    app.use(cors({
        origin: webUrl,
        credentials: true,
    }));

    app.use(express.json());

    app.get('/', (req, res) => {
        res.json({ message: "pickleglass API is running" });
    });

    // Apply the user identification middleware to all /api routes
    app.use('/api', identifyUser);

    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/user', require('./routes/user'));
    app.use('/api/conversations', require('./routes/conversations'));
    app.use('/api/presets', require('./routes/presets'));

    app.get('/api/sync/status', (req, res) => {
        res.json({
            status: 'online',
            timestamp: new Date().toISOString(),
            version: '1.0.0'
        });
    });

    // Deprecated desktop routes
    app.post('/api/desktop/set-user', (req, res) => {
        res.json({
            success: true,
            message: "Direct IPC communication is now used. This endpoint is deprecated.",
            user: req.body,
            deprecated: true
        });
    });

    app.get('/api/desktop/status', (req, res) => {
        res.json({
            connected: true,
            current_user: null,
            communication_method: "IPC",
            file_based_deprecated: true
        });
    });

    return app;
}

module.exports = createApp; // 함수를 export
