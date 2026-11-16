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

  // 1. Antjy / Zeblaze Official Real-time Step Stream: [0x80, 0x80, len, 0x08, 0x00, S0, S1, S2, S3, D0, D1, C0, C1]
  // Verified from DeviceReportEventParser: f(bytes, 5, 4) = steps, f(bytes, 9, 2) = distance, f(bytes, 11, 2) = calories
  if (b0 === 0x80 && b1 === 0x80 && bytes.length >= 13) {
    const steps =
      (bytes[5] & 0xff) |
      ((bytes[6] & 0xff) << 8) |
      ((bytes[7] & 0xff) << 16) |
      ((bytes[8] & 0xff) << 24);
    const distance = (bytes[9] & 0xff) | ((bytes[10] & 0xff) << 8);
    const calories = (bytes[11] & 0xff) | ((bytes[12] & 0xff) << 8);
    const activeMinutes =
      bytes.length >= 15 ? (bytes[13] & 0xff) | ((bytes[14] & 0xff) << 8) : 0;

    return {
      steps: steps >= 0 && steps < 500000 ? steps : 0,
      distance,
      calories,
      activeMinutes,
    };
  }

  // 2. Antjy / Zeblaze StepDataParser (108-byte sync / history buffer):
  // Verified from StepDataParser.b: f(bytes, 96, 4) = steps, f(bytes, 100, 4) = calories, f(bytes, 104, 4) = distance
  if (bytes.length >= 108) {
    const steps =
      (bytes[96] & 0xff) |
      ((bytes[97] & 0xff) << 8) |
      ((bytes[98] & 0xff) << 16) |
      ((bytes[99] & 0xff) << 24);
    const calories =
      (bytes[100] & 0xff) |
      ((bytes[101] & 0xff) << 8) |
      ((bytes[102] & 0xff) << 16) |
      ((bytes[103] & 0xff) << 24);
    const distance =
      (bytes[104] & 0xff) |
      ((bytes[105] & 0xff) << 8) |
      ((bytes[106] & 0xff) << 16) |
      ((bytes[107] & 0xff) << 24);
    if (steps > 0 && steps < 500000) {
      return { steps, distance, calories, activeMinutes: 0 };
    }
  }

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

  // 3. MoYoung V2: [0xfe, 0xea, 0x10, LEN, CMD, ...]
  if (b0 === 0xfe && b1 === 0xea && bytes.length >= 6) {
    const cmd = bytes[4] & 0xff;
    // 0x59 is queryStepsCategory(TODAY), 0x5C is querySteps, 0x5D is queryYesterday
    if (cmd === 0x59 || cmd === 0x5c || cmd === 0x5d) {
      // Sum the 30-min category interval steps (16-bit LE per interval starting at index 6)
      let totalSteps = 0;
      for (let i = 6; i + 1 < bytes.length; i += 2) {
        totalSteps += (bytes[i] & 0xff) | ((bytes[i + 1] & 0xff) << 8);
      }
      if (totalSteps > 0 && totalSteps < 200000) {
        return {
          steps: totalSteps,
          distance: Math.round(totalSteps * 0.75),
          calories: Math.round(totalSteps * 0.04),
          activeMinutes: 0,
        };
      }
    }

    // 0x07 Real-time activity or 0x33 daily summary
    if (cmd === 0x07 || cmd === 0x33 || cmd === 0x08) {
      const offset = 5;
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
      const distance =
        bytes.length >= offset + 6
          ? (bytes[offset + 4] & 0xff) | ((bytes[offset + 5] & 0xff) << 8)
          : Math.round(steps * 0.75);
      const calories =
        bytes.length >= offset + 8
          ? (bytes[offset + 6] & 0xff) | ((bytes[offset + 7] & 0xff) << 8)
          : Math.round(steps * 0.04);
      return { steps, distance, calories, activeMinutes: 0 };
    }
  }

  // 4. WeChat Sports GATT characteristic (FEE1 / FEA1 9-byte packet or 0x01/0x07 prefix)
  if (bytes.length === 9 && !(b0 === 0x00 && (bytes[1] & 0xff) === 0x82)) {
    // Standard DaFit / WeChat Sports 9-byte packet: [steps 3B LE] [calories 3B LE] [distance 3B LE]
    const steps = (bytes[0] & 0xff) | ((bytes[1] & 0xff) << 8) | ((bytes[2] & 0xff) << 16);
    const calories = (bytes[3] & 0xff) | ((bytes[4] & 0xff) << 8) | ((bytes[5] & 0xff) << 16);
    const distance = (bytes[6] & 0xff) | ((bytes[7] & 0xff) << 8) | ((bytes[8] & 0xff) << 16);
    if (steps >= 0 && steps < 200000 && calories < 50000) {
      return { steps, distance, calories, activeMinutes: 0 };
    }
  }

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

  // Reject battery status (80 82) and firmware version (00 82)
  if ((bytes[1] & 0xff) === 0x82) {
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

  // Case E: Zeblaze / Antjy Single Measurement Report Packet:
  // Header: 0x80 0x84, Length >= 7
  // bytes[4]: Status (0x01: Measuring in progress, 0x02: Measurement complete, 0x03: Measurement error)
  // bytes[5]: Type Key (0x00: Heart Rate BPM)
  // bytes[6]: Value 1 (BPM)
  // bytes[7]: Value 2
  if (b0 === 0x80 && b1 === 0x84 && bytes.length >= 7) {
    const status = bytes[4] & 0xff;
    const typeKey = bytes[5] & 0xff;
    if (typeKey === 0x00) {
      const bpm = (bytes[6] & 0xff) || (bytes.length >= 8 ? bytes[7] & 0xff : 0);
      if (bpm >= 35 && bpm <= 230) {
        return {
          bpm,
          isSingleComplete: status === 0x02,
        };
      }
      if (status === 0x01) {
        return {
          bpm: 0,
          isSingleComplete: false,
        };
      }
      if (status === 0x02 && bpm > 0) {
        return {
          bpm,
          isSingleComplete: true,
        };
      }
    }
    // If typeKey !== 0x00, strictly reject (do not parse as HR)
    return null;
  }

  return null;
}

/**
 * Parses battery status notifications: 80 82 07 00 01 <BATTERY_PERCENT> 00
 * Opcode 0x82 is strictly battery/power telemetry.
 */
export function parseBatteryPacket(bytes: number[]): { battery: number } | null {
  if (!bytes || bytes.length < 6) {
    return null;
  }
  const b0 = bytes[0] & 0xff;
  const b1 = bytes[1] & 0xff;

  // 80 82 07 00 01 <BATTERY> 00 (7 bytes)
  // Exclude 9-byte ASCII firmware version response: 00 82 09 00 01 "1.10"
  if (b0 === 0x80 && b1 === 0x82 && bytes.length === 7) {
    const battery = bytes[5] & 0xff;
    if (battery >= 0 && battery <= 100) {
      return { battery };
    }
  }
  return null;
}

/**
 * Parses SpO2 (Blood Oxygen) notifications (MoYoung 0x6B live or 0x37 history/snapshot).
 * Strictly checks sub-command IDs to avoid misinterpreting heart rate or status packets as SpO2.
 */
export function parseSpO2Packet(bytes: number[]): { spo2: number; isComplete?: boolean } | null {
  if (!bytes || bytes.length < 2) {
    return null;
  }
  const b0 = bytes[0] & 0xff;
  const b1 = bytes[1] & 0xff;

  // Reject heart rate telemetry (80 82) and firmware version (00 82)
  if (b1 === 0x82) {
    return null;
  }

  // Case A: 0xFE 0xEA framing with command 0x6B (live/complete) or 0x37/0xB7 (history)
  if (bytes.length >= 6 && b0 === 0xfe && b1 === 0xea) {
    const cmdId = bytes[4] & 0xff;
    if (cmdId === 0x6b || cmdId === 0xeb) {
      // In DaFit ui3.y, payload is at bytes[5]: onBloodOxygen(bytes[5])
      const candidate = bytes[5] & 0xff;
      if (candidate >= 70 && candidate <= 100) {
        return { spo2: candidate, isComplete: cmdId === 0xeb };
      }
      if (bytes.length >= 7) {
        const candidate2 = bytes[6] & 0xff;
        if (candidate2 >= 70 && candidate2 <= 100) {
          return { spo2: candidate2, isComplete: cmdId === 0xeb };
        }
      }
      return null;
    }
    if (cmdId === 0x37 || cmdId === 0xb7) {
      const candidate = bytes[5] & 0xff;
      if (candidate >= 70 && candidate <= 100) {
        return { spo2: candidate, isComplete: true };
      }
      return null;
    }
  }

  // Case B: Zeblaze / Antjy Single Measurement Report Packet:
  // Header: 0x80 0x84, Length >= 7
  // bytes[4]: Status (0x01: Measuring in progress, 0x02: Measurement complete, 0x03: Measurement error)
  // bytes[5]: Type Key (0x02: Blood Oxygen SpO2 %)
  // bytes[6]: Value 1 (SpO2 %)
  // bytes[7]: Value 2
  if (b0 === 0x80 && b1 === 0x84 && bytes.length >= 7) {
    const status = bytes[4] & 0xff;
    const typeKey = bytes[5] & 0xff;
    if (typeKey === 0x02) {
      const spo2 = (bytes[6] & 0xff) || (bytes.length >= 8 ? bytes[7] & 0xff : 0);
      if (spo2 >= 70 && spo2 <= 100) {
        return {
          spo2,
          isComplete: status === 0x02,
        };
      }
      if (status === 0x01) {
        return {
          spo2: 0,
          isComplete: false,
        };
      }
      if (status === 0x02 && spo2 > 0) {
        return {
          spo2,
          isComplete: true,
        };
      }
    }
    // If typeKey !== 0x02, strictly reject (do not parse as SpO2)!
    // NEVER parse a Heart Rate or other metric packet as SpO2!
    return null;
  }

  // Case C: Unframed 0x6B / 0xEB packet: [0x6B/0xEB, <SPO2>]
  if (b0 === 0x6b || b0 === 0xeb) {
    if (bytes.length >= 2) {
      const candidate = bytes[1] & 0xff;
      if (candidate >= 70 && candidate <= 100) {
        return { spo2: candidate, isComplete: b0 === 0xeb };
      }
    }
    return null;
  }

  // Case D: MoYoung V1 response: [0x00, 0x6B/0xEB, LEN, 0x00, <SPO2>]
  if (b0 === 0x00 && (b1 === 0x6b || b1 === 0xeb)) {
    const offset = bytes.length >= 5 && (bytes[3] & 0xff) === 0x00 ? 4 : 2;
    if (bytes.length > offset) {
      const candidate = bytes[offset] & 0xff;
      if (candidate >= 70 && candidate <= 100) {
        return { spo2: candidate, isComplete: b1 === 0xeb };
      }
    }
    return null;
  }

  return null;
}
