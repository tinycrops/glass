// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipcRenderer', {
  send: (channel, data) => {
    // 화이트리스트에 있는 채널만 허용
    const validChannels = ['set-current-user', 'firebase-auth-success'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  sendSync: (channel, data) => {
    const validChannels = ['get-api-url-sync'];
    if (validChannels.includes(channel)) {
      return ipcRenderer.sendSync(channel, data);
    }
  },
  on: (channel, func) => {
    const validChannels = ['api-key-updated'];
    if (validChannels.includes(channel)) {
      // func 래핑하여 sender와 같은 불필요한 인자 제거
      const newCallback = (_, ...args) => func(...args);
      ipcRenderer.on(channel, newCallback);
      // cleanup 함수 반환
      return () => {
        ipcRenderer.removeListener(channel, newCallback);
      };
    }
  },
  invoke: (channel, ...args) => {
    const validChannels = ['save-api-key'];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
  },
  removeAllListeners: (channel) => {
    const validChannels = ['api-key-updated'];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
});
