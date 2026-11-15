/* eslint-disable no-bitwise */
/**
 * Normalizes UUID by stripping hyphens and colons and converting to lowercase.
 */
export function normalizeUuid(uuid: string): string {
  if (!uuid) {
    return '';
  }
  return uuid.replace(/[-:]/g, '').toLowerCase();
}

/**
 * Checks whether two UUIDs match, accounting for 16-bit vs 128-bit representations
 * and standard Bluetooth SIG base UUIDs.
 */
export function areUuidsEqual(uuid1: string, uuid2: string): boolean {
  if (!uuid1 || !uuid2) {
    return false;
  }
  const norm1 = normalizeUuid(uuid1);
  const norm2 = normalizeUuid(uuid2);

  if (norm1 === norm2) {
    return true;
  }

  // Standard 16-bit vs 128-bit comparison (e.g. "ff02" vs "0000ff02-0000-1000-8000-00805f9b34fb")
  if (norm1.length === 4 && norm2.length === 32) {
    return norm2.startsWith(`0000${norm1}`);
  }
  if (norm2.length === 4 && norm1.length === 32) {
    return norm1.startsWith(`0000${norm2}`);
  }

  // Substring fallback for custom 128-bit matching
  if (norm1.length === 32 && norm2.length === 32) {
    return norm1 === norm2;
  }

  return false;
}

/**
 * Formats a byte array as uppercase space-separated hexadecimal string.
 * Example: [0, 2, 4, 0] -> "00 02 04 00"
 */
export function bytesToHex(bytes: number[]): string {
  if (!bytes || bytes.length === 0) {
    return '';
  }
  return bytes
    .map((b) => (b & 0xff).toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

/**
 * Compares two byte arrays for exact equality.
 */
export function areBytesEqual(a: number[], b: number[]): boolean {
  if (!a || !b) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if ((a[i] & 0xff) !== (b[i] & 0xff)) {
      return false;
    }
  }
  return true;
}

/**
 * Decodes ASCII printable bytes from an array slice.
 */
export function decodeAscii(bytes: number[]): string {
  if (!bytes || bytes.length === 0) {
    return '';
  }
  return bytes
    .map((b) => {
      const code = b & 0xff;
      return code >= 32 && code <= 126 ? String.fromCharCode(code) : '.';
    })
    .join('');
}

/**
 * Parses daily activity packet from Zeblaze / Crrepa watch.
 * Packet structure: 80 80 0D 00 01 [steps 4B LE] [distance meters 2B LE] [calories kcal 2B LE]
 */
export function parseActivityPacket(bytes: number[]): {
  steps: number;
  distance: number;
  calories: number;
  activeMinutes: number;
} | null {
  if (!bytes || bytes.length < 9) {
    return null;
  }
  const b0 = bytes[0] & 0xff;
  const b1 = bytes[1] & 0xff;

  // Header 80 80
  if (b0 === 0x80 && b1 === 0x80) {
    // Bytes 5-8: Steps count (4 bytes Little Endian)
    const steps =
      (bytes[5] & 0xff) |
      ((bytes[6] & 0xff) << 8) |
      ((bytes[7] & 0xff) << 16) |
      ((bytes[8] & 0xff) << 24);

    // Bytes 9-10: Distance in meters (e.g. 2740 = 2.74 km)
    const distance =
      bytes.length >= 11
        ? (bytes[9] & 0xff) | ((bytes[10] & 0xff) << 8)
        : 0;

    // Bytes 11-12: Burned energy in kcal (e.g. 157 kcal)
    const calories =
      bytes.length >= 13
        ? (bytes[11] & 0xff) | ((bytes[12] & 0xff) << 8)
        : 0;

    // Bytes 13-14: Active minutes if present
    const activeMinutes =
      bytes.length >= 15
        ? (bytes[13] & 0xff) | ((bytes[14] & 0xff) << 8)
        : 0;

    return { steps, distance, calories, activeMinutes };
  }

  return null;
}

/**
 * Parses real-time heart rate notifications (Crrepa BLE protocol or BLE SIG 0x2A37).
 */
export function parseHeartRatePacket(
  bytes: number[],
  characteristicUuid?: string
): { bpm: number; isSingleComplete?: boolean } | null {
  if (!bytes || bytes.length < 2) {
    return null;
  }

  // 1. Bluetooth SIG 0x2A37 Heart Rate Measurement Characteristic
  if (characteristicUuid && areUuidsEqual(characteristicUuid, '2a37')) {
    const flags = bytes[0] & 0xff;
    const is16Bit = (flags & 0x01) === 1;
    if (is16Bit && bytes.length >= 3) {
      const bpm = (bytes[1] & 0xff) | ((bytes[2] & 0xff) << 8);
      return { bpm };
    }
    const bpm = bytes[1] & 0xff;
    return { bpm };
  }

  // 2. Crrepa Protocol via FF03:
  // Case A: Official 0xFE, 0xEA framing (bytes 0, 1 = 0xFE, 0xEA; byte 4 = CMD)
  if (bytes.length >= 6 && (bytes[0] & 0xff) === 0xfe && (bytes[1] & 0xff) === 0xea) {
    const cmdId = bytes[4] & 0xff;
    if (cmdId === 0x68 || cmdId === 0x6d || cmdId === 0xe8 || cmdId === 0xed) {
      // In ui3.t0 / CR3.h, payload starts at index 5 and first byte is BPM
      let bpm = bytes[5] & 0xff;
      if (bpm === 0 && bytes.length >= 7) {
        bpm = bytes[6] & 0xff;
      }
      if (bpm > 0) {
        return {
          bpm,
          isSingleComplete: cmdId === 0x6d || cmdId === 0xed,
        };
      }
    }

    if (cmdId === 0x35 || cmdId === 0x36) {
      // History heart rate packet: contains multiple records of [BPM (1B), timestamp (4B LE)]
      // Scan for the last non-zero BPM in the payload
      let lastBpm = 0;
      for (let i = 5; i < bytes.length; i++) {
        const val = bytes[i] & 0xff;
        if (val >= 40 && val <= 220) {
          lastBpm = val;
        }
      }
      if (lastBpm > 0) {
        return {
          bpm: lastBpm,
          isSingleComplete: true,
        };
      }
    }
  }

  // Case B: byte[4] is command ID 0x68 (Dynamic), 0x6D (Single), 0xE8 (Dynamic Ack/Data), or 0xED (Single Ack/Data)
  if (bytes.length >= 7) {
    const cmdId = bytes[4] & 0xff;
    if (cmdId === 0x68 || cmdId === 0x6d || cmdId === 0xe8 || cmdId === 0xed) {
      const bpm = bytes[6] & 0xff;
      if (bpm > 0) {
        return {
          bpm,
          isSingleComplete: cmdId === 0x6d || cmdId === 0xed,
        };
      }
    }
  }

  // Case C: byte[1] is 0x68, 0x6D, 0xE8, or 0xED directly (or 0x80 header with 0xED/0xE8)
  if (bytes.length >= 5) {
    const cmdId = bytes[1] & 0xff;
    if (cmdId === 0x68 || cmdId === 0x6d || cmdId === 0xe8 || cmdId === 0xed) {
      // Find valid BPM value in payload
      for (let i = bytes.length - 1; i >= 4; i--) {
        const val = bytes[i] & 0xff;
        if (val >= 40 && val <= 220) {
          return {
            bpm: val,
            isSingleComplete: cmdId === 0x6d || cmdId === 0xed,
          };
        }
      }
    }
  }

  // Case D: byte[0] or byte[1] is 0x35 or 0x36 (Unframed Today / Yesterday History Heart Rate)
  const b0 = bytes[0] & 0xff;
  const b1 = bytes[1] & 0xff;
  if (b0 === 0x35 || b0 === 0x36 || b1 === 0x35 || b1 === 0x36) {
    let lastBpm = 0;
    for (let i = 2; i < bytes.length; i++) {
      const val = bytes[i] & 0xff;
      if (val >= 40 && val <= 220) {
        lastBpm = val;
      }
    }
    if (lastBpm > 0) {
      return {
        bpm: lastBpm,
        isSingleComplete: true,
      };
    }
  }

  return null;
}
