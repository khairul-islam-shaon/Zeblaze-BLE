// ============================================================================
// Verified BLE Specifications for Zeblaze Btalk 4 Pro
// ============================================================================

export const TARGET_DEVICE_NAME = 'BTALK 4 PRO';
export const OBSERVED_MAC_ADDRESS = 'FD:99:E2:BB:76:D0';

// Service & Characteristic UUIDs
// Note: UUID matching supports 128-bit and 16-bit forms
export const TARGET_SERVICE_UUID = '000001ff-3c17-d293-8e48-14fe2e4da212';
export const TARGET_WRITE_CHAR_UUID = '0000ff02-0000-1000-8000-00805f9b34fb';
export const TARGET_NOTIFY_CHAR_UUID = '0000ff03-0000-1000-8000-00805f9b34fb';

// Verified 4-byte command to send to FF02 (raw binary bytes: 00 02 04 00)
export const TEST_COMMAND_BYTES: number[] = [0x00, 0x02, 0x04, 0x00];

// Expected response bytes on FF03: 00 82 09 00 01 31 2E 31 30
// Trailing ASCII bytes [0x31, 0x2E, 0x31, 0x30] decode to "1.10"
export const EXPECTED_RESPONSE_BYTES: number[] = [
  0x00, 0x82, 0x09, 0x00, 0x01, 0x31, 0x2e, 0x31, 0x30,
];

// ============================================================================
// Heart Rate & Sensor Commands (Crrepa / MoYoung BLE Protocol)
// Header: 0xFE, 0xEA | MTU flag: 0x10 | Total Length: 0x06 | CMD | Payload: 0x00 (Start) / 0xFF (Stop)
// ============================================================================

// Single Heart Rate Measurement (Start / Stop)
export const CMD_START_ONCE_HEART_RATE: number[] = [0xfe, 0xea, 0x10, 0x06, 0x6d, 0x00];
export const CMD_START_ONCE_HEART_RATE_V1: number[] = [0x00, 0x6d, 0x05, 0x00, 0x01];
export const CMD_STOP_ONCE_HEART_RATE: number[] = [0xfe, 0xea, 0x10, 0x06, 0x6d, 0xff];
export const CMD_STOP_ONCE_HEART_RATE_V1: number[] = [0x00, 0x6d, 0x05, 0x00, 0x00];

// Dynamic / Continuous Heart Rate Measurement (Start / Stop)
export const CMD_START_DYNAMIC_HEART_RATE: number[] = [0xfe, 0xea, 0x10, 0x06, 0x68, 0x00];
export const CMD_START_DYNAMIC_HEART_RATE_V1: number[] = [0x00, 0x68, 0x05, 0x00, 0x01];
export const CMD_STOP_DYNAMIC_HEART_RATE: number[] = [0xfe, 0xea, 0x10, 0x06, 0x68, 0xff];
export const CMD_STOP_DYNAMIC_HEART_RATE_V1: number[] = [0x00, 0x68, 0x05, 0x00, 0x00];

// Query Today Heart Rate / History
export const CMD_QUERY_TODAY_HEART_RATE: number[] = [0xfe, 0xea, 0x10, 0x06, 0x35, 0x00];
export const CMD_QUERY_TODAY_HEART_RATE_V1: number[] = [0x00, 0x35, 0x04, 0x00];

// Query Steps & Activity (MoYoung V1 & V2: 0x33 is Daily Steps/Calories/Distance sync)
export const CMD_QUERY_STEPS_V1: number[] = [0x00, 0x33, 0x04, 0x00];
export const CMD_QUERY_STEPS_V2: number[] = [0xfe, 0xea, 0x10, 0x06, 0x33, 0x00];
export const CMD_QUERY_TODAY_ACTIVITY: number[] = [0x00, 0x33, 0x04, 0x00];
export const CMD_QUERY_REALTIME_ACTIVITY: number[] = [0x00, 0x07, 0x04, 0x00];
export const CMD_QUERY_ACTIVITY_V2: number[] = [0xfe, 0xea, 0x10, 0x06, 0x33, 0x00];

// Blood Oxygen (SpO2) Commands (MoYoung 0x6B start/stop, 0x37 query)
export const CMD_START_SPO2_V1: number[] = [0x00, 0x6b, 0x05, 0x00, 0x01];
export const CMD_START_SPO2_V2: number[] = [0xfe, 0xea, 0x10, 0x06, 0x6b, 0x00];
export const CMD_STOP_SPO2_V1: number[] = [0x00, 0x6b, 0x05, 0x00, 0x00];
export const CMD_STOP_SPO2_V2: number[] = [0xfe, 0xea, 0x10, 0x06, 0x6b, 0xff];
export const CMD_QUERY_TODAY_SPO2_V1: number[] = [0x00, 0x37, 0x04, 0x00];
export const CMD_QUERY_TODAY_SPO2_V2: number[] = [0xfe, 0xea, 0x10, 0x06, 0x37, 0x00];

// Standard Bluetooth SIG Heart Rate Measurement Characteristic UUID
export const BLE_SIG_HEART_RATE_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

// Response timeout (approx 5 seconds)
export const RESPONSE_TIMEOUT_MS = 5000;

// Scan duration in seconds
export const SCAN_DURATION_SECONDS = 8;

// Maximum log entries to retain in memory
export const MAX_LOG_ENTRIES = 300;
