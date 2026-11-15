export interface BleDevice {
  id: string; // MAC address on Android
  name: string | null;
  rssi?: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';
export type SubscriptionStatus = 'not_subscribed' | 'subscribing' | 'subscribed';
export type TestStatus = 'idle' | 'waiting' | 'success' | 'timeout' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'tx' | 'rx' | 'error' | 'warn' | 'success';
  message: string;
  rawBytes?: string;
}

export interface ConfirmedResponse {
  rawHex: string;
  decodedText: string;
  timestamp: string;
}

export interface VerifiedEndpoints {
  serviceUuid: string;
  writeCharUuid: string;
  notifyCharUuid: string;
}

export interface HealthMetrics {
  heartRate: number | null;
  lastHeartRate: number | null;
  isMeasuringHeartRate: boolean;
  stepCount: number | null;
  distanceMeters: number | null;
  calories: number | null;
  activeMinutes: number | null;
  lastHeartRateTimestamp: string | null;
}
