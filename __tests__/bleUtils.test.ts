import {
  areBytesEqual,
  areUuidsEqual,
  bytesToHex,
  decodeAscii,
  normalizeUuid,
  parseActivityPacket,
  parseBatteryPacket,
  parseHeartRatePacket,
  parseSpO2Packet,
} from '../src/bleUtils';
import {
  EXPECTED_RESPONSE_BYTES,
  TARGET_NOTIFY_CHAR_UUID,
  TARGET_SERVICE_UUID,
  TARGET_WRITE_CHAR_UUID,
  TEST_COMMAND_BYTES,
} from '../src/bleConstants';

describe('bleUtils', () => {
  test('normalizeUuid removes hyphens and lowercases', () => {
    expect(normalizeUuid('000001FF-3C17-D293-8E48-14FE2E4DA212')).toBe(
      '000001ff3c17d2938e4814fe2e4da212'
    );
    expect(normalizeUuid('FF02')).toBe('ff02');
  });

  test('areUuidsEqual matches exact, case-insensitive, and 16-bit to 128-bit', () => {
    expect(areUuidsEqual(TARGET_SERVICE_UUID, '000001ff-3c17-d293-8e48-14fe2e4da212')).toBe(true);
    expect(areUuidsEqual(TARGET_SERVICE_UUID, '000001FF-3C17-D293-8E48-14FE2E4DA212')).toBe(true);
    expect(areUuidsEqual('ff02', TARGET_WRITE_CHAR_UUID)).toBe(true);
    expect(areUuidsEqual('0000ff02-0000-1000-8000-00805f9b34fb', 'FF02')).toBe(true);
    expect(areUuidsEqual('ff03', TARGET_NOTIFY_CHAR_UUID)).toBe(true);
    expect(areUuidsEqual('ae01', TARGET_WRITE_CHAR_UUID)).toBe(false);
  });

  test('bytesToHex formats numbers as uppercase space-separated hex', () => {
    expect(bytesToHex(TEST_COMMAND_BYTES)).toBe('00 02 04 00');
    expect(bytesToHex(EXPECTED_RESPONSE_BYTES)).toBe('00 82 09 00 01 31 2E 31 30');
    expect(bytesToHex([0x80, 0x82, 0x07, 0x00, 0x01, 0x64, 0x00])).toBe(
      '80 82 07 00 01 64 00'
    );
  });

  test('areBytesEqual matches exact byte sequences', () => {
    expect(areBytesEqual([0, 2, 4, 0], [0x00, 0x02, 0x04, 0x00])).toBe(true);
    expect(areBytesEqual(EXPECTED_RESPONSE_BYTES, [0x00, 0x82, 0x09, 0x00, 0x01, 0x31, 0x2e, 0x31, 0x30])).toBe(true);
    expect(areBytesEqual([0x80, 0x82, 0x07, 0x00, 0x01, 0x64, 0x00], EXPECTED_RESPONSE_BYTES)).toBe(false);
  });

  test('decodeAscii decodes trailing bytes to "1.10"', () => {
    const trailingBytes = EXPECTED_RESPONSE_BYTES.slice(5);
    expect(decodeAscii(trailingBytes)).toBe('1.10');
  });

  test('parseActivityPacket correctly decodes real watch step packet (3,885 steps)', () => {
    // Real packet captured from watch: 80 80 0D 00 01 2D 0F 00 00 B4 0A 9D 00
    const rawPacket = [0x80, 0x80, 0x0d, 0x00, 0x01, 0x2d, 0x0f, 0x00, 0x00, 0xb4, 0x0a, 0x9d, 0x00];
    const activity = parseActivityPacket(rawPacket);

    expect(activity).not.toBeNull();
    expect(activity?.steps).toBe(3885);
    expect(activity?.distance).toBe(2740);
    expect(activity?.calories).toBe(157);
  });

  test('parseHeartRatePacket decodes Crrepa heart rate packets', () => {
    // Dynamic measurement: byte[4] = 0x68, bpm = 78 at byte[6]
    const dynamicPacket = [0x80, 0x00, 0x08, 0x00, 0x68, 0x00, 78, 0x00];
    const resDynamic = parseHeartRatePacket(dynamicPacket);
    expect(resDynamic).toEqual({ bpm: 78, isSingleComplete: false });

    // Single measurement complete: byte[4] = 0x6D, bpm = 72 at byte[6]
    const singlePacket = [0x00, 0x80, 0x08, 0x00, 0x6d, 0x00, 72, 0x00];
    const resSingle = parseHeartRatePacket(singlePacket);
    expect(resSingle).toEqual({ bpm: 72, isSingleComplete: true });

    // Official 0xFE, 0xEA framed measurement packet: [FE, EA, 10, 06, 6D, 75]
    const framedPacket = [0xfe, 0xea, 0x10, 0x06, 0x6d, 75];
    const resFramed = parseHeartRatePacket(framedPacket);
    expect(resFramed).toEqual({ bpm: 75, isSingleComplete: true });

    // History heart rate packet (0x35) with recorded samples
    const historyPacket = [0xfe, 0xea, 0x10, 0x09, 0x35, 76, 0x00, 82, 0x00];
    const resHistory = parseHeartRatePacket(historyPacket);
    expect(resHistory).toEqual({ bpm: 82, isSingleComplete: true });

    // Unframed History heart rate packet
    const rawHistoryPacket = [0x35, 0x00, 71, 0x00, 79];
    const resRawHistory = parseHeartRatePacket(rawHistoryPacket);
    expect(resRawHistory).toEqual({ bpm: 79, isSingleComplete: true });

    // Standard BLE SIG 0x2A37 packet (flags=0, bpm=84)
    const sigPacket = [0x00, 84];
    const resSig = parseHeartRatePacket(sigPacket, '00002a37-0000-1000-8000-00805f9b34fb');
    expect(resSig).toEqual({ bpm: 84 });

    // Zeblaze Btalk 4 Pro single measurement HR packet: 80 84 08 00 02 00 00 5D (93 BPM complete)
    const btalk4ProHrPacket = [0x80, 0x84, 0x08, 0x00, 0x02, 0x00, 0x00, 0x5d];
    const resBtalkHr = parseHeartRatePacket(btalk4ProHrPacket);
    expect(resBtalkHr).toEqual({ bpm: 93, isSingleComplete: true });

    // Zeblaze Btalk 4 Pro measuring in progress: 80 84 08 00 01 00 48 00 (72 BPM measuring)
    const btalk4ProHrMeasuring = [0x80, 0x84, 0x08, 0x00, 0x01, 0x00, 0x48, 0x00];
    const resBtalkMeasuring = parseHeartRatePacket(btalk4ProHrMeasuring);
    expect(resBtalkMeasuring).toEqual({ bpm: 72, isSingleComplete: false });
  });

  test('parseSpO2Packet strictly isolates SpO2 from Heart Rate and handles completion packets', () => {
    // 1. Zeblaze Btalk 4 Pro SpO2 completion packet: 80 84 08 00 02 02 00 62 (98% SpO2)
    // Note: Byte 4 === 0x02 and Byte 5 === 0x02 indicates SpO2
    const validSpO2Packet = [0x80, 0x84, 0x08, 0x00, 0x02, 0x02, 0x00, 0x62];
    const resSpO2 = parseSpO2Packet(validSpO2Packet);
    expect(resSpO2).toEqual({ spo2: 98, isComplete: true });

    // 1b. Zeblaze Btalk 4 Pro SpO2 measuring in progress (Byte 4 === 0x01, Byte 5 === 0x02, 97% SpO2)
    const measuringSpO2Packet = [0x80, 0x84, 0x08, 0x00, 0x01, 0x02, 0x61, 0x00];
    const resMeasuringSpO2 = parseSpO2Packet(measuringSpO2Packet);
    expect(resMeasuringSpO2).toEqual({ spo2: 97, isComplete: false });

    // 2. CRITICAL BUG FIX TEST: Heart Rate status packet: 80 84 08 00 02 00 00 5D (93 BPM)
    // Byte 5 is 0x00 (Heart rate mode, NOT SpO2). Must return null!
    const hrStatusPacket = [0x80, 0x84, 0x08, 0x00, 0x02, 0x00, 0x00, 0x5d];
    expect(parseSpO2Packet(hrStatusPacket)).toBeNull();

    // 3. Battery telemetry packet: 80 82 07 00 01 4A 00 (74% Battery)
    // Must return null for both SpO2 and Heart Rate!
    const batteryPacket = [0x80, 0x82, 0x07, 0x00, 0x01, 0x4a, 0x00];
    expect(parseSpO2Packet(batteryPacket)).toBeNull();
    expect(parseHeartRatePacket(batteryPacket)).toBeNull();
    expect(parseBatteryPacket(batteryPacket)).toEqual({ battery: 74 });

    // 4. Framed V2 SpO2 live packet: [FE, EA, 10, 06, 6B, 97]
    const framedLiveSpO2 = [0xfe, 0xea, 0x10, 0x06, 0x6b, 97];
    expect(parseSpO2Packet(framedLiveSpO2)).toEqual({ spo2: 97, isComplete: false });

    // 5. Framed V2 SpO2 complete packet: [FE, EA, 10, 06, EB, 99]
    const framedCompleteSpO2 = [0xfe, 0xea, 0x10, 0x06, 0xeb, 99];
    expect(parseSpO2Packet(framedCompleteSpO2)).toEqual({ spo2: 99, isComplete: true });

    // 6. Unframed V1 SpO2 complete packet: [0xEB, 96]
    expect(parseSpO2Packet([0xeb, 96])).toEqual({ spo2: 96, isComplete: true });

    // 7. Invalid/empty bytes
    expect(parseSpO2Packet([])).toBeNull();
    expect(parseSpO2Packet([0x00, 0x02, 0x04, 0x00])).toBeNull();
  });

  test('parseActivityPacket correctly decodes WeChat Sports 9-byte packet and 0x59 interval category steps', () => {
    // WeChat Sports FEE1 characteristic: 9-byte packet [steps 3B LE] [calories 3B LE] [distance 3B LE]
    // Steps: 2,200 (0x000898) | Calories: 80 kcal (0x000050) | Distance: 1,200m (0x0004B0)
    const fee1Packet = [0x98, 0x08, 0x00, 0x50, 0x00, 0x00, 0xb0, 0x04, 0x00];
    const actFee1 = parseActivityPacket(fee1Packet);
    expect(actFee1).toEqual({
      steps: 2200,
      distance: 1200,
      calories: 80,
      activeMinutes: 0,
    });

    // Framed 0x59 Category Steps Today packet with 3 interval windows: 100 + 200 + 50 = 350 steps
    const framed59Packet = [0xfe, 0xea, 0x10, 0x0c, 0x59, 0x00, 100, 0, 200, 0, 50, 0];
    const act59 = parseActivityPacket(framed59Packet);
    expect(act59).not.toBeNull();
    expect(act59?.steps).toBe(350);
    expect(act59?.distance).toBe(Math.round(350 * 0.75));
    expect(act59?.calories).toBe(Math.round(350 * 0.04));

    // Framed 0x07 Realtime Activity packet: 3,885 steps
    const framed07Packet = [0xfe, 0xea, 0x10, 0x0d, 0x07, 0x2d, 0x0f, 0x00, 0x00, 0xb4, 0x0a, 0x9d, 0x00];
    const act07 = parseActivityPacket(framed07Packet);
    expect(act07).not.toBeNull();
    expect(act07?.steps).toBe(3885);
    expect(act07?.distance).toBe(2740);
    expect(act07?.calories).toBe(157);

    // Zeblaze StepDataParser 108-byte sync buffer:
    // 96 bytes interval details, then bytes 96..99: 4,500 steps (0x00001194), 100..103: 180 kcal, 104..107: 3,200m
    const stepDataBuffer = new Array(108).fill(0);
    // Steps = 4500 (0x1194)
    stepDataBuffer[96] = 0x94;
    stepDataBuffer[97] = 0x11;
    // Calories = 180 (0x00B4)
    stepDataBuffer[100] = 0xb4;
    // Distance = 3200 (0x0C80)
    stepDataBuffer[104] = 0x80;
    stepDataBuffer[105] = 0x0c;
    const act108 = parseActivityPacket(stepDataBuffer);
    expect(act108).not.toBeNull();
    expect(act108?.steps).toBe(4500);
    expect(act108?.calories).toBe(180);
    expect(act108?.distance).toBe(3200);
  });
});
