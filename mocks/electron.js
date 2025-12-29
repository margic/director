module.exports = {
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
  },
  shell: {
    openExternal: async () => {},
  },
  BrowserWindow: class {},
  ipcMain: {
    handle: () => {},
    on: () => {},
  }
};
