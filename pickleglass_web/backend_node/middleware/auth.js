const { verify } = require('../jwt');

function identifyUser(req, res, next) {
    const userId = req.get('X-User-ID');

    if (userId) {
        req.uid = userId;
    } else {
        // Fallback to default user for local mode if no user ID is provided
        req.uid = 'default_user';
    }
    
    next();
}

module.exports = { identifyUser }; 