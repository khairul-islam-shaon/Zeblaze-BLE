import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import BleManager from 'react-native-ble-manager';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  CMD_START_DYNAMIC_HEART_RATE,
  CMD_START_ONCE_HEART_RATE,
  CMD_STOP_DYNAMIC_HEART_RATE,
  CMD_STOP_ONCE_HEART_RATE,
  CMD_QUERY_TODAY_HEART_RATE,
  CMD_START_DYNAMIC_HEART_RATE_V1,
  CMD_START_ONCE_HEART_RATE_V1,
  CMD_STOP_DYNAMIC_HEART_RATE_V1,
  CMD_STOP_ONCE_HEART_RATE_V1,
  CMD_QUERY_TODAY_HEART_RATE_V1,
  CMD_QUERY_TODAY_ACTIVITY,
  CMD_QUERY_REALTIME_ACTIVITY,
  CMD_START_SPO2_V1,
  CMD_START_SPO2_V2,
  CMD_STOP_SPO2_V1,
  CMD_STOP_SPO2_V2,
  CMD_QUERY_TODAY_SPO2_V1,
  CMD_QUERY_TODAY_SPO2_V2,
  EXPECTED_RESPONSE_BYTES,
  MAX_LOG_ENTRIES,
  OBSERVED_MAC_ADDRESS,
  RESPONSE_TIMEOUT_MS,
  SCAN_DURATION_SECONDS,
  TARGET_DEVICE_NAME,
  TARGET_NOTIFY_CHAR_UUID,
  TARGET_SERVICE_UUID,
  TARGET_WRITE_CHAR_UUID,
  TEST_COMMAND_BYTES,
} from './bleConstants';
import {
  areBytesEqual,
  areUuidsEqual,
  bytesToHex,
  decodeAscii,
  parseActivityPacket,
  parseHeartRatePacket,
  parseSpO2Packet,
} from './bleUtils';
import {
  BleDevice,
  ConfirmedResponse,
  ConnectionStatus,
  LogEntry,
  SubscriptionStatus,
  TestStatus,
  VerifiedEndpoints,
} from './types';

const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

function subscribeBleEvent(
  eventName: string,
  methodName: string,
  callback: (data: any) => void
): { remove: () => void } {
  const subs: { remove: () => void }[] = [];
  try {
    if (typeof (BleManager as any)[methodName] === 'function') {
      const sub = (BleManager as any)[methodName](callback);
      if (sub && typeof sub.remove === 'function') {
        subs.push(sub);
      }
    }
  } catch {
    // Ignore and fallback to emitter
  }
  try {
    const emitterSub = bleManagerEmitter.addListener(eventName, callback);
    if (emitterSub && typeof emitterSub.remove === 'function') {
      subs.push(emitterSub);
    }
  } catch {
    // Ignore
  }
  return {
    remove: () => {
      subs.forEach((s) => {
        try {
          s.remove();
        } catch {
          // Ignore
        }
      });
    },
  };
}

export function useBle() {
  const [bluetoothReady, setBluetoothReady] = useState<boolean>(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [permissionMessage, setPermissionMessage] = useState<string>('Checking permissions...');

  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [devices, setDevices] = useState<BleDevice[]>([]);

  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null);
  const [connectedDeviceName, setConnectedDeviceName] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>('not_subscribed');

  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = useState<string>('Idle - Ready to send test command');
  const [confirmedResponse, setConfirmedResponse] = useState<ConfirmedResponse | null>(null);

  // Health & Sensor states
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [lastHeartRate, setLastHeartRate] = useState<number | null>(null);
  const [isMeasuringHeartRate, setIsMeasuringHeartRate] = useState<boolean>(false);
  const [spo2, setSpo2] = useState<number | null>(null);
  const [lastSpo2, setLastSpo2] = useState<number | null>(null);
  const [isMeasuringSpo2, setIsMeasuringSpo2] = useState<boolean>(false);
  const [stepCount, setStepCount] = useState<number | null>(null);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [calories, setCalories] = useState<number | null>(null);
  const [activeMinutes, setActiveMinutes] = useState<number | null>(null);
  const [lastHeartRateTimestamp, setLastHeartRateTimestamp] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Refs for tracking mutable states inside listeners and timeouts
  const endpointsRef = useRef<VerifiedEndpoints | null>(null);
  const connectedDeviceIdRef = useRef<string | null>(null);
  const pendingTestRef = useRef<boolean>(false);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScanningRef = useRef<boolean>(false);

  // Helper to add timestamped logs (bounded)
  const addLog = useCallback((type: LogEntry['type'], message: string, rawBytes?: string) => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      rawBytes,
    };
    console.log(`[ZEBLAZE_LOG] [${type}] ${message} ${rawBytes ? `(raw: ${rawBytes})` : ''}`);
    setLogs((prev) => [entry, ...prev].slice(0, MAX_LOG_ENTRIES));
  }, []);

  // Request Android runtime permissions
  const requestAndroidPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      setPermissionGranted(true);
      setPermissionMessage('Non-Android platform');
      return true;
    }

    try {
      if (Platform.Version >= 31) {
        // Android 12+ (API 31+) permissions
        addLog('info', 'Requesting Android 12+ Bluetooth and Location permissions...');
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);

        const scanOk = granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED;
        const connectOk = granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED;
        const locationOk = granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;

        if (scanOk && connectOk) {
          setPermissionGranted(true);
          const msg = locationOk
            ? 'Bluetooth (Scan/Connect) & Location Granted'
            : 'Bluetooth Granted (Location Denied - scan may be limited on MIUI)';
          setPermissionMessage(msg);
          addLog('info', `Permissions granted: ${msg}`);
          return true;
        } else {
          setPermissionGranted(false);
          const err = `Denied: SCAN=${scanOk}, CONNECT=${connectOk}`;
          setPermissionMessage(`Permission Denied (${err})`);
          addLog('error', `Permission denied: ${err}`);
          return false;
        }
      } else {
        // Android 11 or lower
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);
        const ok = granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;
        setPermissionGranted(ok);
        setPermissionMessage(ok ? 'Location permission granted' : 'Location permission denied');
        if (ok) {
          addLog('info', 'Location permission granted (Android <= 11)');
        } else {
          addLog('error', 'Location permission denied (Android <= 11)');
        }
        return ok;
      }
    } catch (err: any) {
      const msg = `Permission request error: ${err?.message || err}`;
      setPermissionGranted(false);
      setPermissionMessage(msg);
      addLog('error', msg);
      return false;
    }
  }, [addLog]);

  // Initialize BleManager module and check state
  const initializeBle = useCallback(async () => {
    try {
      await BleManager.start({ showAlert: false });
      addLog('info', 'BleManager initialized successfully.');

      if (Platform.OS === 'android') {
        try {
          await BleManager.enableBluetooth();
          setBluetoothReady(true);
          addLog('info', 'Bluetooth is enabled.');
        } catch {
          addLog('warn', 'Bluetooth prompt cancelled or disabled.');
          setBluetoothReady(false);
        }
      } else {
        setBluetoothReady(true);
      }
    } catch (err: any) {
      addLog('error', `BleManager initialization failed: ${err?.message || err}`);
    }
  }, [addLog]);

  // Initial startup hook
  useEffect(() => {
    let mounted = true;

    async function init() {
      // Start BleManager core
      try {
        await BleManager.start({ showAlert: false });
      } catch {
        // Ignore
      }

      const permsOk = await requestAndroidPermissions();
      if (mounted && permsOk) {
        await initializeBle();
      }
    }
    init();

    return () => {
      mounted = false;
    };
  }, [requestAndroidPermissions, initializeBle]);

  // Trigger BLE initialization when permissions are granted
  useEffect(() => {
    if (permissionGranted && !bluetoothReady) {
      initializeBle();
    }
  }, [permissionGranted, bluetoothReady, initializeBle]);

  // Setup BLE Event Listeners
  useEffect(() => {
    const stateSub = subscribeBleEvent(
      'BleManagerDidUpdateState',
      'onDidUpdateState',
      ({ state }: { state: string }) => {
        addLog('info', `Bluetooth state changed: ${state}`);
        setBluetoothReady(state === 'on');
      }
    );

    const discoverSub = subscribeBleEvent(
      'BleManagerDiscoverPeripheral',
      'onDiscoverPeripheral',
      (peripheral: { id: string; name?: string | null; rssi?: number; advertising?: any }) => {
        if (!peripheral || !peripheral.id) {
          return;
        }

        const rawName =
          peripheral.name ||
          peripheral.advertising?.localName ||
          null;
        const isTargetMac =
          peripheral.id.toUpperCase() === OBSERVED_MAC_ADDRESS.toUpperCase();
        const isTargetName =
          rawName?.toUpperCase().includes(TARGET_DEVICE_NAME) ||
          rawName?.toUpperCase().includes('BTALK');
        const resolvedName =
          rawName || (isTargetMac ? 'BTALK 4 PRO' : null);

        setDevices((prev) => {
          const exists = prev.some((d) => d.id === peripheral.id);
          if (exists) {
            // Update name or rssi if available
            return prev.map((d) =>
              d.id === peripheral.id
                ? {
                    ...d,
                    name: resolvedName || d.name,
                    rssi: peripheral.rssi ?? d.rssi,
                  }
                : d
            );
          }
          const newDev: BleDevice = {
            id: peripheral.id,
            name: resolvedName,
            rssi: peripheral.rssi,
          };
          // Place matching watch devices (by name or known address) at top
          if (isTargetName || isTargetMac) {
            addLog('info', `Discovered Target Watch: ${resolvedName || peripheral.id} (${peripheral.id})`);
            return [newDev, ...prev];
          }
          return [...prev, newDev];
        });
      }
    );

    const stopScanSub = subscribeBleEvent(
      'BleManagerStopScan',
      'onStopScan',
      () => {
        isScanningRef.current = false;
        setIsScanning(false);
        addLog('info', 'Scan finished or stopped.');
      }
    );

    const disconnectSub = subscribeBleEvent(
      'BleManagerDisconnectPeripheral',
      'onDisconnectPeripheral',
      ({ peripheral }: { peripheral: string }) => {
        addLog('warn', `Device disconnected: ${peripheral}`);
        if (connectedDeviceIdRef.current === peripheral) {
          // Cleanup connection and subscription
          connectedDeviceIdRef.current = null;
          endpointsRef.current = null;
          setConnectedDeviceId(null);
          setConnectedDeviceName(null);
          setConnectionStatus('disconnected');
          setSubscriptionStatus('not_subscribed');
          setIsMeasuringHeartRate(false);

          // Cleanup pending test if device disconnected
          if (pendingTestRef.current) {
            pendingTestRef.current = false;
            if (timeoutTimerRef.current) {
              clearTimeout(timeoutTimerRef.current);
              timeoutTimerRef.current = null;
            }
            setTestStatus('error');
            setTestMessage('Device disconnected while test command was pending.');
          }
        }
      }
    );

    const notifySub = subscribeBleEvent(
      'BleManagerDidUpdateValueForCharacteristic',
      'onDidUpdateValueForCharacteristic',
      ({
        characteristic,
        value,
      }: {
        peripheral: string;
        characteristic: string;
        service: string;
        value: number[];
      }) => {
        const rawHex = bytesToHex(value);

        // 1. Check for Real-Time or History Heart Rate notification (FF03 or 2A37)
        const hr = parseHeartRatePacket(value, characteristic);
        if (hr !== null) {
          if (hr.bpm > 0) {
            setHeartRate(hr.bpm);
            setLastHeartRate(hr.bpm);
            setLastHeartRateTimestamp(new Date().toLocaleTimeString());
            addLog('success', `[RX HEART RATE] ${hr.bpm} BPM`, rawHex);
          } else {
            addLog('info', '[RX HEART RATE] Optical sensor measuring...', rawHex);
          }
          if (hr.isSingleComplete) {
            setIsMeasuringHeartRate(false);
          }
        }

        // 2. Check for Daily Activity / Step notification (80 80 ...)
        const act = parseActivityPacket(value);
        if (act !== null) {
          setStepCount(act.steps);
          setDistanceMeters(act.distance);
          setCalories(act.calories);
          setActiveMinutes(act.activeMinutes);
          addLog(
            'info',
            `[RX ACTIVITY] Steps: ${act.steps.toLocaleString()} | Distance: ${(act.distance / 1000).toFixed(2)}km | Energy: ${act.calories}kcal`,
            rawHex
          );
        }

        // 3. Check for SpO2 (Blood Oxygen) notification
        const sp = parseSpO2Packet(value);
        if (sp !== null) {
          setSpo2(sp.spo2);
          setLastSpo2(sp.spo2);
          addLog('success', `[RX SPO2] ${sp.spo2}% Blood Oxygen`, rawHex);
          if (sp.isComplete) {
            setIsMeasuringSpo2(false);
          }
        }

        // Check if notification is from the target notify characteristic FF03
        const isNotifyChar = areUuidsEqual(characteristic, TARGET_NOTIFY_CHAR_UUID);

        if (!isNotifyChar) {
          if (hr === null && act === null && sp === null) {
            addLog('rx', `[RX other char ${characteristic}] ${rawHex}`);
          }
          return;
        }

        // It is on FF03! Check whether it matches the expected response
        const isExpected = areBytesEqual(value, EXPECTED_RESPONSE_BYTES);

        if (isExpected) {
          // Expected response: 00 82 09 00 01 31 2E 31 30
          // Trailing bytes [0x31, 0x2E, 0x31, 0x30] decode to "1.10"
          const decodedText = decodeAscii(value.slice(5));
          const labeledResponse = `Version-like response: ${decodedText || '1.10'}`;

          // Keep the confirmed response permanently visible
          setConfirmedResponse({
            rawHex,
            decodedText: labeledResponse,
            timestamp: new Date().toLocaleTimeString(),
          });

          addLog(
            'success',
            `[RX CONFIRMED SUCCESS] ${rawHex} -> ${labeledResponse}`,
            rawHex
          );

          // If a test was pending, resolve it
          if (pendingTestRef.current) {
            if (timeoutTimerRef.current) {
              clearTimeout(timeoutTimerRef.current);
              timeoutTimerRef.current = null;
            }
            pendingTestRef.current = false;
            setTestStatus('success');
            setTestMessage(`Success! ${labeledResponse}`);
          }
        } else if (hr === null && act === null && sp === null) {
          // Unsolicited or other notification on FF03 (e.g. 80 82 07 00 01 64 00)
          addLog('rx', `[RX notification on FF03] ${rawHex}`, rawHex);

          // Do NOT mark as success, do NOT cancel the pending test timer.
          // The pending test remains in 'waiting' state until the expected response or timeout.
        }
      }
    );

    return () => {
      stateSub.remove();
      discoverSub.remove();
      stopScanSub.remove();
      disconnectSub.remove();
      notifySub.remove();
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
      }
    };
  }, [addLog]);

  // Start BLE Scan
  const startScan = useCallback(async () => {
    let perms = permissionGranted;
    if (!perms) {
      perms = await requestAndroidPermissions();
      if (!perms) {
        return;
      }
    }

    try {
      await BleManager.start({ showAlert: false });
      if (Platform.OS === 'android') {
        try {
          await BleManager.enableBluetooth();
          setBluetoothReady(true);
        } catch {
          // User may have declined or Bluetooth is off
        }
      }

      if (isScanningRef.current) {
        await BleManager.stopScan();
      }
      setDevices([]);
      isScanningRef.current = true;
      setIsScanning(true);
      addLog('info', `Starting BLE scan (${SCAN_DURATION_SECONDS}s)...`);

      // 1. Fetch bonded/paired devices (smartwatches paired in phone settings)
      try {
        const bonded = await BleManager.getBondedPeripherals();
        if (bonded && bonded.length > 0) {
          addLog('info', `Found ${bonded.length} bonded device(s).`);
          setDevices((prev) => {
            const list = [...prev];
            for (const b of bonded) {
              if (!list.some((d) => d.id === b.id)) {
                const isTargetMac = b.id.toUpperCase() === OBSERVED_MAC_ADDRESS.toUpperCase();
                const resolvedName = b.name || (isTargetMac ? 'BTALK 4 PRO' : null);
                list.unshift({
                  id: b.id,
                  name: resolvedName,
                  rssi: b.rssi,
                });
              }
            }
            return list;
          });
        }
      } catch {
        // Ignore
      }

      // 2. Fetch already connected peripherals
      try {
        const connected = await BleManager.getConnectedPeripherals([]);
        if (connected && connected.length > 0) {
          setDevices((prev) => {
            const list = [...prev];
            for (const c of connected) {
              if (!list.some((d) => d.id === c.id)) {
                const isTargetMac = c.id.toUpperCase() === OBSERVED_MAC_ADDRESS.toUpperCase();
                const resolvedName = c.name || (isTargetMac ? 'BTALK 4 PRO' : null);
                list.unshift({
                  id: c.id,
                  name: resolvedName,
                  rssi: c.rssi,
                });
              }
            }
            return list;
          });
        }
      } catch {
        // Ignore
      }

      // 3. Scan for advertising peripherals
      await BleManager.scan({
        serviceUUIDs: [],
        seconds: SCAN_DURATION_SECONDS,
        allowDuplicates: true,
      });
    } catch (err: any) {
      isScanningRef.current = false;
      setIsScanning(false);
      addLog('error', `Start scan failed: ${err?.message || err}`);
    }
  }, [permissionGranted, requestAndroidPermissions, addLog]);

  // Stop BLE Scan
  const stopScan = useCallback(async () => {
    try {
      await BleManager.stopScan();
      isScanningRef.current = false;
      setIsScanning(false);
      addLog('info', 'Stopping BLE scan...');
    } catch (err: any) {
      addLog('error', `Stop scan error: ${err?.message || err}`);
    }
  }, [addLog]);

  // Connect to a device and discover & verify services
  const connectDevice = useCallback(
    async (device: BleDevice) => {
      // 1. Stop scanning before connecting
      if (isScanningRef.current) {
        try {
          await BleManager.stopScan();
          isScanningRef.current = false;
          setIsScanning(false);
          addLog('info', 'Stopped scan prior to connection.');
        } catch {
          // Ignore
        }
      }

      setConnectionStatus('connecting');
      setSubscriptionStatus('not_subscribed');
      endpointsRef.current = null;
      addLog('info', `Connecting to ${device.name || 'device'} (${device.id})...`);

      try {
        await BleManager.connect(device.id);
        connectedDeviceIdRef.current = device.id;
        setConnectedDeviceId(device.id);
        setConnectedDeviceName(device.name || null);
        setConnectionStatus('connected');
        addLog('info', `Connected to ${device.id}. Discovering services and characteristics...`);

        // 2. Discover services and characteristics
        const peripheralInfo = await BleManager.retrieveServices(device.id);
        addLog('info', `Services retrieved for ${device.id}. Verifying UUIDs...`);

        // 3. Verify exact UUIDs
        const chars = peripheralInfo.characteristics || [];
        let matchedServiceUuid: string | null = null;
        let matchedWriteChar: string | null = null;
        let matchedNotifyChar: string | null = null;

        for (const c of chars) {
          const serviceMatch = areUuidsEqual(c.service, TARGET_SERVICE_UUID);
          if (serviceMatch) {
            matchedServiceUuid = c.service;
            if (areUuidsEqual(c.characteristic, TARGET_WRITE_CHAR_UUID)) {
              matchedWriteChar = c.characteristic;
            }
            if (areUuidsEqual(c.characteristic, TARGET_NOTIFY_CHAR_UUID)) {
              matchedNotifyChar = c.characteristic;
            }
          }
        }

        // Fallback: If not nested under target service, check characteristics directly
        if (!matchedWriteChar || !matchedNotifyChar) {
          for (const c of chars) {
            if (!matchedWriteChar && areUuidsEqual(c.characteristic, TARGET_WRITE_CHAR_UUID)) {
              matchedWriteChar = c.characteristic;
              if (!matchedServiceUuid) {
                matchedServiceUuid = c.service;
              }
            }
            if (!matchedNotifyChar && areUuidsEqual(c.characteristic, TARGET_NOTIFY_CHAR_UUID)) {
              matchedNotifyChar = c.characteristic;
              if (!matchedServiceUuid) {
                matchedServiceUuid = c.service;
              }
            }
          }
        }

        if (!matchedServiceUuid || !matchedWriteChar || !matchedNotifyChar) {
          const foundList = chars.map((c) => `${c.service} / ${c.characteristic}`).join(', ');
          addLog(
            'error',
            `Verified UUIDs not found! Need: S=${TARGET_SERVICE_UUID}, W=${TARGET_WRITE_CHAR_UUID}, N=${TARGET_NOTIFY_CHAR_UUID}. Found: [${foundList}]`
          );
          setSubscriptionStatus('not_subscribed');
          return;
        }

        addLog(
          'info',
          `Verified exact endpoints:\n• Service: ${matchedServiceUuid}\n• Write (FF02): ${matchedWriteChar}\n• Notify (FF03): ${matchedNotifyChar}`
        );

        endpointsRef.current = {
          serviceUuid: matchedServiceUuid,
          writeCharUuid: matchedWriteChar,
          notifyCharUuid: matchedNotifyChar,
        };

        // 4. Subscribe to FF03 before enabling test button
        setSubscriptionStatus('subscribing');
        addLog('info', `Subscribing to notifications on FF03 (${matchedNotifyChar})...`);

        await BleManager.startNotification(
          device.id,
          matchedServiceUuid,
          matchedNotifyChar
        );

        setSubscriptionStatus('subscribed');
        addLog('success', 'Successfully subscribed to FF03 notifications. Ready for test command!');

        // Auto-query today's activity (0x33), realtime activity and heart rate history
        try {
          await BleManager.writeWithoutResponse(
            device.id,
            matchedServiceUuid,
            matchedWriteChar,
            [0x00, 0x33, 0x04, 0x00],
            20
          );
          await BleManager.writeWithoutResponse(
            device.id,
            matchedServiceUuid,
            matchedWriteChar,
            [0xfe, 0xea, 0x10, 0x06, 0x33, 0x00],
            20
          );
          await BleManager.writeWithoutResponse(
            device.id,
            matchedServiceUuid,
            matchedWriteChar,
            CMD_QUERY_TODAY_ACTIVITY,
            20
          );
          await BleManager.writeWithoutResponse(
            device.id,
            matchedServiceUuid,
            matchedWriteChar,
            CMD_QUERY_REALTIME_ACTIVITY,
            20
          );
          await BleManager.writeWithoutResponse(
            device.id,
            matchedServiceUuid,
            matchedWriteChar,
            CMD_QUERY_TODAY_HEART_RATE_V1,
            20
          );
          addLog('info', '[TX Init] Queried watch for today activity & heart rate history.');
        } catch {
          // non-critical
        }
      } catch (err: any) {
        addLog('error', `Connection or discovery failed: ${err?.message || err}`);
        setConnectionStatus('disconnected');
        setSubscriptionStatus('not_subscribed');
        connectedDeviceIdRef.current = null;
        endpointsRef.current = null;
      }
    },
    [addLog]
  );

  // Disconnect from current device
  const disconnectDevice = useCallback(async () => {
    const devId = connectedDeviceIdRef.current;
    if (!devId) {
      return;
    }

    setConnectionStatus('disconnecting');
    addLog('info', `Disconnecting from ${devId}...`);

    try {
      if (pendingTestRef.current) {
        pendingTestRef.current = false;
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        setTestStatus('error');
        setTestMessage('Test cancelled due to disconnection.');
      }

      await BleManager.disconnect(devId);
      connectedDeviceIdRef.current = null;
      endpointsRef.current = null;
      setConnectedDeviceId(null);
      setConnectedDeviceName(null);
      setConnectionStatus('disconnected');
      setSubscriptionStatus('not_subscribed');
      addLog('info', `Disconnected from ${devId}.`);
    } catch (err: any) {
      addLog('error', `Disconnection error: ${err?.message || err}`);
      setConnectionStatus('disconnected');
      setSubscriptionStatus('not_subscribed');
      connectedDeviceIdRef.current = null;
      endpointsRef.current = null;
    }
  }, [addLog]);

  // Send the verified 4-byte test command
  const sendTestCommand = useCallback(async () => {
    // Check if test is already pending (only allow one at a time)
    if (pendingTestRef.current || testStatus === 'waiting') {
      addLog('warn', 'A test command is already in progress. Please wait.');
      return;
    }

    if (!endpointsRef.current || connectionStatus !== 'connected' || subscriptionStatus !== 'subscribed') {
      addLog('error', 'Device is not connected or FF03 is not subscribed.');
      return;
    }

    const { serviceUuid, writeCharUuid } = endpointsRef.current;
    const devId = connectedDeviceIdRef.current;
    if (!devId) {
      addLog('error', 'No active device connection.');
      return;
    }

    // Set waiting state
    setTestStatus('waiting');
    setTestMessage('Waiting for response on FF03 (5s timeout)...');
    pendingTestRef.current = true;

    // Reset any active timer
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
    }

    // Start 5-second response timeout
    timeoutTimerRef.current = setTimeout(() => {
      if (pendingTestRef.current) {
        pendingTestRef.current = false;
        setTestStatus('timeout');
        setTestMessage('Timeout: No matching response on FF03 within 5 seconds.');
        addLog('warn', '[TIMEOUT] 5 seconds elapsed without receiving expected response (00 82 09 00 01 31 2E 31 30).');
      }
    }, RESPONSE_TIMEOUT_MS);

    const cmdHex = bytesToHex(TEST_COMMAND_BYTES);
    addLog('tx', `[TX] Sending 4 raw bytes [${cmdHex}] to FF02 (Write Without Response)...`, cmdHex);

    try {
      // Send raw bytes using Write Without Response as preferred
      await BleManager.writeWithoutResponse(
        devId,
        serviceUuid,
        writeCharUuid,
        TEST_COMMAND_BYTES,
        20
      );
      if (pendingTestRef.current) {
        addLog('info', 'BLE write completed. Awaiting device response packet on FF03...');
      } else {
        addLog('info', 'BLE write completed (expected response was already received).');
      }
    } catch (err: any) {
      if (pendingTestRef.current) {
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        pendingTestRef.current = false;
        const errMsg = `BLE write failed: ${err?.message || err}`;
        setTestStatus('error');
        setTestMessage(errMsg);
        addLog('error', errMsg);
      } else {
        addLog('warn', `BLE write error reported after response was already received: ${err?.message || err}`);
      }
    }
  }, [connectionStatus, subscriptionStatus, testStatus, addLog]);

  // Start Heart Rate Measurement
  const startHeartRateMeasure = useCallback(
    async (mode: 'single' | 'dynamic' | 'both' = 'single') => {
      if (!endpointsRef.current || connectionStatus !== 'connected' || subscriptionStatus !== 'subscribed') {
        addLog('error', 'Cannot measure: Device is not connected or FF03 is not subscribed.');
        return;
      }
      const { serviceUuid, writeCharUuid } = endpointsRef.current;
      const devId = connectedDeviceIdRef.current;
      if (!devId) {
        addLog('error', 'No connected device ID.');
        return;
      }

      setIsMeasuringHeartRate(true);

      try {
        const sendPacket = async (packet: number[]) => {
          try {
            await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, packet, 20);
          } catch {
            await BleManager.write(devId, serviceUuid, writeCharUuid, packet, 20);
          }
        };

        if (mode === 'single') {
          addLog('tx', '[TX Heart Rate] Starting Single Heart Rate (0x6D)...');
          await sendPacket(CMD_START_ONCE_HEART_RATE_V1);
          await sendPacket(CMD_START_ONCE_HEART_RATE);
        } else if (mode === 'dynamic') {
          addLog('tx', '[TX Heart Rate] Starting Dynamic Heart Rate (0x68)...');
          await sendPacket(CMD_START_DYNAMIC_HEART_RATE_V1);
          await sendPacket(CMD_START_DYNAMIC_HEART_RATE);
        } else {
          addLog('tx', '[TX Heart Rate] Starting Heart Rate Measurement (sending 0x6D & 0x68)...');
          await sendPacket(CMD_START_DYNAMIC_HEART_RATE_V1);
          await sendPacket(CMD_START_ONCE_HEART_RATE_V1);
          await sendPacket(CMD_START_DYNAMIC_HEART_RATE);
          await sendPacket(CMD_START_ONCE_HEART_RATE);
        }
        addLog('info', '[TX Heart Rate] Command sent to FF02. Optical sensor illuminating on watch...');
      } catch (err: any) {
        setIsMeasuringHeartRate(false);
        addLog('error', `[TX Heart Rate] Failed to send heart rate command: ${err?.message || err}`);
      }
    },
    [connectionStatus, subscriptionStatus, addLog]
  );

  // Stop Heart Rate Measurement
  const stopHeartRateMeasure = useCallback(async () => {
    setIsMeasuringHeartRate(false);
    if (!endpointsRef.current || connectionStatus !== 'connected') {
      return;
    }
    const { serviceUuid, writeCharUuid } = endpointsRef.current;
    const devId = connectedDeviceIdRef.current;
    if (!devId) {
      return;
    }

    addLog('tx', '[TX Heart Rate] Stopping heart rate measurement...');
    try {
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_STOP_DYNAMIC_HEART_RATE_V1, 20);
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_STOP_ONCE_HEART_RATE_V1, 20);
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_STOP_DYNAMIC_HEART_RATE, 20);
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_STOP_ONCE_HEART_RATE, 20);
      addLog('info', '[TX Heart Rate] Measurement stopped. Sensor off.');
    } catch (err: any) {
      addLog('warn', `[TX Heart Rate] Stop command error: ${err?.message || err}`);
    }
  }, [connectionStatus, addLog]);

  // Query today history / last recorded heart rate
  const queryHistoryHeartRate = useCallback(async () => {
    if (!endpointsRef.current || connectionStatus !== 'connected') {
      addLog('warn', 'Cannot query: Device is not connected.');
      return;
    }
    const { serviceUuid, writeCharUuid } = endpointsRef.current;
    const devId = connectedDeviceIdRef.current;
    if (!devId) {
      return;
    }

    addLog('tx', '[TX Query] Querying today history / last recorded heart rate (0x35)...');
    try {
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_QUERY_TODAY_HEART_RATE_V1, 20);
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_QUERY_TODAY_HEART_RATE, 20);
      addLog('info', '[TX Query] Query command sent to FF02.');
    } catch (err: any) {
      addLog('error', `[TX Query] Failed to query: ${err?.message || err}`);
    }
  }, [connectionStatus, addLog]);

  // Start / Stop SpO2 (Blood Oxygen) Measurement
  const startSpo2Measure = useCallback(async () => {
    if (!endpointsRef.current || connectionStatus !== 'connected' || subscriptionStatus !== 'subscribed') {
      addLog('error', 'Cannot measure: Device is not connected or FF03 is not subscribed.');
      return;
    }
    const { serviceUuid, writeCharUuid } = endpointsRef.current;
    const devId = connectedDeviceIdRef.current;
    if (!devId) {
      return;
    }
    setIsMeasuringSpo2(true);
    addLog('tx', '[TX SpO2] Starting Blood Oxygen (SpO2) measurement (0x6B)...');
    try {
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_START_SPO2_V1, 20);
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_START_SPO2_V2, 20);
      addLog('info', '[TX SpO2] Sensor command sent. Keep watch firmly pressed on wrist...');
    } catch (err: any) {
      setIsMeasuringSpo2(false);
      addLog('error', `[TX SpO2] Failed to start: ${err?.message || err}`);
    }
  }, [connectionStatus, subscriptionStatus, addLog]);

  const stopSpo2Measure = useCallback(async () => {
    setIsMeasuringSpo2(false);
    if (!endpointsRef.current || connectionStatus !== 'connected') {
      return;
    }
    const { serviceUuid, writeCharUuid } = endpointsRef.current;
    const devId = connectedDeviceIdRef.current;
    if (!devId) {
      return;
    }
    try {
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_STOP_SPO2_V1, 20);
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_STOP_SPO2_V2, 20);
      addLog('info', '[TX SpO2] SpO2 measurement stopped.');
    } catch {
      // ignore
    }
  }, [connectionStatus, addLog]);

  const queryTodaySpo2 = useCallback(async () => {
    if (!endpointsRef.current || connectionStatus !== 'connected') {
      return;
    }
    const { serviceUuid, writeCharUuid } = endpointsRef.current;
    const devId = connectedDeviceIdRef.current;
    if (!devId) {
      return;
    }
    try {
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_QUERY_TODAY_SPO2_V1, 20);
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, CMD_QUERY_TODAY_SPO2_V2, 20);
    } catch {
      // ignore
    }
  }, [connectionStatus]);

  // Query today activity (steps, distance, calories)
  const queryTodayActivity = useCallback(async () => {
    if (!endpointsRef.current || connectionStatus !== 'connected') {
      addLog('warn', 'Cannot query: Device is not connected.');
      return;
    }
    const { serviceUuid, writeCharUuid } = endpointsRef.current;
    const devId = connectedDeviceIdRef.current;
    if (!devId) {
      return;
    }

    addLog('tx', '[TX Query] Querying today activity & steps (0x33)...');
    try {
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, [0x00, 0x33, 0x04, 0x00], 20);
      await BleManager.writeWithoutResponse(devId, serviceUuid, writeCharUuid, [0xfe, 0xea, 0x10, 0x06, 0x33, 0x00], 20);

      // Also try to read 0000fea1 on Service 0000fee7 (WeChat Sports / Activity)
      try {
        const fee7Result = await BleManager.read(
          devId,
          '0000fee7-0000-1000-8000-00805f9b34fb',
          '0000fea1-0000-1000-8000-00805f9b34fb'
        );
        if (fee7Result && fee7Result.length > 0) {
          const rawHex = bytesToHex(fee7Result);
          addLog('rx', `[RX FEE7/FEA1] ${rawHex}`, rawHex);
          const act = parseActivityPacket(fee7Result);
          if (act) {
            setStepCount(act.steps);
            setDistanceMeters(act.distance);
            setCalories(act.calories);
            addLog(
              'success',
              `[RX ACTIVITY FEA1] Steps: ${act.steps.toLocaleString()} | Distance: ${(act.distance / 1000).toFixed(2)}km | Energy: ${act.calories}kcal`,
              rawHex
            );
          }
        }
      } catch {
        // fee7 read is optional
      }

      addLog('info', '[TX Query] Step query (0x33) sent to FF02.');
    } catch (err: any) {
      addLog('error', `[TX Query] Failed to query activity: ${err?.message || err}`);
    }
  }, [connectionStatus, addLog]);

  // Clear log
  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // Copy log to clipboard
  const copyLogs = useCallback(() => {
    if (logs.length === 0) {
      addLog('info', 'No logs to copy.');
      return;
    }
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.message}`)
      .join('\n');
    Clipboard.setString(text);
    addLog('info', 'Logs copied to clipboard.');
  }, [logs, addLog]);

  return {
    bluetoothReady,
    permissionGranted,
    permissionMessage,
    requestAndroidPermissions,
    isScanning,
    devices,
    startScan,
    stopScan,
    connectedDeviceId,
    connectedDeviceName,
    connectionStatus,
    subscriptionStatus,
    connectDevice,
    disconnectDevice,
    testStatus,
    testMessage,
    confirmedResponse,
    sendTestCommand,
    heartRate,
    lastHeartRate,
    isMeasuringHeartRate,
    spo2,
    lastSpo2,
    isMeasuringSpo2,
    stepCount,
    distanceMeters,
    calories,
    activeMinutes,
    lastHeartRateTimestamp,
    startHeartRateMeasure,
    stopHeartRateMeasure,
    startSpo2Measure,
    stopSpo2Measure,
    queryTodaySpo2,
    queryHistoryHeartRate,
    queryTodayActivity,
    logs,
    clearLogs,
    copyLogs,
  };
}
