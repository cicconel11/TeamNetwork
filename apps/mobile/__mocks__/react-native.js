module.exports = {
  Platform: { OS: "ios", select: (obj) => obj.ios },
  StyleSheet: { create: (s) => s },
  NativeModules: {},
  NativeEventEmitter: jest.fn(() => ({
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  })),
};
