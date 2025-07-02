const express = require('express');
const db = require('../db');
const router = express.Router();
const crypto = require('crypto');

// For now, we'll continue with a single-user model for local development.
// const DEFAULT_USER_ID = 'default_user'; // REMOVED - Now using req.uid from middleware

// GET all session metadata
router.get('/', (req, res) => {
    try {
        const sessions = db.prepare(
            "SELECT id, uid, title, started_at, ended_at, sync_state, updated_at FROM sessions WHERE uid = ? ORDER BY started_at DESC"
        ).all(req.uid);
        res.json(sessions);
    } catch (error) {
        console.error('Failed to get sessions:', error);
        res.status(500).json({ error: 'Failed to retrieve sessions' });
    }
});

// POST a new session
router.post('/', (req, res) => {
    const { title } = req.body;
    const sessionId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    try {
        db.prepare(
            `INSERT INTO sessions (id, uid, title, started_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
        ).run(sessionId, req.uid, title || 'New Conversation', now, now);

        res.status(201).json({ id: sessionId, message: 'Session created successfully' });
    } catch (error) {
        console.error('Failed to create session:', error);
        res.status(500).json({ error: 'Failed to create session' });
    }
});

// GET details for a specific session
router.get('/:session_id', (req, res) => {
    const { session_id } = req.params;
    try {
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(session_id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const transcripts = db.prepare("SELECT * FROM transcripts WHERE session_id = ? ORDER BY start_at ASC").all(session_id);
        const ai_messages = db.prepare("SELECT * FROM ai_messages WHERE session_id = ? ORDER BY sent_at ASC").all(session_id);
        const summary = db.prepare("SELECT * FROM summaries WHERE session_id = ?").get(session_id);

        res.json({
            session,
            transcripts,
            ai_messages,
            summary: summary || null
        });
    } catch (error) {
        console.error(`Failed to get session ${session_id}:`, error);
        res.status(500).json({ error: 'Failed to retrieve session details' });
    }
});

// DELETE a session and all related data
router.delete('/:session_id', (req, res) => {
    const { session_id } = req.params;
    
    // Check if session exists
    const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get(session_id);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        db.transaction(() => {
            db.prepare("DELETE FROM transcripts WHERE session_id = ?").run(session_id);
            db.prepare("DELETE FROM ai_messages WHERE session_id = ?").run(session_id);
            db.prepare("DELETE FROM summaries WHERE session_id = ?").run(session_id);
            db.prepare("DELETE FROM sessions WHERE id = ?").run(session_id);
        })();
        res.status(200).json({ message: 'Session deleted successfully' });
    } catch (error) {
        console.error(`Failed to delete session ${session_id}:`, error);
        res.status(500).json({ error: 'Failed to delete session' });
    }
});

// Search across transcripts and ai_messages for a query
router.get('/search', (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    try {
        const searchQuery = `%${q}%`;
        // This query finds session_ids that have matching text in transcripts, ai_messages, or summaries
        const sessionIds = db.prepare(`
            SELECT DISTINCT session_id FROM (
                SELECT session_id FROM transcripts WHERE text LIKE ?
                UNION
                SELECT session_id FROM ai_messages WHERE content LIKE ?
                UNION
                SELECT session_id FROM summaries WHERE text LIKE ? OR tldr LIKE ?
            )
        `).all(searchQuery, searchQuery, searchQuery, searchQuery).map(row => row.session_id);

        if (sessionIds.length === 0) {
            return res.json([]);
        }

        // Using a prepared statement for IN clause requires a bit of work
        const placeholders = sessionIds.map(() => '?').join(',');
        const sessions = db.prepare(
            `SELECT id, uid, title, started_at, ended_at, sync_state, updated_at FROM sessions WHERE id IN (${placeholders}) ORDER BY started_at DESC`
        ).all(sessionIds);

        res.json(sessions);
    } catch (error) {
        console.error('Search failed:', error);
        res.status(500).json({ error: 'Failed to perform search' });
    }
});

module.exports = router; 