const esbuild = require('esbuild');
const path = require('path');

// 공통 설정
const baseConfig = {
    bundle: true,
    platform: 'browser',
    format: 'esm',
    loader: { '.js': 'jsx' },
    sourcemap: true,
    external: ['electron'],
    define: {
        'process.env.NODE_ENV': `"${process.env.NODE_ENV || 'development'}"`,
    },
};

// 빌드할 파일 목록
const entryPoints = [
    { in: 'src/app/HeaderController.js', out: 'public/build/header' },
    { in: 'src/app/PickleGlassApp.js', out: 'public/build/content' },
];

// 빌드 실행 함수
async function build() {
    try {
        console.log('Building renderer process code...');
        await Promise.all(entryPoints.map(point => esbuild.build({
            ...baseConfig,
            entryPoints: [point.in],
            outfile: `${point.out}.js`,
        })));
        console.log('✅ Renderer builds successful!');
    } catch (e) {
        console.error('Renderer build failed:', e);
        process.exit(1);
    }
}

// 개발용 watch 모드 실행 함수
async function watch() {
    try {
        const contexts = await Promise.all(entryPoints.map(point => esbuild.context({
            ...baseConfig,
            entryPoints: [point.in],
            outfile: `${point.out}.js`,
        })));
        
        console.log('Watching for changes...');
        await Promise.all(contexts.map(context => context.watch()));

    } catch (e) {
        console.error('Watch mode failed:', e);
        process.exit(1);
    }
}

// 커맨드 라인 인자에 따라 build 또는 watch 실행
if (process.argv.includes('--watch')) {
    watch();
} else {
    build();
} 