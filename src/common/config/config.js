// Configuration management for environment-based settings
const os = require('os');
const path = require('path');
const fs = require('fs');

class Config {
    constructor() {
        this.env = process.env.NODE_ENV || 'development';
        this.defaults = {
            // API Configuration
            apiUrl: process.env.pickleglass_API_URL || 'http://localhost:9001',
            apiTimeout: 10000,
            
            // Web Configuration
            webUrl: process.env.pickleglass_WEB_URL || 'http://localhost:3000',
            
            // Authentication (단일 사용자 시스템이므로 JWT 비활성화)
            enableJWT: false,
            fallbackToHeaderAuth: false,
            
            // Caching
            cacheTimeout: 5 * 60 * 1000, // 5 minutes
            enableCaching: true,
            
            // Polling intervals (in milliseconds)
            syncInterval: 0, // Disabled - no more sync service
            healthCheckInterval: 30 * 1000, // 30 seconds
            
            // Window Management
            defaultWindowWidth: 400,
            defaultWindowHeight: 60,
            
            // Features
            enableOfflineMode: true, // 로컬 SQLite 사용 활성화
            enableFileBasedCommunication: false, // Disabled
            enableSQLiteStorage: true, // 로컬 SQLite 저장소 활성화
            
            // Logging
            logLevel: 'info',
            enableDebugLogging: false
        };
        
        this.config = { ...this.defaults };
        this.loadEnvironmentConfig();
        this.loadUserConfig();
    }
    
    loadEnvironmentConfig() {
        // Override with environment variables
        if (process.env.pickleglass_API_URL) {
            this.config.apiUrl = process.env.pickleglass_API_URL;
            console.log(`[Config] API URL from env: ${this.config.apiUrl}`);
        }
        
        if (process.env.pickleglass_WEB_URL) {
            this.config.webUrl = process.env.pickleglass_WEB_URL;
            console.log(`[Config] Web URL from env: ${this.config.webUrl}`);
        }
        
        if (process.env.pickleglass_API_TIMEOUT) {
            this.config.apiTimeout = parseInt(process.env.pickleglass_API_TIMEOUT);
        }
        
        if (process.env.pickleglass_ENABLE_JWT) {
            this.config.enableJWT = process.env.pickleglass_ENABLE_JWT === 'true';
        }
        
        if (process.env.pickleglass_CACHE_TIMEOUT) {
            this.config.cacheTimeout = parseInt(process.env.pickleglass_CACHE_TIMEOUT);
        }
        
        if (process.env.pickleglass_LOG_LEVEL) {
            this.config.logLevel = process.env.pickleglass_LOG_LEVEL;
        }
        
        if (process.env.pickleglass_DEBUG) {
            this.config.enableDebugLogging = process.env.pickleglass_DEBUG === 'true';
        }
        
        // Environment-specific overrides
        if (this.env === 'production') {
            this.config.enableDebugLogging = false;
            this.config.logLevel = 'warn';
        } else if (this.env === 'development') {
            this.config.enableDebugLogging = true;
            this.config.logLevel = 'debug';
        }
    }
    
    loadUserConfig() {
        try {
            // Try to load user-specific config
            const userConfigPath = this.getUserConfigPath();
            if (fs.existsSync(userConfigPath)) {
                const userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
                this.config = { ...this.config, ...userConfig };
                console.log('[Config] User config loaded from:', userConfigPath);
            }
        } catch (error) {
            console.warn('[Config] Failed to load user config:', error.message);
        }
    }
    
    getUserConfigPath() {
        const configDir = path.join(os.homedir(), '.pickleglass');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        return path.join(configDir, 'config.json');
    }
    
    get(key) {
        return this.config[key];
    }
    
    set(key, value) {
        this.config[key] = value;
    }
    
    getAll() {
        return { ...this.config };
    }
    
    // Save current config to user config file
    saveUserConfig() {
        try {
            const userConfigPath = this.getUserConfigPath();
            const userConfig = { ...this.config };
            
            // Remove defaults to keep config file clean
            Object.keys(this.defaults).forEach(key => {
                if (userConfig[key] === this.defaults[key]) {
                    delete userConfig[key];
                }
            });
            
            fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
            console.log('[Config] User config saved to:', userConfigPath);
        } catch (error) {
            console.error('[Config] Failed to save user config:', error);
        }
    }
    
    // Reset to defaults
    reset() {
        this.config = { ...this.defaults };
        this.loadEnvironmentConfig();
    }
    
    // Development helpers
    isDevelopment() {
        return this.env === 'development';
    }
    
    isProduction() {
        return this.env === 'production';
    }
    
    shouldLog(level) {
        const levels = ['debug', 'info', 'warn', 'error'];
        const currentLevelIndex = levels.indexOf(this.config.logLevel);
        const requestedLevelIndex = levels.indexOf(level);
        return requestedLevelIndex >= currentLevelIndex;
    }
}

// Singleton instance
const config = new Config();

module.exports = config;