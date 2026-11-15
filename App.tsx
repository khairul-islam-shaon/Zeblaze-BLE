import React, { useMemo } from 'react';
import {
  FlatList,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useBle } from './src/useBle';
import { BleDevice, LogEntry, TestStatus } from './src/types';
import {
  OBSERVED_MAC_ADDRESS,
  TARGET_DEVICE_NAME,
  TEST_COMMAND_BYTES,
} from './src/bleConstants';
import { bytesToHex } from './src/bleUtils';

export default function App(): React.JSX.Element {
  const {
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
    stepCount,
    distanceMeters,
    calories,
    lastHeartRateTimestamp,
    startHeartRateMeasure,
    stopHeartRateMeasure,
    queryHistoryHeartRate,
    logs,
    clearLogs,
    copyLogs,
  } = useBle();

  const isConnected = connectionStatus === 'connected';
  const isSubscribed = subscriptionStatus === 'subscribed';
  const isWaiting = testStatus === 'waiting';
  const canSendTest = isConnected && isSubscribed && !isWaiting;

  // Pin the target watch at the very top, followed by named devices, ordered by RSSI
  const sortedDevices = useMemo(() => {
    return [...devices].sort((a, b) => {
      const aIsTarget =
        (a.name && (a.name.toUpperCase().includes(TARGET_DEVICE_NAME) || a.name.toUpperCase().includes('BTALK'))) ||
        a.id.toUpperCase() === OBSERVED_MAC_ADDRESS.toUpperCase();
      const bIsTarget =
        (b.name && (b.name.toUpperCase().includes(TARGET_DEVICE_NAME) || b.name.toUpperCase().includes('BTALK'))) ||
        b.id.toUpperCase() === OBSERVED_MAC_ADDRESS.toUpperCase();

      if (aIsTarget && !bIsTarget) {
        return -1;
      }
      if (!aIsTarget && bIsTarget) {
        return 1;
      }

      // Prioritize named devices over unnamed
      const aHasName = !!a.name && a.name !== '(Unnamed device)';
      const bHasName = !!b.name && b.name !== '(Unnamed device)';
      if (aHasName && !bHasName) {
        return -1;
      }
      if (!aHasName && bHasName) {
        return 1;
      }

      return (b.rssi ?? -999) - (a.rssi ?? -999);
    });
  }, [devices]);

  const renderStatusBadge = (status: TestStatus) => {
    switch (status) {
      case 'success':
        return <Text style={[styles.badge, styles.badgeSuccess]}>SUCCESS</Text>;
      case 'waiting':
        return <Text style={[styles.badge, styles.badgeWaiting]}>WAITING (5s)</Text>;
      case 'timeout':
        return <Text style={[styles.badge, styles.badgeTimeout]}>TIMEOUT</Text>;
      case 'error':
        return <Text style={[styles.badge, styles.badgeError]}>ERROR</Text>;
      case 'idle':
      default:
        return <Text style={[styles.badge, styles.badgeIdle]}>IDLE</Text>;
    }
  };

  const renderLogItem = ({ item }: { item: LogEntry }) => {
    let colorStyle = styles.logInfo;
    if (item.type === 'tx') {
      colorStyle = styles.logTx;
    } else if (item.type === 'rx') {
      colorStyle = styles.logRx;
    } else if (item.type === 'success') {
      colorStyle = styles.logSuccess;
    } else if (item.type === 'error') {
      colorStyle = styles.logError;
    } else if (item.type === 'warn') {
      colorStyle = styles.logWarn;
    }

    return (
      <View style={styles.logRow}>
        <Text style={styles.logTime}>{item.timestamp}</Text>
        <Text style={[styles.logType, colorStyle]}>[{item.type.toUpperCase()}]</Text>
        <Text style={[styles.logMsg, colorStyle]}>{item.message}</Text>
      </View>
    );
  };

  const renderDeviceItem = ({ item }: { item: BleDevice }) => {
    const isThisConnected = connectedDeviceId === item.id && isConnected;
    const isTargetDevice =
      item.name?.toUpperCase().includes(TARGET_DEVICE_NAME) ||
      item.id.toUpperCase() === OBSERVED_MAC_ADDRESS.toUpperCase();

    return (
      <View style={[styles.deviceCard, isTargetDevice && styles.targetDeviceCard]}>
        <View style={styles.deviceInfo}>
          <View style={styles.deviceNameRow}>
            <Text style={styles.deviceName}>{item.name || '(Unnamed device)'}</Text>
            {isTargetDevice && <Text style={styles.verifiedTag}>★ TARGET</Text>}
          </View>
          <Text style={styles.deviceId}>{item.id}</Text>
          {item.rssi !== undefined && (
            <Text style={styles.deviceRssi}>RSSI: {item.rssi} dBm</Text>
          )}
        </View>

        {isThisConnected ? (
          <TouchableOpacity
            style={[styles.smallBtn, styles.btnDisconnect]}
            onPress={disconnectDevice}
          >
            <Text style={styles.btnText}>Disconnect</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.smallBtn, styles.btnConnect]}
            disabled={connectionStatus === 'connecting'}
            onPress={() => connectDevice(item)}
          >
            <Text style={styles.btnText}>
              {connectionStatus === 'connecting' && connectedDeviceId === item.id
                ? 'Connecting...'
                : 'Connect'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* 1. Header & System Status */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Zeblaze BLE Test</Text>
          <Text style={styles.subtitle}>Btalk 4 Pro Debugger</Text>
        </View>
        <Text style={styles.reminderText}>
          ⚠️ Ensure nRF Connect is disconnected and Zeblaze Connect force-stopped.
        </Text>

        <View style={styles.statusRow}>
          <View style={styles.statusItem}>
            <Text style={styles.statusLabel}>Bluetooth: </Text>
            <Text style={bluetoothReady ? styles.statusGood : styles.statusBad}>
              {bluetoothReady ? 'Ready' : 'Disabled'}
            </Text>
          </View>
          <View style={styles.statusItem}>
            <Text style={styles.statusLabel}>Permission: </Text>
            <Text style={permissionGranted ? styles.statusGood : styles.statusBad}>
              {permissionGranted ? 'Granted' : 'Denied'}
            </Text>
          </View>
          {!permissionGranted && (
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={requestAndroidPermissions}
            >
              <Text style={styles.retryBtnText}>Request</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.permMessage} numberOfLines={1}>
          {permissionMessage}
        </Text>
      </View>

      {/* 2. Connection & Subscription Status Bar */}
      <View style={styles.sectionCard}>
        <View style={styles.connStatusRow}>
          <View style={styles.connCol}>
            <Text style={styles.metaLabel}>Device:</Text>
            <Text style={styles.metaValue} numberOfLines={1}>
              {connectedDeviceId
                ? `${connectedDeviceName || 'Device'} (${connectedDeviceId})`
                : 'None'}
            </Text>
          </View>
          <View style={styles.connCol}>
            <Text style={styles.metaLabel}>Status:</Text>
            <Text
              style={[
                styles.metaValue,
                isConnected ? styles.statusGood : styles.statusNeutral,
              ]}
            >
              {connectionStatus.toUpperCase()}
            </Text>
          </View>
          <View style={styles.connCol}>
            <Text style={styles.metaLabel}>FF03 Notify:</Text>
            <Text
              style={[
                styles.metaValue,
                isSubscribed ? styles.statusGood : styles.statusNeutral,
              ]}
            >
              {subscriptionStatus === 'subscribed'
                ? 'SUBSCRIBED'
                : subscriptionStatus === 'subscribing'
                ? 'SUBSCRIBING...'
                : 'OFF'}
            </Text>
          </View>
        </View>
      </View>

      {/* 2b. Health Metrics & Real-Time Sensors */}
      <View style={styles.healthSectionCard}>
        <View style={styles.healthHeaderRow}>
          <Text style={styles.sectionTitle}>Health Metrics & Sensors</Text>
          {isMeasuringHeartRate ? (
            <Text style={[styles.badge, styles.badgeMeasuring]}>MEASURING PULSE...</Text>
          ) : heartRate ? (
            <Text style={[styles.badge, styles.badgeSuccess]}>ACTIVE: {heartRate} BPM</Text>
          ) : lastHeartRate ? (
            <Text style={[styles.badge, styles.badgeSuccess]}>LAST: {lastHeartRate} BPM</Text>
          ) : (
            <Text style={[styles.badge, styles.badgeIdle]}>STANDBY</Text>
          )}
        </View>

        <View style={styles.metricsGrid}>
          {/* Heart Rate Tile */}
          <View style={styles.metricTile}>
            <Text style={styles.metricTileLabel}>HEART RATE</Text>
            <View style={styles.metricValueRow}>
              <Text style={styles.metricHeartIcon}>❤️</Text>
              <Text style={styles.metricMainValue}>
                {heartRate ? `${heartRate}` : lastHeartRate ? `${lastHeartRate}` : '--'}
              </Text>
              <Text style={styles.metricUnit}>BPM</Text>
            </View>
            <Text style={styles.metricSubText}>
              {isMeasuringHeartRate
                ? 'Sensor active on wrist...'
                : lastHeartRate
                ? `Last: ${lastHeartRate} BPM (${lastHeartRateTimestamp || 'recent'})`
                : 'Tap measure or sync below'}
            </Text>
          </View>

          {/* Daily Steps Tile */}
          <View style={styles.metricTile}>
            <Text style={styles.metricTileLabel}>DAILY ACTIVITY</Text>
            <View style={styles.metricValueRow}>
              <Text style={styles.metricStepIcon}>👣</Text>
              <Text style={styles.metricMainValue}>
                {stepCount !== null ? stepCount.toLocaleString() : '--'}
              </Text>
              <Text style={styles.metricUnit}>steps</Text>
            </View>
            <Text style={styles.metricSubText}>
              {distanceMeters !== null
                ? `${(distanceMeters / 1000).toFixed(2)} km  •  ${calories ?? 0} kcal`
                : calories
                ? `${calories} kcal burned`
                : 'Auto-synced from watch'}
            </Text>
          </View>
        </View>

        {/* Measure / Stop Button */}
        <View style={styles.healthBtnRow}>
          {isMeasuringHeartRate ? (
            <TouchableOpacity
              style={[styles.healthBtn, styles.btnStopHeartRate]}
              onPress={stopHeartRateMeasure}
            >
              <Text style={styles.healthBtnText}>⏹ Stop Measurement</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.healthBtnGroup}>
              <TouchableOpacity
                style={[
                  styles.healthBtn,
                  styles.btnStartHeartRate,
                  (!isConnected || !isSubscribed) && styles.btnDisabled,
                ]}
                disabled={!isConnected || !isSubscribed}
                onPress={() => startHeartRateMeasure('single')}
              >
                <Text style={styles.healthBtnText}>
                  {!isConnected ? 'Offline' : '❤️ Measure'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.healthBtn,
                  styles.btnDynamicHeartRate,
                  (!isConnected || !isSubscribed) && styles.btnDisabled,
                ]}
                disabled={!isConnected || !isSubscribed}
                onPress={() => startHeartRateMeasure('dynamic')}
              >
                <Text style={styles.healthBtnText}>
                  {!isConnected ? 'Offline' : '⚡ Dynamic'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.healthBtn,
                  styles.btnSyncHeartRate,
                  (!isConnected || !isSubscribed) && styles.btnDisabled,
                ]}
                disabled={!isConnected || !isSubscribed}
                onPress={queryHistoryHeartRate}
              >
                <Text style={styles.healthBtnText}>
                  {!isConnected ? 'Offline' : '🔄 Sync Last'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* 3. Send Test Command & Test Result Area */}
      <View style={styles.testSectionCard}>
        <View style={styles.testHeaderRow}>
          <Text style={styles.sectionTitle}>Command Test (FF02 → FF03)</Text>
          {renderStatusBadge(testStatus)}
        </View>

        <TouchableOpacity
          style={[styles.mainBtn, !canSendTest && styles.btnDisabled]}
          disabled={!canSendTest}
          onPress={sendTestCommand}
        >
          <Text style={styles.mainBtnText}>
            {isWaiting
              ? 'Waiting for FF03 Response (5s)...'
              : `Send Test Command [${bytesToHex(TEST_COMMAND_BYTES)}]`}
          </Text>
        </TouchableOpacity>

        <Text style={styles.testMessageText}>{testMessage}</Text>

        {/* Confirmed Response Box (Persists even when newer notifications arrive) */}
        {confirmedResponse && (
          <View style={styles.confirmedBox}>
            <View style={styles.confirmedHeader}>
              <Text style={styles.confirmedTitle}>★ Confirmed Device Response</Text>
              <Text style={styles.confirmedTime}>{confirmedResponse.timestamp}</Text>
            </View>
            <Text style={styles.confirmedLabel}>{confirmedResponse.decodedText}</Text>
            <Text style={styles.confirmedHex}>Raw Hex: {confirmedResponse.rawHex}</Text>
          </View>
        )}
      </View>

      {/* 4. Scanner Controls & Device List */}
      <View style={styles.scannerHeaderRow}>
        <Text style={styles.sectionTitle}>
          Discovered Devices ({devices.length})
        </Text>
        <TouchableOpacity
          style={[styles.scanBtn, isScanning && styles.scanBtnActive]}
          onPress={isScanning ? stopScan : startScan}
        >
          <Text style={styles.scanBtnText}>
            {isScanning ? '⏹ Stop Scan' : '🔍 Scan'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Device List (Height bounded) */}
      <View style={styles.deviceListContainer}>
        {sortedDevices.length === 0 ? (
          <View style={styles.emptyDeviceBox}>
            <Text style={styles.emptyText}>
              {isScanning
                ? 'Scanning for BLE devices nearby...'
                : 'No devices found. Tap "Scan" to discover.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={sortedDevices}
            keyExtractor={(item) => item.id}
            renderItem={renderDeviceItem}
            style={styles.deviceFlatList}
            initialNumToRender={5}
          />
        )}
      </View>

      {/* 5. Scrollable Event Log */}
      <View style={styles.logHeaderRow}>
        <Text style={styles.sectionTitle}>Event Log ({logs.length})</Text>
        <View style={styles.logActionButtons}>
          <TouchableOpacity style={styles.logActionBtn} onPress={copyLogs}>
            <Text style={styles.logActionText}>📋 Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logActionBtn} onPress={clearLogs}>
            <Text style={styles.logActionText}>🗑 Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.logContainer}>
        {logs.length === 0 ? (
          <Text style={styles.emptyLogText}>Logs will appear here...</Text>
        ) : (
          <FlatList
            data={logs}
            keyExtractor={(item) => item.id}
            renderItem={renderLogItem}
            inverted={false}
            style={styles.logFlatList}
            initialNumToRender={15}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1120',
  },
  header: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  reminderText: {
    fontSize: 11,
    color: '#fbbf24',
    marginTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 16,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 12,
    color: '#94a3b8',
  },
  statusGood: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10b981',
  },
  statusBad: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ef4444',
  },
  statusNeutral: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  retryBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  retryBtnText: {
    fontSize: 11,
    color: '#f8fafc',
  },
  permMessage: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: '#0f172a',
    marginHorizontal: 10,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  connStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  connCol: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 10,
    color: '#64748b',
    textTransform: 'uppercase',
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f1f5f9',
    marginTop: 1,
  },
  testSectionCard: {
    backgroundColor: '#131e36',
    marginHorizontal: 10,
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  healthSectionCard: {
    backgroundColor: '#1a1029',
    marginHorizontal: 10,
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#db2777',
  },
  healthHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeMeasuring: {
    backgroundColor: '#e11d48',
    color: '#ffffff',
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  metricTile: {
    flex: 1,
    backgroundColor: '#231438',
    padding: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#4a2870',
  },
  metricTileLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#c084fc',
    textTransform: 'uppercase',
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  metricHeartIcon: {
    fontSize: 15,
    marginRight: 4,
  },
  metricStepIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  metricMainValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
  },
  metricUnit: {
    fontSize: 11,
    fontWeight: '600',
    color: '#cbd5e1',
    marginLeft: 4,
  },
  metricSubText: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 3,
  },
  healthBtnRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  healthBtnGroup: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  healthBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnStartHeartRate: {
    backgroundColor: '#e11d48',
  },
  btnDynamicHeartRate: {
    backgroundColor: '#7c3aed',
  },
  btnSyncHeartRate: {
    backgroundColor: '#0284c7',
  },
  btnStopHeartRate: {
    backgroundColor: '#475569',
  },
  healthBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  testHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  badge: {
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  badgeIdle: {
    backgroundColor: '#334155',
    color: '#cbd5e1',
  },
  badgeWaiting: {
    backgroundColor: '#d97706',
    color: '#ffffff',
  },
  badgeSuccess: {
    backgroundColor: '#10b981',
    color: '#ffffff',
  },
  badgeTimeout: {
    backgroundColor: '#b91c1c',
    color: '#ffffff',
  },
  badgeError: {
    backgroundColor: '#dc2626',
    color: '#ffffff',
  },
  mainBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnDisabled: {
    backgroundColor: '#334155',
    opacity: 0.6,
  },
  mainBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  testMessageText: {
    fontSize: 11,
    color: '#cbd5e1',
    marginTop: 6,
  },
  confirmedBox: {
    backgroundColor: '#064e3b',
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#059669',
  },
  confirmedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confirmedTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6ee7b7',
  },
  confirmedTime: {
    fontSize: 10,
    color: '#a7f3d0',
  },
  confirmedLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 2,
  },
  confirmedHex: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#d1fae5',
    marginTop: 1,
  },
  scannerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
  },
  scanBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 4,
  },
  scanBtnActive: {
    backgroundColor: '#e11d48',
  },
  scanBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  deviceListContainer: {
    maxHeight: 130,
    marginHorizontal: 10,
  },
  emptyDeviceBox: {
    backgroundColor: '#0f172a',
    padding: 14,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  emptyText: {
    fontSize: 11,
    color: '#64748b',
  },
  deviceFlatList: {
    backgroundColor: '#0f172a',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  deviceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  targetDeviceCard: {
    backgroundColor: '#1e1b4b',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deviceName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f8fafc',
  },
  verifiedTag: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fbbf24',
    backgroundColor: '#78350f',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  deviceId: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#94a3b8',
  },
  deviceRssi: {
    fontSize: 9,
    color: '#64748b',
  },
  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  btnConnect: {
    backgroundColor: '#16a34a',
  },
  btnDisconnect: {
    backgroundColor: '#dc2626',
  },
  btnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  logHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  logActionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  logActionBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  logActionText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#030712',
    marginHorizontal: 10,
    marginBottom: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 6,
  },
  emptyLogText: {
    fontSize: 11,
    color: '#475569',
    textAlign: 'center',
    marginTop: 20,
  },
  logFlatList: {
    flex: 1,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 3,
  },
  logTime: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: '#64748b',
    marginRight: 6,
    marginTop: 1,
  },
  logType: {
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
    marginRight: 6,
    marginTop: 1,
  },
  logMsg: {
    fontSize: 10,
    fontFamily: 'monospace',
    flex: 1,
    color: '#e2e8f0',
  },
  logInfo: {
    color: '#94a3b8',
  },
  logTx: {
    color: '#38bdf8',
  },
  logRx: {
    color: '#c084fc',
  },
  logSuccess: {
    color: '#34d399',
    fontWeight: '700',
  },
  logError: {
    color: '#f87171',
    fontWeight: '700',
  },
  logWarn: {
    color: '#fbbf24',
  },
});
