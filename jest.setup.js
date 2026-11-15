/* eslint-disable no-undef */
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');

jest.mock('react-native/Libraries/Interaction/InteractionManager', () => ({
  runAfterInteractions: jest.fn((cb) => {
    if (cb) {
      cb();
    }
    return { cancel: jest.fn() };
  }),
  createInteractionHandle: jest.fn(),
  clearInteractionHandle: jest.fn(),
}));

jest.mock('react-native-ble-manager', () => ({
  __esModule: true,
  default: {
    start: jest.fn().mockResolvedValue(undefined),
    scan: jest.fn().mockResolvedValue(undefined),
    stopScan: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    retrieveServices: jest.fn().mockResolvedValue({
      services: [{ uuid: '000001ff-3c17-d293-8e48-14fe2e4da212' }],
      characteristics: [
        {
          service: '000001ff-3c17-d293-8e48-14fe2e4da212',
          characteristic: '0000ff02-0000-1000-8000-00805f9b34fb',
          properties: { WriteWithoutResponse: 'WriteWithoutResponse' },
        },
        {
          service: '000001ff-3c17-d293-8e48-14fe2e4da212',
          characteristic: '0000ff03-0000-1000-8000-00805f9b34fb',
          properties: { Notify: 'Notify' },
        },
      ],
    }),
    startNotification: jest.fn().mockResolvedValue(undefined),
    writeWithoutResponse: jest.fn().mockResolvedValue(undefined),
    enableBluetooth: jest.fn().mockResolvedValue(undefined),
    checkState: jest.fn().mockResolvedValue('on'),
  },
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
  getString: jest.fn().mockResolvedValue(''),
}));
