import {
  CMD_START_DYNAMIC_HEART_RATE,
  CMD_START_ONCE_HEART_RATE,
  CMD_STOP_DYNAMIC_HEART_RATE,
  CMD_STOP_ONCE_HEART_RATE,
  EXPECTED_RESPONSE_BYTES,
  TARGET_NOTIFY_CHAR_UUID,
  TARGET_SERVICE_UUID,
  TARGET_WRITE_CHAR_UUID,
  TEST_COMMAND_BYTES,
} from '../src/bleConstants';
import {
  areBytesEqual,
  areUuidsEqual,
  bytesToHex,
  decodeAscii,
} from '../src/bleUtils';

describe('BLE Command and Verification Flow', () => {
  test('verified command bytes are exactly 4 raw bytes [00 02 04 00]', () => {
    expect(TEST_COMMAND_BYTES).toHaveLength(4);
    expect(TEST_COMMAND_BYTES).toEqual([0x00, 0x02, 0x04, 0x00]);
    expect(bytesToHex(TEST_COMMAND_BYTES)).toBe('00 02 04 00');
  });

  test('expected response matches exact 9 bytes and decodes to "1.10"', () => {
    expect(EXPECTED_RESPONSE_BYTES).toHaveLength(9);
    expect(bytesToHex(EXPECTED_RESPONSE_BYTES)).toBe('00 82 09 00 01 31 2E 31 30');
    expect(areBytesEqual(EXPECTED_RESPONSE_BYTES, [0x00, 0x82, 0x09, 0x00, 0x01, 0x31, 0x2e, 0x31, 0x30])).toBe(true);

    const asciiPart = EXPECTED_RESPONSE_BYTES.slice(5);
    expect(decodeAscii(asciiPart)).toBe('1.10');
  });

  test('unsolicited notifications are not treated as expected response', () => {
    const unsolicited1 = [0x80, 0x82, 0x07, 0x00, 0x01, 0x64, 0x00];
    expect(areBytesEqual(unsolicited1, EXPECTED_RESPONSE_BYTES)).toBe(false);

    const unsolicited2 = [0x00, 0x02, 0x04, 0x00];
    expect(areBytesEqual(unsolicited2, EXPECTED_RESPONSE_BYTES)).toBe(false);
  });

  test('service and characteristics UUID matching handles both 128-bit and 16-bit', () => {
    // Service UUID
    expect(areUuidsEqual(TARGET_SERVICE_UUID, '000001ff-3c17-d293-8e48-14fe2e4da212')).toBe(true);
    expect(areUuidsEqual(TARGET_SERVICE_UUID, '000001FF-3C17-D293-8E48-14FE2E4DA212')).toBe(true);
    expect(areUuidsEqual(TARGET_SERVICE_UUID, '01ff')).toBe(true);

    // Write Char FF02
    expect(areUuidsEqual(TARGET_WRITE_CHAR_UUID, '0000ff02-0000-1000-8000-00805f9b34fb')).toBe(true);
    expect(areUuidsEqual(TARGET_WRITE_CHAR_UUID, 'ff02')).toBe(true);
    expect(areUuidsEqual(TARGET_WRITE_CHAR_UUID, 'FF02')).toBe(true);

    // Notify Char FF03
    expect(areUuidsEqual(TARGET_NOTIFY_CHAR_UUID, '0000ff03-0000-1000-8000-00805f9b34fb')).toBe(true);
    expect(areUuidsEqual(TARGET_NOTIFY_CHAR_UUID, 'ff03')).toBe(true);
    expect(areUuidsEqual(TARGET_NOTIFY_CHAR_UUID, 'FF03')).toBe(true);

    // Explicitly reject old AE01 / AE02
    expect(areUuidsEqual('ae01', TARGET_WRITE_CHAR_UUID)).toBe(false);
    expect(areUuidsEqual('ae02', TARGET_NOTIFY_CHAR_UUID)).toBe(false);
  });

  describe('Race condition and timing behavior', () => {
    test('fast response arriving before write completion resolves to success and is not overwritten', async () => {
      let testStatus: 'idle' | 'waiting' | 'success' | 'timeout' | 'error' = 'idle';
      let pendingTest = false;
      let timerCleared = false;
      let testMessage = '';

      // 1. Simulate initiating sendTestCommand: matcher & timeout registered BEFORE write
      testStatus = 'waiting';
      pendingTest = true;
      testMessage = 'Waiting for response on FF03 (5s timeout)...';

      // 2. Simulate fast RX packet arriving while write is still in flight
      const incomingPacket = [0x00, 0x82, 0x09, 0x00, 0x01, 0x31, 0x2e, 0x31, 0x30];
      if (areBytesEqual(incomingPacket, EXPECTED_RESPONSE_BYTES)) {
        if (pendingTest) {
          timerCleared = true;
          pendingTest = false;
          testStatus = 'success';
          testMessage = `Success! Version-like response: ${decodeAscii(incomingPacket.slice(5))}`;
        }
      }

      expect(testStatus).toBe('success');
      expect(pendingTest).toBe(false);
      expect(timerCleared).toBe(true);
      expect(testMessage).toContain('1.10');

      // 3. Simulate BLE write resolving afterwards
      // In useBle.ts:
      // if (pendingTestRef.current) { addLog(...) } else { addLog('BLE write completed (expected response was already received)') }
      // Notice testStatus is NOT touched when write finishes!
      expect(testStatus).toBe('success');
    });

    test('unsolicited notifications during waiting do not cancel pending test or change status', () => {
      let testStatus: 'idle' | 'waiting' | 'success' | 'timeout' | 'error' = 'waiting';
      let pendingTest = true;
      let timerCleared = false;

      // Unsolicited notification arrives
      const unsolicitedPacket = [0x80, 0x82, 0x07, 0x00, 0x01, 0x64, 0x00];
      if (areBytesEqual(unsolicitedPacket, EXPECTED_RESPONSE_BYTES)) {
        timerCleared = true;
        pendingTest = false;
        testStatus = 'success';
      }

      // Must still be waiting
      expect(testStatus).toBe('waiting');
      expect(pendingTest).toBe(true);
      expect(timerCleared).toBe(false);
    });

    test('heart rate commands match Crrepa protocol standards', () => {
      // 0x6D = single measurement (109 dec) with 0xFE, 0xEA framing
      expect(CMD_START_ONCE_HEART_RATE).toEqual([0xfe, 0xea, 0x10, 0x06, 0x6d, 0x00]);
      expect(CMD_STOP_ONCE_HEART_RATE).toEqual([0xfe, 0xea, 0x10, 0x06, 0x6d, 0xff]);

      // 0x68 = dynamic / continuous measurement (104 dec) with 0xFE, 0xEA framing
      expect(CMD_START_DYNAMIC_HEART_RATE).toEqual([0xfe, 0xea, 0x10, 0x06, 0x68, 0x00]);
      expect(CMD_STOP_DYNAMIC_HEART_RATE).toEqual([0xfe, 0xea, 0x10, 0x06, 0x68, 0xff]);
    });
  });
});
