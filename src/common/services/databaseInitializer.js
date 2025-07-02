const fs = require('fs');
const path = require('path');
const sqliteClient = require('./sqliteClient');
const config = require('../config/config');

class DatabaseInitializer {
    constructor() {
        this.isInitialized = false;
        this.dbPath = path.join(__dirname, '../../../data/pickleglass.db');
        this.dataDir = path.join(__dirname, '../../../data');
    }

    async initialize() {
        if (this.isInitialized) {
            console.log('[DatabaseInitializer] Already initialized');
            return true;
        }

        try {
            console.log('[DatabaseInitializer] Starting database initialization...');
            
            // 1. 데이터 디렉토리 확인 및 생성
            await this.ensureDataDirectory();
            
            // 2. 데이터베이스 파일 존재 여부 확인
            const dbExists = await this.checkDatabaseExists();
            
            if (!dbExists) {
                console.log('[DatabaseInitializer] Database not found - creating new database...');
                await this.createNewDatabase();
            } else {
                console.log('[DatabaseInitializer] Database found - connecting to existing database...');
                await this.connectToExistingDatabase();
            }

            // 3. 기본 데이터 검증 및 복구
            await this.validateAndRecoverData();

            this.isInitialized = true;
            console.log('[DatabaseInitializer] Database initialization completed successfully');
            return true;

        } catch (error) {
            console.error('[DatabaseInitializer] Database initialization failed:', error);
            return false;
        }
    }

    async ensureDataDirectory() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
                console.log('[DatabaseInitializer] Data directory created:', this.dataDir);
            } else {
                console.log('[DatabaseInitializer] Data directory exists:', this.dataDir);
            }
        } catch (error) {
            console.error('[DatabaseInitializer] Failed to create data directory:', error);
            throw error;
        }
    }

    async checkDatabaseExists() {
        try {
            const exists = fs.existsSync(this.dbPath);
            console.log('[DatabaseInitializer] Database file check:', { path: this.dbPath, exists });
            return exists;
        } catch (error) {
            console.error('[DatabaseInitializer] Error checking database file:', error);
            return false;
        }
    }

    async createNewDatabase() {
        console.log('[DatabaseInitializer] Creating new database...');
        try {
            await sqliteClient.connect(); // Connect and initialize tables/default data
            
            // We now rely on initDefaultData to create the user, so we just fetch it.
            const user = await sqliteClient.getUser(sqliteClient.defaultUserId);
            if (!user) {
                throw new Error('Default user was not created during initialization.');
            }
            
            console.log(`[DatabaseInitializer] Default user check successful, UID: ${user.uid}`);
            return { success: true, user };

        } catch (error) {
            console.error('[DatabaseInitializer] Failed to create new database:', error);
            throw error;
        }
    }

    async connectToExistingDatabase() {
        console.log('[DatabaseInitializer] Connecting to existing database...');
        try {
            await sqliteClient.connect();
            
            const user = await sqliteClient.getUser(sqliteClient.defaultUserId);
            if (!user) {
                console.warn('[DatabaseInitializer] Default user not found in existing DB, attempting recovery.');
                throw new Error('Default user missing');
            }
            
            console.log(`[DatabaseInitializer] Connection to existing DB successful for user: ${user.uid}`);
            return { success: true, user };

        } catch (error) {
            console.error('[DatabaseInitializer] Failed to connect to existing database:', error);
            throw error;
        }
    }

    async validateAndRecoverData() {
        console.log('[DatabaseInitializer] Validating database integrity...');
        try {
            console.log('[DatabaseInitializer] Validating database integrity...');

            // 1. Default user 테이블 검증
            const defaultUser =  await sqliteClient.getUser(sqliteClient.defaultUserId);
            if (!defaultUser) {
                console.log('[DatabaseInitializer] Default user not found - creating...');
                await sqliteClient.initDefaultData();
            }

            // 2. 프리셋 템플릿 검증
            const presetTemplates = await sqliteClient.getPresets('default_user');
            if (!presetTemplates || presetTemplates.length === 0) {
                console.log('[DatabaseInitializer] Preset templates missing - creating...');
                await sqliteClient.initDefaultData();
            }

            console.log('[DatabaseInitializer] Database validation completed');
            return { success: true };

        } catch (error) {
            console.error('[DatabaseInitializer] Database validation failed:', error);
            // 검증 실패 시 기본 데이터 재생성
            try {
                await sqliteClient.initDefaultData();
                console.log('[DatabaseInitializer] Default data recovered');
                return { success: true };
            } catch (error) {
                console.error('[DatabaseInitializer] Database validation failed:', error);
                throw error;
            }
        }
    }

    async getStatus() {
        return {
            isInitialized: this.isInitialized,
            dbPath: this.dbPath,
            dbExists: fs.existsSync(this.dbPath),
            enableSQLiteStorage: config.get('enableSQLiteStorage'),
            enableOfflineMode: config.get('enableOfflineMode')
        };
    }

    async reset() {
        try {
            console.log('[DatabaseInitializer] Resetting database...');
            
            // SQLite 연결 종료
            sqliteClient.close();
            
            // 데이터베이스 파일 삭제
            if (fs.existsSync(this.dbPath)) {
                fs.unlinkSync(this.dbPath);
                console.log('[DatabaseInitializer] Database file deleted');
            }

            // 재초기화
            this.isInitialized = false;
            await this.initialize();

            console.log('[DatabaseInitializer] Database reset completed');
            return true;

        } catch (error) {
            console.error('[DatabaseInitializer] Database reset failed:', error);
            return false;
        }
    }

    close() {
        if (sqliteClient) {
            sqliteClient.close();
        }
        this.isInitialized = false;
        console.log('[DatabaseInitializer] Database connection closed');
    }
}

// 싱글톤 인스턴스
const databaseInitializer = new DatabaseInitializer();

module.exports = databaseInitializer; 