const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { notarizeApp } = require('./notarize');

module.exports = {
    packagerConfig: {
        asar: {
        // .node + .dylib + sharp 하위 모두 unpack
            unpack:
                '**/*.node,**/*.dylib,' +
                '**/node_modules/{sharp,@img}/**/*'
        },
        extraResource: ['./src/assets/SystemAudioDump'],
        name: 'Pickle Glass',
        icon: 'src/assets/logo',
        appBundleId: 'com.pickle.glass',
        asarUnpack: [
            "**/*.node",
            "**/*.dylib",
            "node_modules/@img/sharp-darwin-arm64/**",
            "node_modules/@img/sharp-libvips-darwin-arm64/**"
        ],
        osxSign: {
            identity: process.env.APPLE_SIGNING_IDENTITY,
            'hardened-runtime': true,
            entitlements: 'entitlements.plist',
            'entitlements-inherit': 'entitlements.plist',
        },
        osxNotarize: {
            tool: 'notarytool',                // 기본값 'notarytool' (Xcode 13+)
            appleId: process.env.APPLE_ID,     // your@appleid.com
            appleIdPassword: process.env.APPLE_ID_PASSWORD, // 앱 전용 비밀번호
            teamId: process.env.APPLE_TEAM_ID  // 10-자리 팀 ID
            /* 또는
            appleApiKey: './AuthKey_XXXX.p8',
            appleApiKeyId: 'XXXX123456',
            appleApiIssuer: '00000000-0000-0000-0000-000000000000'
            */
        }
    },
    rebuildConfig: {},
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {
                name: 'pickle-glass',
                productName: 'Pickle Glass',
                shortcutName: 'Pickle Glass',
                createDesktopShortcut: true,
                createStartMenuShortcut: true,
            },
        },
        {
            name: '@electron-forge/maker-dmg',
            platforms: ['darwin'],
        },
        {
            name: '@electron-forge/maker-deb',
            config: {},
        },
        {
            name: '@electron-forge/maker-rpm',
            config: {},
        },
    ],
    hooks: {
        afterSign: async (context, forgeConfig, platform, arch, appPath) => {
            await notarizeApp(context, forgeConfig, platform, arch, appPath);
        },
    },
    plugins: [
        {
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {},
        },
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: false,
        }),
    ],
};
