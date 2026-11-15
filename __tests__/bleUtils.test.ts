import {
  areBytesEqual,
  areUuidsEqual,
  bytesToHex,
  decodeAscii,
  normalizeUuid,
  parseActivityPacket,
  parseHeartRatePacket,
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
  });
});
