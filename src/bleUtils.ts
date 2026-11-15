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
  if (!bytes || bytes.length < 3) {
    return null;
  }
  const b0 = bytes[0] & 0xff;
  const b1 = bytes[1] & 0xff;

  // 1. Direct 0x33 packet: [0x33, S0, S1, D0, D1, C0, C1, C2, C3, ...]
  if (b0 === 0x33 && bytes.length >= 7) {
    const steps = (bytes[1] & 0xff) | ((bytes[2] & 0xff) << 8);
    const distanceVal = (bytes[3] & 0xff) | ((bytes[4] & 0xff) << 8);
    const calories = (bytes[5] & 0xff) | ((bytes[6] & 0xff) << 8);
    const distance = distanceVal < 1000 ? distanceVal * 10 : distanceVal;
    return { steps, distance, calories, activeMinutes: 0 };
  }

  // 2. MoYoung V1 0xB3 response: [0x00/0x80, 0xB3, LEN, 0x00, 0x01, S0, S1, ...]
  if ((b1 === 0xb3 || b1 === 0x33) && bytes.length >= 6) {
    const offset = bytes.length >= 6 && (bytes[3] & 0xff) === 0x00 ? 5 : 2;
    let steps = (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8);
    if (bytes.length >= offset + 4 && (bytes[offset + 2] !== 0 || bytes[offset + 3] !== 0)) {
      const fullSteps =
        (bytes[offset] & 0xff) |
        ((bytes[offset + 1] & 0xff) << 8) |
        ((bytes[offset + 2] & 0xff) << 16) |
        ((bytes[offset + 3] & 0xff) << 24);
      if (fullSteps > 0 && fullSteps < 200000) {
        steps = fullSteps;
      }
    }
    const distanceOffset = offset + 2;
    const distanceVal =
      bytes.length >= distanceOffset + 2
        ? (bytes[distanceOffset] & 0xff) | ((bytes[distanceOffset + 1] & 0xff) << 8)
        : Math.round(steps * 0.75);
    const distance = distanceVal < 1000 ? distanceVal * 10 : distanceVal;

    const calOffset = distanceOffset + 2;
    const calories =
      bytes.length >= calOffset + 2
        ? (bytes[calOffset] & 0xff) | ((bytes[calOffset + 1] & 0xff) << 8)
        : Math.round(steps * 0.04);

    return { steps, distance, calories, activeMinutes: 0 };
  }

  // 3. MoYoung V2: [0xfe, 0xea, 0x10, LEN, 0x33/0x08, ...]
  if (b0 === 0xfe && b1 === 0xea && bytes.length >= 8) {
    const cmd = bytes[4] & 0xff;
    if (cmd === 0x33 || cmd === 0x08) {
      const offset = 5;
      const steps =
        (bytes[offset] & 0xff) |
        ((bytes[offset + 1] & 0xff) << 8) |
        ((bytes[offset + 2] & 0xff) << 16);
      const distance =
        bytes.length >= offset + 5
          ? (bytes[offset + 3] & 0xff) | ((bytes[offset + 4] & 0xff) << 8)
          : Math.round(steps * 0.75);
      const calories =
        bytes.length >= offset + 7
          ? (bytes[offset + 5] & 0xff) | ((bytes[offset + 6] & 0xff) << 8)
          : Math.round(steps * 0.04);
      return { steps, distance, calories, activeMinutes: 0 };
    }
  }

  // 4. WeChat Sports GATT characteristic (0000fea1): [flags, steps 3B/4B, calories 2B/3B, distance 2B/3B]
  if (bytes.length >= 8 && (b0 === 0x01 || b0 === 0x07)) {
    const steps =
      (bytes[1] & 0xff) |
      ((bytes[2] & 0xff) << 8) |
      ((bytes[3] & 0xff) << 16);
    if (steps > 0 && steps < 200000) {
      const calories =
        bytes.length >= 6 ? (bytes[4] & 0xff) | ((bytes[5] & 0xff) << 8) : Math.round(steps * 0.04);
      const distance =
        bytes.length >= 8 ? (bytes[6] & 0xff) | ((bytes[7] & 0xff) << 8) : Math.round(steps * 0.75);
      return { steps, distance, calories, activeMinutes: 0 };
    }
  }

  // 6. MoYoung / Crrepa Activity packet (e.g. 05 81 0A 00 [steps 2B] [distance 2B] [cal] [min]):
  if (
    bytes.length >= 8 &&
    ((b0 === 0x05 && b1 === 0x81) || b1 === 0x81 || (b0 === 0x80 && b1 === 0x81))
  ) {
    const offset = bytes.length >= 10 && bytes[3] === 0x00 ? 4 : 2;
    const steps = (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8);
    const distance =
      bytes.length >= offset + 4
        ? (bytes[offset + 2] & 0xff) | ((bytes[offset + 3] & 0xff) << 8)
        : Math.round(steps * 0.75);
    const calories =
      bytes.length >= offset + 5
        ? (bytes[offset + 4] & 0xff)
        : Math.round(steps * 0.04);
    const activeMinutes =
      bytes.length >= offset + 6 ? bytes[bytes.length - 1] & 0xff : 0;

    return { steps, distance, calories, activeMinutes };
  }

  // 7. Header 80 80 (Real Zeblaze Btalk 4 Pro activity packet: 80 80 0D 00 01 [steps 4B LE] [dist 2B LE] [cal 2B LE])
  if (b0 === 0x80 && b1 === 0x80) {
    const offset = 5;
    
    // Steps count
    let steps = 0;
    if (bytes.length >= offset + 4) {
      steps =
        (bytes[offset] & 0xff) |
        ((bytes[offset + 1] & 0xff) << 8) |
        ((bytes[offset + 2] & 0xff) << 16) |
        ((bytes[offset + 3] & 0xff) << 24);
    } else if (bytes.length >= offset + 2) {
      steps = (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8);
    } else if (bytes.length >= offset + 1) {
      steps = bytes[offset] & 0xff;
    }

    // Distance in meters
    const distance =
      bytes.length >= offset + 6
        ? (bytes[offset + 4] & 0xff) | ((bytes[offset + 5] & 0xff) << 8)
        : Math.round(steps * 0.75);

    // Calories in kcal
    const calories =
      bytes.length >= offset + 8
        ? (bytes[offset + 6] & 0xff) | ((bytes[offset + 7] & 0xff) << 8)
        : Math.round(steps * 0.04);

    const activeMinutes =
      bytes.length >= offset + 10
        ? (bytes[offset + 8] & 0xff) | ((bytes[offset + 9] & 0xff) << 8)
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

  // Case E: Zeblaze Btalk 4 Pro / MoYoung real-time telemetry packet (80 82 07 00 01 <BPM> 00)
  // Continuous stream on FF03 every 3s: byte 5 contains live BPM (e.g. 79, 97, 102)
  if (
    bytes.length >= 6 &&
    (b1 === 0x82 || (b0 === 0x80 && b1 === 0x82)) &&
    bytes.length < 9 // Exclude 9-byte ASCII firmware version response: 00 82 09 00 01 "1.10"
  ) {
    const candidateBpm = bytes[5] & 0xff;
    if (candidateBpm >= 35 && candidateBpm <= 230) {
      return {
        bpm: candidateBpm,
        isSingleComplete: false,
      };
    }
  }

  return null;
}

/**
 * Parses SpO2 (Blood Oxygen) notifications (MoYoung 0x6B live or 0x37 history/snapshot).
 */
export function parseSpO2Packet(bytes: number[]): { spo2: number; isComplete?: boolean } | null {
  if (!bytes || bytes.length < 4) {
    return null;
  }
  const b0 = bytes[0] & 0xff;
  const b1 = bytes[1] & 0xff;

  // Case A: 0xFE 0xEA framing with command 0x6B or 0x37
  if (bytes.length >= 6 && b0 === 0xfe && b1 === 0xea) {
    const cmdId = bytes[4] & 0xff;
    if (cmdId === 0x6b || cmdId === 0xeb) {
      for (let i = 5; i < bytes.length; i++) {
        const val = bytes[i] & 0xff;
        if (val >= 80 && val <= 100) {
          return { spo2: val, isComplete: cmdId === 0xeb };
        }
      }
    }
    if (cmdId === 0x37 || cmdId === 0xb7) {
      for (let i = bytes.length - 1; i >= 5; i--) {
        const val = bytes[i] & 0xff;
        if (val >= 80 && val <= 100) {
          return { spo2: val, isComplete: true };
        }
      }
    }
  }

  // Case B: MoYoung V1 format: [0x00/0x80, 0x6B/0xEB/0x37/0xB7/0x84, LEN, ...]
  // Zeblaze Btalk 4 Pro sends: 80 84 08 00 02 02 00 <SPO2 (0x62 = 98%)>
  if (b1 === 0x84 || b1 === 0x6b || b1 === 0xeb || b1 === 0x37 || b1 === 0xb7 || b0 === 0x84) {
    for (let i = bytes.length - 1; i >= 3; i--) {
      const val = bytes[i] & 0xff;
      if (val >= 80 && val <= 100) {
        return { spo2: val, isComplete: true };
      }
    }
  }

  // Case C: byte 0 is 0x6B / 0x37
  if (b0 === 0x6b || b0 === 0x37) {
    for (let i = bytes.length - 1; i >= 1; i--) {
      const val = bytes[i] & 0xff;
      if (val >= 80 && val <= 100) {
        return { spo2: val, isComplete: true };
      }
    }
  }

  return null;
}
