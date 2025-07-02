const axios = require('axios');
const config = require('../config/config');

class APIClient {
    constructor() {
        this.baseURL = config.get('apiUrl');
        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: config.get('apiTimeout'),
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // 응답 인터셉터 - 에러 처리
        this.client.interceptors.response.use(
            (response) => response,
            (error) => {
                console.error('API 요청 실패:', error.message);
                if (error.response) {
                    console.error('응답 상태:', error.response.status);
                    console.error('응답 데이터:', error.response.data);
                }
                return Promise.reject(error);
            }
        );
    }

    // 단일 사용자 시스템에서는 초기화만 필요
    async initialize() {
        try {
            const response = await this.client.get('/api/auth/status');
            console.log('[APIClient] 기본 사용자 상태 확인 완료:', response.data);
            return true;
        } catch (error) {
            console.error('[APIClient] 초기화 실패:', error);
            return false;
        }
    }

    async checkConnection() {
        try {
            const response = await this.client.get('/');
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    // API 키 관리
    async saveApiKey(apiKey) {
        try {
            const response = await this.client.post('/api/user/api-key', { apiKey });
            return response.data;
        } catch (error) {
            console.error('API 키 저장 실패:', error);
            throw error;
        }
    }

    async checkApiKey() {
        try {
            const response = await this.client.get('/api/user/api-key');
            return response.data;
        } catch (error) {
            console.error('API 키 확인 실패:', error);
            return { hasApiKey: false };
        }
    }

    // Batched API call to get multiple user data types efficiently
    async getUserBatchData(includes = ['profile', 'context', 'presets']) {
        try {
            const includeParam = includes.join(',');
            const response = await this.client.get(`/api/user/batch?include=${includeParam}`);
            return response.data;
        } catch (error) {
            console.error('배치 사용자 데이터 조회 실패:', error);
            return null;
        }
    }

    // Individual API methods
    async getUserContext() {
        try {
            const response = await this.client.get('/api/user/context');
            return response.data.context;
        } catch (error) {
            console.error('사용자 컨텍스트 조회 실패:', error);
            return null;
        }
    }

    async getUserProfile() {
        try {
            const response = await this.client.get('/api/user/profile');
            return response.data;
        } catch (error) {
            console.error('사용자 프로필 조회 실패:', error);
            return null;
        }
    }

    async getUserPresets() {
        try {
            const response = await this.client.get('/api/user/presets');
            return response.data;
        } catch (error) {
            console.error('사용자 프리셋 조회 실패:', error);
            return [];
        }
    }

    async updateUserContext(context) {
        try {
            const response = await this.client.post('/api/user/context', context);
            return response.data;
        } catch (error) {
            console.error('사용자 컨텍스트 업데이트 실패:', error);
            throw error;
        }
    }

    async addActivity(activity) {
        try {
            const response = await this.client.post('/api/user/activities', activity);
            return response.data;
        } catch (error) {
            console.error('활동 추가 실패:', error);
            throw error;
        }
    }

    // 프리셋 템플릿 조회 (기본 프리셋들)
    async getPresetTemplates() {
        try {
            const response = await this.client.get('/api/preset-templates');
            return response.data;
        } catch (error) {
            console.error('프리셋 템플릿 조회 실패:', error);
            return [];
        }
    }

    async updateUserProfile(profile) {
        try {
            const response = await this.client.post('/api/user/profile', profile);
            return response.data;
        } catch (error) {
            console.error('사용자 프로필 업데이트 실패:', error);
            throw error;
        }
    }

    // 사용자 검색
    async searchUsers(name = '') {
        try {
            const response = await this.client.get('/api/users/search', {
                params: { name }
            });
            return response.data;
        } catch (error) {
            console.error('사용자 검색 실패:', error);
            return [];
        }
    }

    async getUserProfileById(userId) {
        try {
            const response = await this.client.get(`/api/users/${userId}/profile`);
            return response.data;
        } catch (error) {
            console.error('사용자 프로필 조회 실패:', error);
            return null;
        }
    }

    // 대화 세션 관리
    async saveConversationSession(sessionId, conversationHistory) {
        try {
            const payload = {
                sessionId,
                conversationHistory
            };
            const response = await this.client.post('/api/conversations', payload);
            return response.data;
        } catch (error) {
            console.error('대화 세션 저장 실패:', error);
            throw error;
        }
    }

    async getConversationSession(sessionId) {
        try {
            const response = await this.client.get(`/api/conversations/${sessionId}`);
            return response.data;
        } catch (error) {
            console.error('대화 세션 조회 실패:', error);
            return null;
        }
    }

    async getAllConversationSessions() {
        try {
            const response = await this.client.get('/api/conversations');
            return response.data;
        } catch (error) {
            console.error('대화 세션 목록 조회 실패:', error);
            return [];
        }
    }

    async deleteConversationSession(sessionId) {
        try {
            const response = await this.client.delete(`/api/conversations/${sessionId}`);
            return response.data;
        } catch (error) {
            console.error('대화 세션 삭제 실패:', error);
            throw error;
        }
    }

    // 동기화 관련
    async getSyncStatus() {
        try {
            const response = await this.client.get('/api/sync/status');
            return response.data;
        } catch (error) {
            console.error('동기화 상태 확인 실패:', error);
            return null;
        }
    }

    async getFullUserData() {
        try {
            const response = await this.client.get('/api/user/full');
            return response.data;
        } catch (error) {
            console.error('전체 사용자 데이터 조회 실패:', error);
            return null;
        }
    }
}

// 싱글톤 인스턴스
const apiClient = new APIClient();

module.exports = apiClient; 
module.exports = apiClient; 