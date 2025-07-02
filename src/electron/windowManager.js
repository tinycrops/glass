const { BrowserWindow, globalShortcut, ipcMain, screen, app, shell, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('os');
const util = require('util');
const execFile = util.promisify(require('child_process').execFile);
const sharp = require('sharp');
// Use the shared SQLite client instead of touching backend DB directly
const sqliteClient = require('../common/services/sqliteClient');
const fetch = require('node-fetch');

let currentFirebaseUser = null;
let userFileWatcher = null;
let isContentProtectionOn = true; // State for content protection

let mouseEventsIgnored = false;
let lastVisibleWindows = new Set(['header']); // For visibility toggle
const HEADER_HEIGHT = 60; // Define a constant for the header height
const DEFAULT_WINDOW_WIDTH = 345; // Define a default width
const PADDING = 6; // Reduced gap between header and features

const windowPool = new Map();
let fixedYPosition = 0; // To store the fixed Y position of the header
let lastScreenshot = null;
let isCapturing = false;

let settingsHideTimer = null;

/**
 * 창 레이아웃 매니저 - 헤더 위치에 따른 동적 배치
 */
class WindowLayoutManager {
    constructor() {
        this.isUpdating = false;
        this.PADDING = 80; // 창 간 간격 - Settings 위치 계산용
    }
    
    updateLayout() {
        if (this.isUpdating) return;
        this.isUpdating = true;
        
        // 다음 틱에서 실행 (UI 블로킹 방지)
        setImmediate(() => {
            this.positionWindows();
            this.isUpdating = false;
        });
    }
    
    positionWindows() {
        const header = windowPool.get('header');
        if (!header?.getBounds) return;
        
        const headerBounds = header.getBounds();
        const display = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = display.workAreaSize;
        
        // 헤더 위치 분석
        const headerCenterX = headerBounds.x + headerBounds.width / 2;
        const headerCenterY = headerBounds.y + headerBounds.height / 2;
        
        // 화면에서의 상대적 위치 계산 (0-1 범위)
        const relativeX = headerCenterX / screenWidth;
        const relativeY = headerCenterY / screenHeight;
        
        // 동적 배치 전략 결정
        const strategy = this.determineLayoutStrategy(headerBounds, screenWidth, screenHeight, relativeX, relativeY);
        
        // Listen/Ask 창 그룹 위치 계산
        this.positionFeatureWindows(headerBounds, strategy, screenWidth, screenHeight);
        
        // Settings 창 위치 계산
        this.positionSettingsWindow(headerBounds, strategy, screenWidth, screenHeight);
    }
    
    // 레이아웃 전략 결정
    determineLayoutStrategy(headerBounds, screenWidth, screenHeight, relativeX, relativeY) {
        const spaceBelow = screenHeight - (headerBounds.y + headerBounds.height);
        const spaceAbove = headerBounds.y;
        const spaceLeft = headerBounds.x;
        const spaceRight = screenWidth - (headerBounds.x + headerBounds.width);
        
        // 각 방향별 여유 공간
        const spaces = {
            below: spaceBelow,
            above: spaceAbove,
            left: spaceLeft,
            right: spaceRight
        };
        
        // 창들을 배치할 최적의 방향 결정
        if (spaceBelow >= 400) {
            // 아래쪽에 충분한 공간이 있으면 아래 배치 (기본)
            return {
                name: 'below',
                primary: 'below',
                secondary: relativeX < 0.5 ? 'right' : 'left'
            };
        } else if (spaceAbove >= 400) {
            // 위쪽에 공간이 있으면 위 배치
            return {
                name: 'above',
                primary: 'above',
                secondary: relativeX < 0.5 ? 'right' : 'left'
            };
        } else if (relativeX < 0.3 && spaceRight >= 800) {
            // 헤더가 왼쪽에 있고 오른쪽에 공간이 있으면 오른쪽 배치
            return {
                name: 'right-side',
                primary: 'right',
                secondary: spaceBelow > spaceAbove ? 'below' : 'above'
            };
        } else if (relativeX > 0.7 && spaceLeft >= 800) {
            // 헤더가 오른쪽에 있고 왼쪽에 공간이 있으면 왼쪽 배치
            return {
                name: 'left-side',
                primary: 'left',
                secondary: spaceBelow > spaceAbove ? 'below' : 'above'
            };
        } else {
            // 공간이 부족하면 적응형 배치
            return {
                name: 'adaptive',
                primary: spaceBelow > spaceAbove ? 'below' : 'above',
                secondary: spaceRight > spaceLeft ? 'right' : 'left'
            };
        }
    }
    
    positionFeatureWindows(headerBounds, strategy, screenWidth, screenHeight) {
        const ask = windowPool.get('ask');
        const listen = windowPool.get('listen');
        const askVisible = ask && ask.isVisible() && !ask.isDestroyed();
        const listenVisible = listen && listen.isVisible() && !listen.isDestroyed();

        if (!askVisible && !listenVisible) return;

        const PAD = 8; // 창 간격
        const headerCenterX = headerBounds.x + headerBounds.width / 2;

        let askBounds = askVisible ? ask.getBounds() : null;
        let listenBounds = listenVisible ? listen.getBounds() : null;

        // Case 1: Ask, Listen 둘 다 보일 때
        if (askVisible && listenVisible) {
            const combinedWidth = listenBounds.width + PAD + askBounds.width;
            let groupStartX = headerCenterX - combinedWidth / 2;
            let y;

            switch (strategy.primary) {
                case 'below':
                    y = headerBounds.y + headerBounds.height + PAD;
                    break;
                case 'above':
                    y = headerBounds.y - Math.max(askBounds.height, listenBounds.height) - PAD;
                    break;
                // side-by-side 배치는 복잡도가 높으므로 일단 아래/위만 고려
                default:
                    y = headerBounds.y + headerBounds.height + PAD;
                    break;
            }

            let listenX = groupStartX;
            let askX = groupStartX + listenBounds.width + PAD;

            // 화면 경계 체크
            if (listenX < PAD) {
                listenX = PAD;
                askX = listenX + listenBounds.width + PAD;
            }
            if (askX + askBounds.width > screenWidth - PAD) {
                askX = screenWidth - PAD - askBounds.width;
                listenX = askX - listenBounds.width - PAD;
            }

            listen.setBounds({ x: Math.round(listenX), y: Math.round(y), width: listenBounds.width, height: listenBounds.height });
            ask.setBounds({ x: Math.round(askX), y: Math.round(y), width: askBounds.width, height: askBounds.height });
            
            // console.log(`[Layout] Group Listen at (${Math.round(listenX)}, ${Math.round(y)}), Ask at (${Math.round(askX)}, ${Math.round(y)})`);

        } else {
            // Case 2: 하나만 보일 때
            const win = askVisible ? ask : listen;
            const winBounds = askVisible ? askBounds : listenBounds;
            
            let x = headerCenterX - winBounds.width / 2;
            let y;

            switch (strategy.primary) {
                case 'below':
                    y = headerBounds.y + headerBounds.height + PAD;
                    break;
                case 'above':
                    y = headerBounds.y - winBounds.height - PAD;
                    break;
                default:
                    y = headerBounds.y + headerBounds.height + PAD;
                    break;
            }

            // 화면 경계 체크
            x = Math.max(PAD, Math.min(screenWidth - winBounds.width - PAD, x));
            y = Math.max(PAD, Math.min(screenHeight - winBounds.height - PAD, y));
            
            win.setBounds({ x: Math.round(x), y: Math.round(y), width: winBounds.width, height: winBounds.height });
            // console.log(`[Layout] Single ${askVisible ? 'Ask' : 'Listen'} at (${Math.round(x)}, ${Math.round(y)})`);
        }
    }
    
    positionSettingsWindow(headerBounds, strategy, screenWidth, screenHeight) {
        const settings = windowPool.get('settings');
        if (!settings?.getBounds || !settings.isVisible()) return;

        if (settings.__lockedByButton) return;
        
        const settingsBounds = settings.getBounds();
        const PAD = 5; // 설정창은 가까이 배치
        
        // Settings 버튼은 헤더의 맨 오른쪽에 위치
        // 설정 버튼 바로 아래에 배치 (기본 위치)
        const buttonPadding = 17; // 헤더 오른쪽 패딩 고려
        let x = headerBounds.x + headerBounds.width - settingsBounds.width - buttonPadding;
        let y = headerBounds.y + headerBounds.height + PAD;
        
        // 다른 보이는 창들과 겹치는지 확인
        const otherVisibleWindows = [];
        ['listen', 'ask'].forEach(name => {
            const win = windowPool.get(name);
            if (win && win.isVisible() && !win.isDestroyed()) {
                otherVisibleWindows.push({
                    name,
                    bounds: win.getBounds()
                });
            }
        });
        
        // 겹침 확인 및 조정
        const settingsNewBounds = { x, y, width: settingsBounds.width, height: settingsBounds.height };
        let hasOverlap = false;
        
        for (const otherWin of otherVisibleWindows) {
            if (this.boundsOverlap(settingsNewBounds, otherWin.bounds)) {
                hasOverlap = true;
                // console.log(`[Layout] Settings would overlap with ${otherWin.name}, adjusting position`);
                break;
            }
        }
        
        // 겹침이 있으면 대안 위치 시도
        if (hasOverlap) {
            // 1순위: 헤더 오른쪽 옆에 배치
            x = headerBounds.x + headerBounds.width + PAD;
            y = headerBounds.y;
            settingsNewBounds.x = x;
            settingsNewBounds.y = y;
            
            // 오른쪽 경계 체크
            if (x + settingsBounds.width > screenWidth - 10) {
                // 2순위: 헤더 왼쪽 옆에 배치
                x = headerBounds.x - settingsBounds.width - PAD;
                settingsNewBounds.x = x;
            }
            
            // 왼쪽 경계 체크
            if (x < 10) {
                // 3순위: 헤더 위쪽에 배치
                x = headerBounds.x + headerBounds.width - settingsBounds.width - buttonPadding;
                y = headerBounds.y - settingsBounds.height - PAD;
                settingsNewBounds.x = x;
                settingsNewBounds.y = y;
                
                // 위쪽도 화면 밖이면 다시 아래로 (오른쪽 끝으로 이동)
                if (y < 10) {
                    x = headerBounds.x + headerBounds.width - settingsBounds.width;
                    y = headerBounds.y + headerBounds.height + PAD;
                }
            }
        }
        
        // 최종 화면 경계 체크
        x = Math.max(10, Math.min(screenWidth - settingsBounds.width - 10, x));
        y = Math.max(10, Math.min(screenHeight - settingsBounds.height - 10, y));
        
        settings.setBounds({ x, y });
        settings.moveTop();
        
        // console.log(`[Layout] Settings positioned at (${x}, ${y}) ${hasOverlap ? '(adjusted for overlap)' : '(default position)'}`);
    }
    
    // 두 bounds가 겹치는지 확인하는 유틸리티 함수
    boundsOverlap(bounds1, bounds2) {
        const margin = 10; // 10px 여백으로 겹침 판정
        return !(
            bounds1.x + bounds1.width + margin < bounds2.x ||
            bounds2.x + bounds2.width + margin < bounds1.x ||
            bounds1.y + bounds1.height + margin < bounds2.y ||
            bounds2.y + bounds2.height + margin < bounds1.y
        );
    }
    
    isWindowVisible(windowName) {
        const window = windowPool.get(windowName);
        return window && !window.isDestroyed() && window.isVisible();
    }
    
    destroy() {
        // 정리할 것이 없음
    }
}

class SmoothMovementManager {
    constructor() {
        this.stepSize = 80; // 한 번에 이동할 거리 증가 (50 → 80픽셀)
        this.animationDuration = 300; // 애니메이션 지속 시간 증가 (150 → 300ms)
        this.headerPosition = { x: 0, y: 0 };
        this.isAnimating = false;
        this.hiddenPosition = null; // 숨겨진 위치 저장
        this.lastVisiblePosition = null; // 마지막 보였던 위치 저장
    }
    
    // 동적으로 가장 가까운 가장자리로 숨기기
    hideToEdge(edge, callback) {
        const header = windowPool.get('header');
        if (!header || !header.isVisible() || this.isAnimating) return;
        
        console.log(`[Movement] Hiding to ${edge} edge`);
        
        // 현재 위치 저장 (나중에 복원용)
        const currentBounds = header.getBounds();
        this.lastVisiblePosition = { x: currentBounds.x, y: currentBounds.y };
        this.headerPosition = { x: currentBounds.x, y: currentBounds.y };
        
        // 화면 정보 가져오기
        const display = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = display.workAreaSize;
        const headerBounds = header.getBounds();
        
        // 목표 위치 계산 (화면 밖으로)
        let targetX = this.headerPosition.x;
        let targetY = this.headerPosition.y;
        
        switch(edge) {
            case 'top':
                targetY = -headerBounds.height - 20; // 완전히 위로 사라지기
                break;
            case 'bottom':
                targetY = screenHeight + 20; // 완전히 아래로 사라지기
                break;
            case 'left':
                targetX = -headerBounds.width - 20; // 완전히 왼쪽으로 사라지기
                break;
            case 'right':
                targetX = screenWidth + 20; // 완전히 오른쪽으로 사라지기
                break;
        }
        
        this.hiddenPosition = { x: targetX, y: targetY, edge };
        
        // 부드러운 사라짐 애니메이션
        this.isAnimating = true;
        const startX = this.headerPosition.x;
        const startY = this.headerPosition.y;
        const duration = 400; // 부드럽게 사라지기
        const startTime = Date.now();
        
        const animate = () => {
            if (!header || header.isDestroyed()) {
                this.isAnimating = false;
                return;
            }
            
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // easeInCubic 이징 (점점 빨라지면서 사라지기)
            const eased = progress * progress * progress;
            
            const currentX = startX + (targetX - startX) * eased;
            const currentY = startY + (targetY - startY) * eased;

            if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
                console.error('[Movement] Invalid animation values for hide:', { currentX, currentY, progress, eased });
                this.isAnimating = false;
                return;
            }
            
            header.setPosition(Math.round(currentX), Math.round(currentY));
            
            if (progress < 1) {
                setTimeout(animate, 8); // 120fps
            } else {
                // 사라짐 애니메이션 완료
                this.headerPosition = { x: targetX, y: targetY };
                this.isAnimating = false;
                
                if (callback) callback();
                
                console.log(`[Movement] Hide to ${edge} completed`);
            }
        };
        
        animate();
    }
    
    // 숨겨진 위치에서 원래 위치로 부드럽게 나타나기
    showFromEdge(callback) {
        const header = windowPool.get('header');
        if (!header || this.isAnimating || !this.hiddenPosition || !this.lastVisiblePosition) return;
        
        console.log(`[Movement] Showing from ${this.hiddenPosition.edge} edge`);
        
        // 숨겨진 위치에서 시작
        header.setPosition(this.hiddenPosition.x, this.hiddenPosition.y);
        this.headerPosition = { x: this.hiddenPosition.x, y: this.hiddenPosition.y };
        
        // 목표 위치 (원래 보였던 위치)
        const targetX = this.lastVisiblePosition.x;
        const targetY = this.lastVisiblePosition.y;
        
        // 부드러운 나타남 애니메이션
        this.isAnimating = true;
        const startX = this.headerPosition.x;
        const startY = this.headerPosition.y;
        const duration = 500; // 천천히 나타나기
        const startTime = Date.now();
        
        const animate = () => {
            if (!header || header.isDestroyed()) {
                this.isAnimating = false;
                return;
            }
            
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // easeOutBack 이징 (살짝 오버슈트하면서 나타나기)
            const c1 = 1.70158;
            const c3 = c1 + 1;
            const eased = 1 + c3 * Math.pow(progress - 1, 3) + c1 * Math.pow(progress - 1, 2);
            
            const currentX = startX + (targetX - startX) * eased;
            const currentY = startY + (targetY - startY) * eased;
            
            // 값 검증 추가
            if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
                console.error('[Movement] Invalid animation values for show:', { currentX, currentY, progress, eased });
                this.isAnimating = false;
                return;
            }

            header.setPosition(Math.round(currentX), Math.round(currentY));
            
            if (progress < 1) {
                setTimeout(animate, 8); // 120fps
            } else {
                // 나타남 애니메이션 완료
                this.headerPosition = { x: targetX, y: targetY };
                header.setPosition(targetX, targetY);
                this.isAnimating = false;
                
                // 저장된 위치 정보 초기화
                this.hiddenPosition = null;
                this.lastVisiblePosition = null;
                
                if (callback) callback();
                
                console.log(`[Movement] Show from edge completed`);
            }
        };
        
        animate();
    }
    
    // 단발성 스텝 이동
    moveStep(direction) {
        const header = windowPool.get('header');
        if (!header || !header.isVisible() || this.isAnimating) return;
        
        console.log(`[Movement] Step ${direction}`);
        
        // 현재 위치 가져오기
        const currentBounds = header.getBounds();
        this.headerPosition = { x: currentBounds.x, y: currentBounds.y };
        
        // 목표 위치 계산
        let targetX = this.headerPosition.x;
        let targetY = this.headerPosition.y;
        
        switch(direction) {
            case 'left':
                targetX -= this.stepSize;
                break;
            case 'right':
                targetX += this.stepSize;
                break;
            case 'up':
                targetY -= this.stepSize;
                break;
            case 'down':
                targetY += this.stepSize;
                break;
            default:
                return;
        }
        
        // 화면 경계 체크
        const display = screen.getPrimaryDisplay();
        const { width, height } = display.workAreaSize;
        const headerBounds = header.getBounds();
        
        targetX = Math.max(0, Math.min(width - headerBounds.width, targetX));
        targetY = Math.max(0, Math.min(height - headerBounds.height, targetY));
        
        // 실제로 이동할 거리가 있는지 확인
        if (targetX === this.headerPosition.x && targetY === this.headerPosition.y) {
            console.log(`[Movement] Already at boundary for ${direction}`);
            return;
        }
        
        // 부드러운 애니메이션으로 이동
        this.animateToPosition(header, targetX, targetY);
    }
    
    // 부드러운 애니메이션
    animateToPosition(header, targetX, targetY) {
        this.isAnimating = true;
        
        const startX = this.headerPosition.x;
        const startY = this.headerPosition.y;
        const startTime = Date.now();
        
        // 입력값 검증
        if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || 
            !Number.isFinite(startX) || !Number.isFinite(startY)) {
            console.error('[Movement] Invalid position values:', { startX, startY, targetX, targetY });
            this.isAnimating = false;
            return;
        }
        
        const animate = () => {
            if (!header || header.isDestroyed()) {
                this.isAnimating = false;
                return;
            }
            
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / this.animationDuration, 1);
            
            // easeOutCubic 이징 (더 부드러운 감속)
            const eased = 1 - Math.pow(1 - progress, 3);
            
            const currentX = startX + (targetX - startX) * eased;
            const currentY = startY + (targetY - startY) * eased;
            
            // 값 검증 추가
            if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
                console.error('[Movement] Invalid animation values:', { currentX, currentY, progress, eased });
                this.isAnimating = false;
                return;
            }
            
            header.setPosition(Math.round(currentX), Math.round(currentY));
            
            if (progress < 1) {
                setTimeout(animate, 8); // 더 높은 프레임레이트 (120fps)
            } else {
                // 애니메이션 완료
                this.headerPosition.x = targetX;
                this.headerPosition.y = targetY;
                header.setPosition(targetX, targetY);
                this.isAnimating = false;
                
                // 레이아웃 업데이트
                updateLayout();
                
                console.log(`[Movement] Step completed to (${targetX}, ${targetY})`);
            }
        };
        
        animate();
    }
    
    moveToEdge(direction) {
        const header = windowPool.get('header');
        if (!header || !header.isVisible() || this.isAnimating) return;
        
        console.log(`[Movement] Move to edge: ${direction}`);
        
        const display = screen.getPrimaryDisplay();
        const { width, height } = display.workAreaSize;
        const headerBounds = header.getBounds();
        
        // 현재 위치
        const currentBounds = header.getBounds();
        let targetX = currentBounds.x;
        let targetY = currentBounds.y;
        
        // 목표 위치 계산
        switch(direction) {
            case 'left':
                targetX = 0;
                break;
            case 'right':
                targetX = width - headerBounds.width;
                break;
            case 'up':
                targetY = 0;
                break;
            case 'down':
                targetY = height - headerBounds.height;
                break;
        }
        
        // 현재 위치 업데이트
        this.headerPosition = { x: currentBounds.x, y: currentBounds.y };
        
        // 애니메이션으로 이동 (부드럽게)
        this.isAnimating = true;
        const startX = this.headerPosition.x;
        const startY = this.headerPosition.y;
        const duration = 400; // 엣지 이동도 더 부드럽게 (200 → 400ms)
        const startTime = Date.now();
        
        // 입력값 검증
        if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || 
            !Number.isFinite(startX) || !Number.isFinite(startY)) {
            console.error('[Movement] Invalid edge position values:', { startX, startY, targetX, targetY });
            this.isAnimating = false;
            return;
        }
        
        const animate = () => {
            if (!header || header.isDestroyed()) {
                this.isAnimating = false;
                return;
            }
            
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // easeOutQuart 이징 (더 부드러운 엣지 이동)
            const eased = 1 - Math.pow(1 - progress, 4);
            
            const currentX = startX + (targetX - startX) * eased;
            const currentY = startY + (targetY - startY) * eased;
            
            // 값 검증 추가
            if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
                console.error('[Movement] Invalid edge animation values:', { currentX, currentY, progress, eased });
                this.isAnimating = false;
                return;
            }
            
            header.setPosition(Math.round(currentX), Math.round(currentY));
            
            if (progress < 1) {
                setTimeout(animate, 8); // 높은 프레임레이트
            } else {
                // 최종 위치로 정확히 설정
                header.setPosition(targetX, targetY);
                this.headerPosition = { x: targetX, y: targetY };
                this.isAnimating = false;
                
                // 레이아웃 업데이트
                updateLayout();
                
                console.log(`[Movement] Edge movement completed: ${direction}`);
            }
        };
        
        animate();
    }
    
    // 더 이상 사용하지 않는 메서드들 (호환성을 위해 유지)
    handleKeyPress(direction) {
        // 단발성 이동으로 변경되어 더 이상 사용하지 않음
    }
    
    handleKeyRelease(direction) {
        // 단발성 이동으로 변경되어 더 이상 사용하지 않음
    }
    
    forceStopMovement() {
        this.isAnimating = false;
    }
    
    destroy() {
        this.isAnimating = false;
        console.log('[Movement] Destroyed');
    }
}

const layoutManager = new WindowLayoutManager();
let movementManager = null;

function toggleAllWindowsVisibility() {
    const header = windowPool.get('header');
    if (!header) return;

    if (header.isVisible()) {
        // ---------------- SMART HIDE ----------------
        console.log('[Visibility] Smart hiding - calculating nearest edge');
        
        // 현재 헤더 위치 가져오기
        const headerBounds = header.getBounds();
        const display = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = display.workAreaSize;
        
        // 헤더 중심점 계산
        const centerX = headerBounds.x + headerBounds.width / 2;
        const centerY = headerBounds.y + headerBounds.height / 2;
        
        // 각 가장자리까지의 거리 계산
        const distances = {
            top: centerY,
            bottom: screenHeight - centerY,
            left: centerX,
            right: screenWidth - centerX
        };
        
        // 가장 가까운 가장자리 찾기
        const nearestEdge = Object.keys(distances).reduce((nearest, edge) => 
            distances[edge] < distances[nearest] ? edge : nearest
        );
        
        console.log(`[Visibility] Nearest edge: ${nearestEdge} (distance: ${distances[nearestEdge].toFixed(1)}px)`);
        
        // 보이는 창들 기록 및 부드럽게 숨기기
        lastVisibleWindows.clear();
        lastVisibleWindows.add('header'); // 헤더는 항상 포함
        
        windowPool.forEach((win, name) => {
            if (win.isVisible()) {
                lastVisibleWindows.add(name);
                if (name !== 'header') {
                    // 각 창에 숨김 애니메이션 트리거
                    win.webContents.send('window-hide-animation');
                    // 애니메이션 후 숨기기
                    setTimeout(() => {
                        if (!win.isDestroyed()) {
                            win.hide();
                        }
                    }, 200);
                }
            }
        });
        
        console.log('[Visibility] Visible windows before hide:', Array.from(lastVisibleWindows));
        
        // 헤더를 가장 가까운 가장자리로 부드럽게 이동시키면서 숨기기
        movementManager.hideToEdge(nearestEdge, () => {
            // 애니메이션 완료 후 실제로 숨기기
            header.hide();
            console.log('[Visibility] Smart hide completed');
        });
        
    } else {
        // ---------------- SMART SHOW ----------------
        console.log('[Visibility] Smart showing from hidden position');
        console.log('[Visibility] Restoring windows:', Array.from(lastVisibleWindows));
        
        // 헤더 먼저 보이기 (화면 밖 위치에서)
        header.show();
        
        // 부드럽게 원래 위치로 복원
        movementManager.showFromEdge(() => {
            // 다른 자식 창들 부드럽게 보이기
            lastVisibleWindows.forEach(name => {
                if (name === 'header') return;
                const win = windowPool.get(name);
                if (win && !win.isDestroyed()) {
                    win.show();
                    // 보임 애니메이션 트리거
                    win.webContents.send('window-show-animation');
                }
            });
            
            // 레이아웃 업데이트
            setImmediate(updateLayout);
            setTimeout(updateLayout, 120);
            
            console.log('[Visibility] Smart show completed');
        });
    }
}

function ensureDataDirectories() {
    const homeDir = os.homedir();
    const pickleGlassDir = path.join(homeDir, '.pickle-glass');
    const dataDir = path.join(pickleGlassDir, 'data');
    const imageDir = path.join(dataDir, 'image');
    const audioDir = path.join(dataDir, 'audio');

    [pickleGlassDir, dataDir, imageDir, audioDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    return { imageDir, audioDir };
}

function createWindows(sendToRenderer, openaiSessionRef) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { y: workAreaY, width: screenWidth } = primaryDisplay.workArea;

    const initialX = Math.round((screenWidth - DEFAULT_WINDOW_WIDTH) / 2);
    const initialY = workAreaY + 21; // 초기 Y 위치 (더 이상 고정되지 않음)

    // 움직임 매니저 초기화
    movementManager = new SmoothMovementManager();

    const header = new BrowserWindow({
        width: DEFAULT_WINDOW_WIDTH,
        height: HEADER_HEIGHT,
        x: initialX,
        y: initialY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hiddenInMissionControl: true,
        resizable: false,
        focusable: true,
        acceptFirstMouse: true,
        webPreferences: { 
            nodeIntegration: true, 
            contextIsolation: false,
            backgroundThrottling: false,
            webSecurity: false
        },
    });
    header.setContentProtection(isContentProtectionOn);
    header.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    header.loadFile(path.join(__dirname, '../app/header.html'));
    
    // 포커스 관련 이벤트 핸들러 추가
    header.on('focus', () => {
        console.log('[WindowManager] Header gained focus');
    });
    
    header.on('blur', () => {
        console.log('[WindowManager] Header lost focus');
        // 포커스 강제 복원 제거 - 사용자의 자연스러운 상호작용 허용
    });
    
    // 마우스 클릭 시에만 포커스 (자연스러운 상호작용)
    header.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'mouseDown') {
            // 입력 필드 영역에서만 포커스
            const target = input.target;
            if (target && (target.includes('input') || target.includes('apikey'))) {
                header.focus();
            }
        }
    });
    
    windowPool.set('header', header);

    const commonChildOptions = {
        parent: header,
        show: false,
        frame: false,
        transparent: true,
        hasShadow: false,
        skipTaskbar: true,
        hiddenInMissionControl: true,
        resizable: false, // 수동 크기 조절 방지
        webPreferences: { nodeIntegration: true, contextIsolation: false },
    };
    // If OS shadow applied on BrowserWindow, it cause afterimage on transparent + scroll

    const listen = new BrowserWindow({ 
        ...commonChildOptions, 
        width: 400, 
        height: 300, // 초기 높이 축소
        minWidth: 400,   // 가로 크기 고정
        maxWidth: 400,   // 가로 크기 고정
        minHeight: 200,  // 최소 높이 설정
        maxHeight: 700   // 최대 높이 설정 (CSS와 동일)
    });
    listen.setContentProtection(isContentProtectionOn);
    listen.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    listen.loadFile(path.join(__dirname, '../app/content.html'), { query: { view: 'listen' } });
    listen.webContents.openDevTools({ mode: 'detach', activate: false });
    windowPool.set('listen', listen);

    const ask = new BrowserWindow({ ...commonChildOptions, width: 600, height: 350 });
    ask.setContentProtection(isContentProtectionOn);
    ask.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    ask.loadFile(path.join(__dirname, '../app/content.html'), { query: { view: 'ask' } });
    windowPool.set('ask', ask);

    const settings = new BrowserWindow({ 
        ...commonChildOptions, 
        width: 240,
        height: 450,
        parent: undefined,
        modal: false,
        transparent: true,
        frame: false,
    });
    settings.setContentProtection(isContentProtectionOn);
    settings.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    
    // --- 렌더러 프로세스 직접 디버깅을 위해 DevTools 강제 실행 ---
    settings.webContents.openDevTools({ mode: 'detach', activate: false });
    
    console.log('Settings window created with bounds:', settings.getBounds());
    
    settings.loadFile(path.join(__dirname, '../app/content.html'), { query: { view: 'customize' } })
        .then(() => {
            console.log('Settings content loaded successfully');
        })
        .catch((error) => {
            console.error('Failed to load settings content:', error);
        });
    
    // settings 창이 준비되면 로그 출력
    settings.webContents.once('dom-ready', () => {
        console.log('Settings window DOM ready');
    });
    
    // 에러 로그 추가
    settings.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Settings window failed to load:', errorCode, errorDescription);
    });
    
    windowPool.set('settings', settings);

    // header.on('move', updateLayout);
    header.on('resize', updateLayout);

    header.webContents.once('dom-ready', () => {
        loadAndRegisterShortcuts();
    });

    // Header position handlers are registered in setupIpcHandlers()

    ipcMain.handle('toggle-all-windows-visibility', toggleAllWindowsVisibility);

    // This handler manages showing/hiding listen, ask, and settings windows.
    ipcMain.handle('toggle-feature', async (event, featureName) => {
        const windowToToggle = windowPool.get(featureName);
        
        if (windowToToggle) {
            if (featureName === 'listen') {
                const liveSummaryService = require('../features/listen/liveSummaryService');
                if (liveSummaryService.isSessionActive()) {
                    console.log('[WindowManager] Listen session is active, closing it via toggle.');
                    await liveSummaryService.closeSession();
                    return; // The 'session-did-close' event will hide the window.
                }
            }
            console.log(`[WindowManager] Toggling feature: ${featureName}`);
        }
        
        if (featureName === 'ask') {
            let askWindow = windowPool.get('ask');
            
            if (!askWindow || askWindow.isDestroyed()) {
                console.log('[WindowManager] Ask window not found, creating new one');
                return;
            }
            
            if (askWindow.isVisible()) {
                // Ask 창이 보이는 상태
                try {
                    // 현재 response가 있는지 확인 - 더 깊은 Shadow DOM 탐색
                    const hasResponse = await askWindow.webContents.executeJavaScript(`
                        (() => {
                            try {
                                // PickleGlassApp의 Shadow DOM 내부로 접근
                                const pickleApp = document.querySelector('pickle-glass-app');
                                if (!pickleApp || !pickleApp.shadowRoot) {
                                    console.log('PickleGlassApp not found');
                                    return false;
                                }
                                
                                // PickleGlassApp의 shadowRoot 내부에서 ask-view 찾기
                                const askView = pickleApp.shadowRoot.querySelector('ask-view');
                                if (!askView) {
                                    console.log('AskView not found in PickleGlassApp shadow DOM');
                                    return false;
                                }
                                
                                // AskView의 상태 확인
                                console.log('AskView found, checking state...');
                                console.log('currentResponse:', askView.currentResponse);
                                console.log('isLoading:', askView.isLoading);
                                console.log('isStreaming:', askView.isStreaming);
                                
                                // response가 있는지 확인
                                const hasContent = !!(askView.currentResponse || askView.isLoading || askView.isStreaming);
                                
                                // shadowRoot 내부의 실제 콘텐츠도 확인
                                if (!hasContent && askView.shadowRoot) {
                                    const responseContainer = askView.shadowRoot.querySelector('.response-container');
                                    if (responseContainer && !responseContainer.classList.contains('hidden')) {
                                        const textContent = responseContainer.textContent.trim();
                                        // 빈 상태 메시지가 아닌 실제 콘텐츠가 있는지 확인
                                        const hasActualContent = textContent && 
                                            !textContent.includes('Ask a question to see the response here') &&
                                            textContent.length > 0;
                                        console.log('Response container content check:', hasActualContent);
                                        return hasActualContent;
                                    }
                                }
                                
                                return hasContent;
                            } catch (error) {
                                console.error('Error checking AskView state:', error);
                                return false;
                            }
                        })()
                    `);
                    
                    console.log(`[WindowManager] Ask window visible, hasResponse: ${hasResponse}`);
                    
                    if (hasResponse) {
                        // response가 있으면 text input만 토글
                        askWindow.webContents.send('toggle-text-input');
                        console.log('[WindowManager] Sent toggle-text-input command');
                    } else {
                        // response가 없으면 창 닫기
                        console.log('[WindowManager] No response found, closing window');
                        askWindow.webContents.send('window-hide-animation');
                        
                        setTimeout(() => {
                            if (!askWindow.isDestroyed()) {
                                askWindow.hide();
                                updateLayout();
                            }
                        }, 250);
                    }
                } catch (error) {
                    console.error('[WindowManager] Error checking Ask window state:', error);
                    // 에러 발생 시 기본 동작: text input 토글 시도
                    console.log('[WindowManager] Falling back to toggle text input');
                    askWindow.webContents.send('toggle-text-input');
                }
            } else {
                // Ask 창이 숨겨진 상태면 보이기
                console.log('[WindowManager] Showing hidden Ask window');
                askWindow.show();
                updateLayout();
                askWindow.webContents.send('window-show-animation');
            }
        } else {
            // 다른 feature들은 기존 로직 유지
            const windowToToggle = windowPool.get(featureName);
            
            if (windowToToggle) {
                if (windowToToggle.isDestroyed()) {
                    console.error(`Window ${featureName} is destroyed, cannot toggle`);
                    return;
                }
                
                if (windowToToggle.isVisible()) {
                    // 숨기기
                    if (featureName === 'settings') {
                        windowToToggle.webContents.send('settings-window-hide-animation');
                    } else {
                        windowToToggle.webContents.send('window-hide-animation');
                    }
                    
                    setTimeout(() => {
                        if (!windowToToggle.isDestroyed()) {
                            windowToToggle.hide();
                            updateLayout();
                        }
                    }, 250);
                } else {
                    // 보이기
                    try {
                        windowToToggle.show();
                        updateLayout();
                        
                        if (featureName === 'listen') {
                            windowToToggle.webContents.send('start-listening-session');
                        }
                        
                        windowToToggle.webContents.send('window-show-animation');
                    } catch (e) {
                        console.error('Error showing window:', e);
                    }
                }
            } else {
                console.error(`Window not found for feature: ${featureName}`);
                console.error('Available windows:', Array.from(windowPool.keys()));
            }
        }
    });

    ipcMain.handle('send-question-to-ask', (event, question) => {
        const askWindow = windowPool.get('ask');
        if (askWindow && !askWindow.isDestroyed()) {
            console.log('📨 Main process: Sending question to AskView', question);
            askWindow.webContents.send('receive-question-from-assistant', question);
            return { success: true };
        } else {
            console.error('❌ Cannot find AskView window');
            return { success: false, error: 'AskView window not found' };
        }
    });

    // AssistantView 높이 자동 조절을 위한 핸들러
    ipcMain.handle('adjust-window-height', (event, targetHeight) => {
        const senderWindow = BrowserWindow.fromWebContents(event.sender);
        if (senderWindow) {
            // 일시적으로 resizable 활성화
            const wasResizable = senderWindow.isResizable();
            if (!wasResizable) {
                senderWindow.setResizable(true);
            }
            
            const currentBounds = senderWindow.getBounds();
            const minHeight = senderWindow.getMinimumSize()[1];
            const maxHeight = senderWindow.getMaximumSize()[1];
            
            // 높이를 제한 범위 내로 조정
            const adjustedHeight = Math.max(minHeight, Math.min(maxHeight, targetHeight));
            
            senderWindow.setSize(currentBounds.width, adjustedHeight, false);
            // console.log(`Adjusted window height to: ${adjustedHeight}px`);
            
            // resizable 상태 복원
            if (!wasResizable) {
                senderWindow.setResizable(false);
            }
            
            // 레이아웃 업데이트
            updateLayout();
        }
    });

    // --- NEW: Handle session close to hide window ---
    ipcMain.on('session-did-close', () => {
        const listenWindow = windowPool.get('listen');
        if (listenWindow && listenWindow.isVisible()) {
            console.log('[WindowManager] Session closed, hiding listen window.');
            listenWindow.hide();
        }
    });

    setupIpcHandlers();

    return windowPool;
}

function loadAndRegisterShortcuts() {
    const defaultKeybinds = getDefaultKeybinds();
    const header = windowPool.get('header');
    // Helper that forwards events to any renderer windows that are currently available.
    const sendToRenderer = (channel, ...args) => {
        windowPool.forEach(win => {
            try {
                if (win && !win.isDestroyed()) {
                    win.webContents.send(channel, ...args);
                }
            } catch (e) {
                // Ignore failures for windows that may already be closed
            }
        });
    };

    const openaiSessionRef = { current: null };

    if (!header) {
        // Fallback: register shortcuts without window-specific actions.
        return updateGlobalShortcuts(defaultKeybinds, undefined, sendToRenderer, openaiSessionRef);
    }

    header.webContents
        .executeJavaScript(`(() => localStorage.getItem('customKeybinds'))()`)
        .then(saved => (saved ? JSON.parse(saved) : {}))
        .then(savedKeybinds => {
            const keybinds = { ...defaultKeybinds, ...savedKeybinds };
            updateGlobalShortcuts(keybinds, header, sendToRenderer, openaiSessionRef);
        })
        .catch(() => updateGlobalShortcuts(defaultKeybinds, header, sendToRenderer, openaiSessionRef));
}

function updateLayout() {
    layoutManager.updateLayout();
}

function setupIpcHandlers(openaiSessionRef) {
    const layoutManager = new WindowLayoutManager();
    const movementManager = new SmoothMovementManager();

    ipcMain.on('show-window', (event, args) => {
        const { name, bounds } = (typeof args === 'object' && args !== null) ? args : { name: args, bounds: null };
        const win = windowPool.get(name);
        
        if (win && !win.isDestroyed()) {
            if (settingsHideTimer) {
                clearTimeout(settingsHideTimer);
                settingsHideTimer = null;
            }

            if (name === 'settings' && bounds) {
                // Adjust position based on button bounds
                     // ① 헤더 창의 화면 위치를 가져온다
                     const header = windowPool.get('header');
                     const headerBounds = header?.getBounds() ?? { x: 0, y: 0 };
                
                     // ② 로컬->스크린 변환
                     const settingsBounds = win.getBounds();
                     const display = screen.getPrimaryDisplay().workAreaSize;
                
                     let x = Math.round(
                         headerBounds.x                      // 헤더의 화면 X
                       + bounds.x                            // 버튼의 헤더 내 X
                       + bounds.width / 2
                       - settingsBounds.width / 2);
                
                     let y = Math.round(
                         headerBounds.y + bounds.y + bounds.height + 5);  // 버튼 바로 아래 5 px
                
                     // ③ 화면 경계 보정
                     x = Math.max(10, Math.min(display.width  - settingsBounds.width  - 10, x));
                     y = Math.max(10, Math.min(display.height - settingsBounds.height - 10, y));
                
                     win.setBounds({ x, y });
                     win.__lockedByButton = true;
                console.log(`[WindowManager] Positioning settings window at (${x}, ${y}) based on button bounds.`);
            }
            
            win.show();
            win.moveTop();
            // updateLayout();
        }
    });

    ipcMain.on('hide-window', (event, name) => {
        const window = windowPool.get(name);
        if (window && !window.isDestroyed()) {
            if (name === 'settings') {
                if (settingsHideTimer) {
                    clearTimeout(settingsHideTimer);
                }
                // 마우스가 창 밖으로 나갔을 때 약간의 지연 후 숨김
                settingsHideTimer = setTimeout(() => {
                    window.hide();
                    settingsHideTimer = null;
                }, 200);
            } else {
                window.hide();
            }
            // updateLayout();
            window.__lockedByButton = false;
        }
    });

    // AppHeader에서 호출하여 숨기기 타이머를 취소
    ipcMain.on('cancel-hide-window', (event, name) => {
        if (name === 'settings' && settingsHideTimer) {
            clearTimeout(settingsHideTimer);
            settingsHideTimer = null;
        }
    });

    ipcMain.handle('hide-all', () => {
        windowPool.forEach(win => {
            if (win.isFocused()) return;
            win.hide();
        });
    });

    ipcMain.handle('quit-application', () => {
        app.quit();
    });


    // sendMessage가 호출되면 text-input 숨기기 처리
    ipcMain.handle('message-sending', async (event) => {
        console.log('📨 Main: Received message-sending signal');
        const askWindow = windowPool.get('ask');
        if (askWindow && !askWindow.isDestroyed()) {
            console.log('📤 Main: Sending hide-text-input to ask window');
            askWindow.webContents.send('hide-text-input');
            return { success: true };
        }
        return { success: false };
    });


    // 특정 창의 가시성 상태 확인
    ipcMain.handle('is-window-visible', (event, windowName) => {
        const window = windowPool.get(windowName);
        if (window && !window.isDestroyed()) {
            return window.isVisible();
        }
        return false;
    });

    // AssistantView에서 AskView로 응답 전달
    ipcMain.handle('send-to-ask-view', (event, data) => {
        const askWindow = windowPool.get('ask');
        if (askWindow && !askWindow.isDestroyed()) {
            console.log('📨 Main process: Sending data to AskView', data);
            askWindow.webContents.send('add-ask-response', data);
            return { success: true };
        } else {
            console.error('❌ Cannot find AskView window');
            return { success: false, error: 'AskView window not found' };
        }
    });

    // Content Protection Toggle
    ipcMain.handle('toggle-content-protection', () => {
        isContentProtectionOn = !isContentProtectionOn;
        console.log(`[Protection] Content protection toggled to: ${isContentProtectionOn}`);
        windowPool.forEach(win => {
            if (win && !win.isDestroyed()) {
                win.setContentProtection(isContentProtectionOn);
            }
        });
        return isContentProtectionOn;
    });

    ipcMain.handle('get-content-protection-status', () => {
        return isContentProtectionOn;
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        updateGlobalShortcuts(newKeybinds);
    });

    // Open personalization page (단일 사용자 시스템)
    ipcMain.handle('open-login-page', () => {
        const webUrl = process.env.pickleglass_WEB_URL || 'http://localhost:3000';
        const personalizeUrl = `${webUrl}/personalize?desktop=true`;
        shell.openExternal(personalizeUrl);
        console.log('Opening personalization page:', personalizeUrl);
    });

    // API key related handlers
    setupApiKeyIPC();

    // Legacy IPC channels used by renderer before the multi-window refactor. We keep them as no-ops for backward compatibility.
    ipcMain.handle('resize-window', () => {
        // No-op: resizing is managed per-window in the new layout.
    });

    ipcMain.handle('resize-for-view', () => {
        // No-op: maintained for compatibility.
    });

    // Header 창 크기 동적 조절
    ipcMain.handle('resize-header-window', (event, { width, height }) => {
        const header = windowPool.get('header');
        if (header) {
            const wasResizable = header.isResizable();
            if (!wasResizable) {
                header.setResizable(true);
            }

            const bounds = header.getBounds();
            // 창의 중앙을 기준으로 위치를 조정하여 확대/축소되는 것처럼 보이게 함
            const newX = bounds.x + Math.round((bounds.width - width) / 2);
            
            // setBounds는 y 좌표도 필요로 하므로 현재 y 좌표를 사용
            header.setBounds({ x: newX, y: bounds.y, width, height });

            if (!wasResizable) {
                header.setResizable(false);
            }
            return { success: true };
        }
        return { success: false, error: 'Header window not found' };
    });

    // Header animation completion handler
    ipcMain.on('header-animation-complete', (event, state) => {
        const header = windowPool.get('header');
        if (!header) return;

        if (state === 'hidden') {
            // Animation completed, actually hide the header
            header.hide();
        } else if (state === 'visible') {
            // Header animation completed, show other windows
            lastVisibleWindows.forEach(name => {
                if (name === 'header') return;
                const win = windowPool.get(name);
                if (win) win.show();
            });

            // Update layout
            setImmediate(updateLayout);
            setTimeout(updateLayout, 120);
        }
    });

    // New handlers for custom dragging
    ipcMain.handle('get-header-position', () => {
        const header = windowPool.get('header');
        if (header) {
            const [x, y] = header.getPosition();
            return { x, y };
        }
        return { x: 0, y: 0 };
    });

    ipcMain.handle('move-header', (event, newX, newY) => {
        const header = windowPool.get('header');
        if (header) {
            // Y 위치가 제공되지 않으면 현재 Y 위치 유지 (기존 호환성)
            const currentY = newY !== undefined ? newY : header.getBounds().y;
            header.setPosition(newX, currentY, false);
            
            // 레이아웃 업데이트
            updateLayout();
        }
    });

    // 새로운 핸들러: X, Y 모두 처리
    ipcMain.handle('move-header-to', (event, newX, newY) => {
        const header = windowPool.get('header');
        if (header) {
            // 화면 경계 체크
            const display = screen.getPrimaryDisplay();
            const { width: screenWidth, height: screenHeight } = display.workAreaSize;
            const headerBounds = header.getBounds();
            
            // 경계 내로 제한
            const clampedX = Math.max(0, Math.min(screenWidth - headerBounds.width, newX));
            const clampedY = Math.max(0, Math.min(screenHeight - headerBounds.height, newY));
            
            header.setPosition(clampedX, clampedY, false);
            
            // 레이아웃 업데이트
            updateLayout();
        }
    });

    ipcMain.handle('move-window-step', (event, direction) => {
        if (movementManager) {
            movementManager.moveStep(direction);
        }
    });

    ipcMain.on('move-to-edge', (event, direction) => {
        if (movementManager) {
            movementManager.moveToEdge(direction);
        }
    });

    ipcMain.handle('force-close-window', (event, windowName) => {
        const window = windowPool.get(windowName);
        if (window && !window.isDestroyed()) {
            console.log(`[WindowManager] Force closing window: ${windowName}`);
            
            // 창에 숨김 애니메이션 트리거
            window.webContents.send('window-hide-animation');
            
            // 애니메이션 완료 후 창 숨기기
            setTimeout(() => {
                if (!window.isDestroyed()) {
                    window.hide();
                    updateLayout();
                }
            }, 250);
        }
    });

       // Initialize screen capture
    ipcMain.handle('start-screen-capture', async () => {
        try {
            isCapturing = true;
            console.log('Starting screen capture in main process');
            return { success: true };
        } catch (error) {
            console.error('Failed to start screen capture:', error);
            return { success: false, error: error.message };
        }
    });

    // Stop screen capture
    ipcMain.handle('stop-screen-capture', async () => {
        try {
            isCapturing = false;
            lastScreenshot = null;
            console.log('Stopped screen capture in main process');
            return { success: true };
        } catch (error) {
            console.error('Failed to stop screen capture:', error);
            return { success: false, error: error.message };
        }
    });

    // Capture screenshot
    ipcMain.handle('capture-screenshot', async (event, options = {}) => {
        // For macOS, use the native `screencapture` CLI to avoid window jumping issues.
        if (process.platform === 'darwin') {
            try {
                const tempPath = path.join(os.tmpdir(), `screenshot-${Date.now()}.jpg`);
                
                await execFile('screencapture', ['-x', '-t', 'jpg', tempPath]);

                const imageBuffer = await fs.promises.readFile(tempPath);
                await fs.promises.unlink(tempPath);

                const resizedBuffer = await sharp(imageBuffer)
                    .resize({ height: 1080 })
                    .jpeg({ quality: 80 })
                    .toBuffer();

                const base64 = resizedBuffer.toString('base64');
                const metadata = await sharp(resizedBuffer).metadata();

                // 💥 Update lastScreenshot cache
                lastScreenshot = {
                    base64,
                    width: metadata.width,
                    height: metadata.height,
                    timestamp: Date.now()
                };

                return { success: true, base64, width: metadata.width, height: metadata.height };

            } catch (error) {
                console.error('Failed to capture and resize screenshot:', error);
                return { success: false, error: error.message };
            }
        }

        // Fallback for non-macOS platforms using the original desktopCapturer method
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: {
                    width: 1920,
                    height: 1080
                }
            });

            if (sources.length === 0) {
                throw new Error('No screen sources available');
            }
            const source = sources[0];
            const buffer = source.thumbnail.toJPEG(70);
            const base64 = buffer.toString('base64');
            const size = source.thumbnail.getSize();

            return {
                success: true,
                base64,
                width: size.width,
                height: size.height
            };
        } catch (error) {
            console.error('Failed to capture screenshot using desktopCapturer:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    // Get current screenshot (returns last captured or captures new one)
    ipcMain.handle('get-current-screenshot', async (event) => {
        try {
            // If we have a recent screenshot (less than 1 second old), return it
            if (lastScreenshot && (Date.now() - lastScreenshot.timestamp) < 1000) {
                console.log('Returning cached screenshot');
                return {
                    success: true,
                    base64: lastScreenshot.base64,
                    width: lastScreenshot.width,
                    height: lastScreenshot.height
                };
            }
            return {
                success: false,
                error: 'No screenshot available'
            };
        } catch (error) {
            console.error('Failed to get current screenshot:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    ipcMain.handle('firebase-auth-state-changed', (event, user) => {
        console.log('[WindowManager] Firebase auth state changed:', user ? user.email : 'null');
        const previousUser = currentFirebaseUser; 
        currentFirebaseUser = user;

        if (user && user.email) {
            (async () => {
                try {
                    // Check if virtual key already exists to avoid duplicate requests
                    const existingKey = getStoredApiKey();
                    if (existingKey) {
                        console.log('[WindowManager] Virtual key already exists, skipping fetch');
                        return;
                    }

                    if (!user.idToken) {
                        console.warn('[WindowManager] No ID token available, cannot fetch virtual key');
                        return;
                    }

                    console.log('[WindowManager] Fetching virtual key via onAuthStateChanged');
                    const vKey = await getVirtualKeyByEmail(user.email, user.idToken);
                    console.log('[WindowManager] Virtual key fetched successfully');
            
                    // Save API key and notify all windows
                    setApiKey(vKey).then(() => {
                        windowPool.forEach(win => {
                        if (win && !win.isDestroyed()) {
                            win.webContents.send('api-key-updated');
                        }
                        });
                    }).catch(err => console.error('[WindowManager] Failed to save virtual key:', err));
            
                } catch (err) {
                    console.error('[WindowManager] Virtual key fetch failed:', err);
                    // Notify user if authentication token issue
                    if (err.message.includes('token') || err.message.includes('Authentication')) {
                        windowPool.forEach(win => {
                            if (win && !win.isDestroyed()) {
                                win.webContents.send('auth-error', { 
                                    message: 'Authentication expired. Please login again.',
                                    shouldLogout: true 
                                });
                            }
                        });
                    }
                }
            })();
        }
        // Broadcast to all windows
        windowPool.forEach(win => {
            if (win && !win.isDestroyed()) {
                win.webContents.send('firebase-user-updated', user);
            }
        });

        // If the user logged out, also hide the settings window
        if (!user) {
            console.log('[WindowManager] User logged out, clearing API key and notifying renderers');
            
            // ① API-Key 삭제 & DB 반영
            setApiKey(null)
                .then(() => {
                    console.log('[WindowManager] API key cleared successfully after logout');
                    // ② 모든 렌더러에 "api-key-removed" 알림 (setApiKey 성공 후)
                    windowPool.forEach(win => {
                        if (win && !win.isDestroyed()) {
                            win.webContents.send('api-key-removed');
                        }
                    });
                })
                .catch(err => {
                    console.error('[WindowManager] setApiKey error:', err);
                    // 실패해도 렌더러에는 알림
                    windowPool.forEach(win => {
                        if (win && !win.isDestroyed()) {
                            win.webContents.send('api-key-removed');
                        }
                    });
                });
            
            const settingsWindow = windowPool.get('settings');
            if (settingsWindow && settingsWindow.isVisible()) {
                settingsWindow.hide();
                console.log('[WindowManager] Settings window hidden after logout.');
            }
        }
    });

    ipcMain.handle('get-current-firebase-user', () => {
        return currentFirebaseUser;
    });

    ipcMain.handle('firebase-logout', () => {
        console.log('[WindowManager] Received request to log out.');
        const header = windowPool.get('header');
        if (header && !header.isDestroyed()) {
            header.webContents.send('request-firebase-logout');
        }
    });
}

// API 키 관리
let storedApiKey = null;

async function setApiKey(apiKey) {
    storedApiKey = apiKey;
    console.log('[WindowManager] API key stored (and will be persisted to DB)');

    try {
        await sqliteClient.saveApiKey(apiKey);
        console.log('[WindowManager] API key saved to SQLite');
    } catch (err) {
        console.error('[WindowManager] Failed to save API key to SQLite:', err);
    }

    // Keep legacy localStorage in sync so existing renderer code keeps working
    windowPool.forEach(win => {
        if (win && !win.isDestroyed()) {
            const js = apiKey
                ? `localStorage.setItem('openai_api_key', ${JSON.stringify(apiKey)});`
                : `localStorage.removeItem('openai_api_key');`;
            win.webContents.executeJavaScript(js).catch(() => {});
        }
    });
}

async function loadApiKeyFromDb() {
    try {
        const user = await sqliteClient.getUser(sqliteClient.defaultUserId);
        if (user && user.api_key) {
            console.log('[WindowManager] API key loaded from SQLite for default user.');
            return user.api_key;
        }
        return null;
    } catch (error) {
        console.error('[WindowManager] Failed to load API key from SQLite:', error);
        return null;
    }
}

function getCurrentFirebaseUser() {
    return currentFirebaseUser;        // null이면 로그인 안 된 상태
}
  
function isFirebaseLoggedIn() {
    return !!currentFirebaseUser;      // true / false
}

  function setCurrentFirebaseUser(user) {
    currentFirebaseUser = user;
    console.log('[WindowManager] Firebase user updated:', user ? user.email : 'null');
  }

function getStoredApiKey() {
    return storedApiKey;
}

// API key based IPC management
function setupApiKeyIPC() {
    const { ipcMain } = require('electron');
    
    // Get stored API key
    ipcMain.handle('get-stored-api-key', async () => {
        if (storedApiKey === null) {
            const dbKey = await loadApiKeyFromDb();
            if (dbKey) {
                await setApiKey(dbKey);
            }
        }
        return storedApiKey;
    });
    
    // Save API key after validation
    ipcMain.handle('api-key-validated', async (event, apiKey) => {
        console.log('[WindowManager] API key validation completed, saving...');
        await setApiKey(apiKey);
        
        // Send API key validation completed event to all windows
        windowPool.forEach((win, name) => {
            if (win && !win.isDestroyed()) {
                win.webContents.send('api-key-validated', apiKey);
            }
        });
        
        return { success: true };
    });
    
    // Remove API key (used from settings)
    ipcMain.handle('remove-api-key', async () => {
        console.log('[WindowManager] API key removal requested');
        await setApiKey(null);
        
        // Send API key removal event to all windows
        windowPool.forEach((win, name) => {
            if (win && !win.isDestroyed()) {
                win.webContents.send('api-key-removed');
            }
        });
        
        // Also hide the settings window
        const settingsWindow = windowPool.get('settings');
        if (settingsWindow && settingsWindow.isVisible()) {
            settingsWindow.hide();
            console.log('[WindowManager] Settings window hidden after clearing API key.');
        }

        return { success: true };
    });

    ipcMain.handle('get-current-api-key', async () => {
        if (storedApiKey === null) {
            const dbKey = await loadApiKeyFromDb();
            if (dbKey) {
                await setApiKey(dbKey);
            }
        }
        return storedApiKey;
    });
    
    console.log('[WindowManager] API key related IPC handlers registered (SQLite-backed)');
}

// Old file watcher function removed - replaced with IPC-based communication

function createWindow(sendToRenderer, openaiSessionRef) {
    const mainWindow = new BrowserWindow({
        width: DEFAULT_WINDOW_WIDTH,
        height: HEADER_HEIGHT,
        x: initialX,
        y: initialY,
        frame: false,
        transparent: false,
        hasShadow: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hiddenInMissionControl: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
            enableBlinkFeatures: 'GetDisplayMedia',
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        backgroundColor: '#FF0000',
    });

    const { session, desktopCapturer } = require('electron');
    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
                callback({ video: sources[0], audio: 'loopback' });
            });
        },
        { useSystemPicker: true }
    );

    mainWindow.setResizable(false);
    mainWindow.setContentProtection(true);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Center window at the top of the screen
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;
    const x = Math.floor((screenWidth - DEFAULT_WINDOW_WIDTH) / 2);
    const y = 0;
    mainWindow.setPosition(x, y);

    if (process.platform === 'win32') {
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }

    mainWindow.loadFile(path.join(__dirname, '../index.html'));

    mainWindow.webContents.once('dom-ready', () => {
        setTimeout(() => {
            const defaultKeybinds = getDefaultKeybinds();
            let keybinds = defaultKeybinds;

            mainWindow.webContents
                .executeJavaScript(
                    `
                (() => {
                    try {
                        const savedKeybinds = localStorage.getItem('customKeybinds');
                        const savedContentProtection = localStorage.getItem('contentProtection');
                        
                        return {
                            keybinds: savedKeybinds ? JSON.parse(savedKeybinds) : null,
                            contentProtection: savedContentProtection !== null ? savedContentProtection === 'true' : true
                        };
                    } catch (e) {
                        return { keybinds: null, contentProtection: true };
                    }
                })()
            `
                )
                .then(savedSettings => {
                    if (savedSettings.keybinds) {
                        keybinds = { ...defaultKeybinds, ...savedSettings.keybinds };
                    }
                    mainWindow.setContentProtection(savedSettings.contentProtection);
                    updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, openaiSessionRef);
                })
                .catch(() => {
                    mainWindow.setContentProtection(true);
                    updateGlobalShortcuts(defaultKeybinds, mainWindow, sendToRenderer, openaiSessionRef);
                });
        }, 150);
    });

    setupWindowIpcHandlers(mainWindow, sendToRenderer, openaiSessionRef);

    return mainWindow;
}

function getDefaultKeybinds() {
    const isMac = process.platform === 'darwin';
    return {
        moveUp: isMac ? 'Cmd+Up' : 'Ctrl+Up',
        moveDown: isMac ? 'Cmd+Down' : 'Ctrl+Down',
        moveLeft: isMac ? 'Cmd+Left' : 'Ctrl+Left',
        moveRight: isMac ? 'Cmd+Right' : 'Ctrl+Right',
        toggleVisibility: isMac ? 'Cmd+\\' : 'Ctrl+\\',
        toggleClickThrough: isMac ? 'Cmd+M' : 'Ctrl+M',
        nextStep: isMac ? 'Cmd+Enter' : 'Ctrl+Enter',
        manualScreenshot: isMac ? 'Cmd+Shift+S' : 'Ctrl+Shift+S',
        previousResponse: isMac ? 'Cmd+[' : 'Ctrl+[',
        nextResponse: isMac ? 'Cmd+]' : 'Ctrl+]',
        scrollUp: isMac ? 'Cmd+Shift+Up' : 'Ctrl+Shift+Up',
        scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down',
    };
}

function updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, openaiSessionRef) {
    console.log('Updating global shortcuts with:', keybinds);

    // Unregister all existing shortcuts
    globalShortcut.unregisterAll();
    
    // 움직임 매니저 초기화
    if (movementManager) {
        movementManager.destroy();
    }
    movementManager = new SmoothMovementManager();

    // Cmd+화살표 글로벌 단축키 등록 (다른 창 포커스 상태와 무관하게 동작)
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Cmd' : 'Ctrl';
    
    const directions = [
        { key: `${modifier}+Left`, direction: 'left' },
        { key: `${modifier}+Right`, direction: 'right' },
        { key: `${modifier}+Up`, direction: 'up' },
        { key: `${modifier}+Down`, direction: 'down' }
    ];
    
    directions.forEach(({ key, direction }) => {
        try {
            globalShortcut.register(key, () => {
                const header = windowPool.get('header');
                if (header && header.isVisible()) {
                    movementManager.moveStep(direction);
                }
            });
            console.log(`Registered global shortcut: ${key} -> ${direction}`);
        } catch (error) {
            console.error(`Failed to register ${key}:`, error);
        }
    });
    
    // Shift + Cmd + 화살표로 끝으로 이동
    const edgeDirections = [
        { key: `${modifier}+Shift+Left`, direction: 'left' },
        { key: `${modifier}+Shift+Right`, direction: 'right' },
        { key: `${modifier}+Shift+Up`, direction: 'up' },
        { key: `${modifier}+Shift+Down`, direction: 'down' }
    ];
    
    edgeDirections.forEach(({ key, direction }) => {
        try {
            globalShortcut.register(key, () => {
                const header = windowPool.get('header');
                if (header && header.isVisible()) {
                    movementManager.moveToEdge(direction);
                }
            });
            console.log(`Registered global shortcut: ${key} -> edge ${direction}`);
        } catch (error) {
            console.error(`Failed to register ${key}:`, error);
        }
    });

    // 기존 다른 단축키들은 그대로 유지
    // Register toggle visibility shortcut
    if (keybinds.toggleVisibility) {
        try {
            globalShortcut.register(keybinds.toggleVisibility, toggleAllWindowsVisibility);
            console.log(`Registered toggleVisibility: ${keybinds.toggleVisibility}`);
        } catch (error) {
            console.error(`Failed to register toggleVisibility (${keybinds.toggleVisibility}):`, error);
        }
    }

    // Register toggle click-through shortcut
    if (keybinds.toggleClickThrough) {
        try {
            globalShortcut.register(keybinds.toggleClickThrough, () => {
                mouseEventsIgnored = !mouseEventsIgnored;
                if (mouseEventsIgnored) {
                    mainWindow.setIgnoreMouseEvents(true, { forward: true });
                    console.log('Mouse events ignored');
                } else {
                    mainWindow.setIgnoreMouseEvents(false);
                    console.log('Mouse events enabled');
                }
                mainWindow.webContents.send('click-through-toggled', mouseEventsIgnored);
            });
            console.log(`Registered toggleClickThrough: ${keybinds.toggleClickThrough}`);
        } catch (error) {
            console.error(`Failed to register toggleClickThrough (${keybinds.toggleClickThrough}):`, error);
        }
    }

    // Register Cmd/Ctrl+Enter shortcut to control Ask window
    if (keybinds.nextStep) {
        try {
            globalShortcut.register(keybinds.nextStep, () => {
                console.log('⌘/Ctrl+Enter Ask shortcut triggered');

                const askWindow = windowPool.get('ask');
                if (!askWindow || askWindow.isDestroyed()) {
                    console.error('Ask window not found or destroyed');
                    return;
                }

                if (askWindow.isVisible()) {
                    // Ask 창이 이미 열려 있으면 현재 입력 내용을 전송하도록 요청
                    askWindow.webContents.send('ask-global-send');
                } else {
                    // Ask 창이 닫혀 있으면 열기 (기존 toggle-feature 로직과 동일하게)
                    try {
                        askWindow.show();
                        
                        // 즉시 레이아웃 업데이트하여 올바른 위치에 배치
                        const header = windowPool.get('header');
                        if (header) {
                            const currentHeaderPosition = header.getBounds();
                            updateLayout();
                            // 레이아웃 업데이트 후 헤더 위치 복원
                            header.setPosition(currentHeaderPosition.x, currentHeaderPosition.y, false);
                        }
                        
                        askWindow.webContents.send('window-show-animation');
                    } catch (e) {
                        console.error('Error showing Ask window:', e);
                    }
                }
            });
            console.log(`Registered Ask shortcut (nextStep): ${keybinds.nextStep}`);
        } catch (error) {
            console.error(`Failed to register Ask shortcut (${keybinds.nextStep}):`, error);
        }
    }

    // Register manual screenshot shortcut
    if (keybinds.manualScreenshot) {
        try {
            globalShortcut.register(keybinds.manualScreenshot, () => {
                console.log('Manual screenshot shortcut triggered');
                mainWindow.webContents.executeJavaScript(`
                    if (window.captureManualScreenshot) {
                        window.captureManualScreenshot();
                    } else {
                        console.log('Manual screenshot function not available');
                    }
                `);
            });
            console.log(`Registered manualScreenshot: ${keybinds.manualScreenshot}`);
        } catch (error) {
            console.error(`Failed to register manualScreenshot (${keybinds.manualScreenshot}):`, error);
        }
    }

    // Register previous response shortcut
    if (keybinds.previousResponse) {
        try {
            globalShortcut.register(keybinds.previousResponse, () => {
                console.log('Previous response shortcut triggered');
                sendToRenderer('navigate-previous-response');
            });
            console.log(`Registered previousResponse: ${keybinds.previousResponse}`);
        } catch (error) {
            console.error(`Failed to register previousResponse (${keybinds.previousResponse}):`, error);
        }
    }

    // Register next response shortcut
    if (keybinds.nextResponse) {
        try {
            globalShortcut.register(keybinds.nextResponse, () => {
                console.log('Next response shortcut triggered');
                sendToRenderer('navigate-next-response');
            });
            console.log(`Registered nextResponse: ${keybinds.nextResponse}`);
        } catch (error) {
            console.error(`Failed to register nextResponse (${keybinds.nextResponse}):`, error);
        }
    }

    // Register scroll up shortcut
    if (keybinds.scrollUp) {
        try {
            globalShortcut.register(keybinds.scrollUp, () => {
                console.log('Scroll up shortcut triggered');
                sendToRenderer('scroll-response-up');
            });
            console.log(`Registered scrollUp: ${keybinds.scrollUp}`);
        } catch (error) {
            console.error(`Failed to register scrollUp (${keybinds.scrollUp}):`, error);
        }
    }

    // Register scroll down shortcut
    if (keybinds.scrollDown) {
        try {
            globalShortcut.register(keybinds.scrollDown, () => {
                console.log('Scroll down shortcut triggered');
                sendToRenderer('scroll-response-down');
            });
            console.log(`Registered scrollDown: ${keybinds.scrollDown}`);
        } catch (error) {
            console.error(`Failed to register scrollDown (${keybinds.scrollDown}):`, error);
        }
    }
}

function setupWindowIpcHandlers(mainWindow, sendToRenderer, openaiSessionRef) {
    ipcMain.handle('resize-window', async (event, args) => {
        try {
            const { isMainViewVisible, view } = args;
            let targetHeight = HEADER_HEIGHT;
            let targetWidth = DEFAULT_WINDOW_WIDTH;

            if (isMainViewVisible) {
                // Define heights for different views
                const viewHeights = {
                    listen: 400,
                    customize: 600,
                    help: 550,
                    history: 550,
                    setup: 200,
                };
                targetHeight = viewHeights[view] || 400;
            }

            const [currentWidth, currentHeight] = mainWindow.getSize();
            if (currentWidth !== targetWidth || currentHeight !== targetHeight) {
                // Window resizing is disabled - remove resize functionality
                console.log('Window resize requested but disabled for manual resize prevention');
            }
        } catch (error) {
            console.error('Error resizing window:', error);
        }
    });

    ipcMain.handle('toggle-window-visibility', async event => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
        }
    });

    // Keep other essential IPC handlers
    ipcMain.handle('quit-application', async () => {
        app.quit();
    });

    // ... other handlers like open-external, etc. can be added from the old file if needed
}

function clearApiKey() {
    // convenience wrapper for existing callers
    setApiKey(null);
}

async function getVirtualKeyByEmail(email, idToken) {
    if (!idToken) {
        throw new Error('Firebase ID token is required for virtual key request');
    }

    const resp = await fetch('https://serverless-api-sf3o.vercel.app/api/virtual_key', {
      method : 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body   : JSON.stringify({ email: email.trim().toLowerCase() }),
      redirect: 'follow'
    });
  
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        console.error('[VK] API request failed:', json.message || 'Unknown error');
        throw new Error(json.message || `HTTP ${resp.status}: Virtual key request failed`);
    }
  
    const vKey =
          json?.data?.virtualKey  ||
          json?.data?.virtual_key ||
          json?.data?.newVKey?.slug;
  
    if (!vKey) throw new Error('virtual key missing in response');
    return vKey;
  }

// Helper function to avoid code duplication
async function captureScreenshotInternal(options = {}) {
    try {
        const quality = options.quality || 'medium';
        
        // Get available sources
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
                width: 1920,
                height: 1080
            }
        });

        if (sources.length === 0) {
            throw new Error('No screen sources available');
        }

        // Use the first available screen source
        const source = sources[0];
        const thumbnail = source.thumbnail;

        // Determine JPEG quality
        let jpegQuality;
        switch (quality) {
            case 'high':
                jpegQuality = 90;
                break;
            case 'low':
                jpegQuality = 50;
                break;
            case 'medium':
            default:
                jpegQuality = 70;
                break;
        }

        // Convert to JPEG buffer
        const buffer = thumbnail.toJPEG(jpegQuality);
        const base64 = buffer.toString('base64');

        const size = thumbnail.getSize();

        return {
            success: true,
            base64,
            width: size.width,
            height: size.height
        };
    } catch (error) {
        throw error;
    }
}

module.exports = {
    createWindows,
    windowPool,
    fixedYPosition,
    setApiKey,
    getStoredApiKey,
    clearApiKey,
    getCurrentFirebaseUser,
    isFirebaseLoggedIn,
    setCurrentFirebaseUser,
    getVirtualKeyByEmail,
};
