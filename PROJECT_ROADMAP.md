# 🚀 Zeblaze-BLE — Flagship Research & Development Roadmap

> **Mission:** Build a high-precision, medical-grade, open-source smartwatch companion application for the **Zeblaze Btalk 4 Pro** that rivals and surpasses industry giants like **Amazfit (Zepp Health)**, **Redmi Watch (Mi Fitness)**, and **Samsung Galaxy Fit**.
>
> **Core Principle:** **Zero Fabricated / Averaged Data.** Every metric shown in this application is strictly decoded from authenticated hardware sensor packets, processed through peer-reviewed biomedical Digital Signal Processing (DSP) algorithms, and validated against clinical standards.

---

## 📌 Table of Contents
1. [Target Hardware & Verified BLE Protocol](#1-target-hardware--verified-ble-protocol)
2. [Critical Discoveries & Solved Protocol Pitfalls](#2-critical-discoveries--solved-protocol-pitfalls)
3. [Top-Tier Biomedical Algorithm Architecture](#3-top-tier-biomedical-algorithm-architecture)
4. [Phased Development Roadmap](#4-phased-development-roadmap)
5. [Cross-PC Development Setup Guide](#5-cross-pc-development-setup-guide)

---

## 1. Target Hardware & Verified BLE Protocol

* **Device Model:** Zeblaze Btalk 4 Pro
* **Target MAC Address:** `FD:99:E2:BB:76:D0`
* **SoC / Firmware Architecture:** MoYoung / Crrepa BLE Dual-Mode Stack (Firmware v1.10)
* **GATT Master Policy:** Exclusive connection (Smartwatch accepts only **one** master at a time; ensure nRF Connect and vendor companion apps are disconnected/force-stopped).

### GATT Services & Characteristics Map

| Service Name | Service UUID | Characteristic | Properties | Role in App |
| :--- | :--- | :--- | :--- | :--- |
| **MoYoung Custom Service** | `000001ff-3c17-d293-8e48-14fe2e4da212` | `0000ff02-0000-1000-8000-00805f9b34fb` | `WRITE`, `WRITE_NO_RESP` | TX: Command injection pipe |
| **MoYoung Telemetry** | `000001ff-3c17-d293-8e48-14fe2e4da212` | `0000ff03-0000-1000-8000-00805f9b34fb` | `NOTIFY` (Descriptor `0x2902`) | RX: Real-time sensor stream |
| **WeChat Sports** | `0000fee7-0000-1000-8000-00805f9b34fb` | `0000fea1-0000-1000-8000-00805f9b34fb` | `READ`, `NOTIFY` | Secondary step/activity channel |
| **Human Interface Device** | `00001812-0000-1000-8000-00805f9b34fb` | Multiple Report IDs | `READ`, `WRITE`, `NOTIFY` | Remote PC/Camera control |
| **Device Information** | `0000180a-0000-1000-8000-00805f9b34fb` | Model, Firmware, Hardware | `READ` | Hardware identification |

### Verified Command & Telemetry Packet Formats

#### A. Real-Time Heart Rate Telemetry
- **Stream Characteristic:** `FF03` (Continuous 3-second optical broadcast)
- **Packet Structure:** `80 82 07 00 01 <BPM_HEX> 00`
- **Example:** `80 82 07 00 01 4C 00` $\rightarrow$ `0x4C` = **76 BPM**; `80 82 07 00 01 61 00` $\rightarrow$ `0x61` = **97 BPM**.

#### B. Full Daily Activity & Step Summary
- **Trigger Command:** `[0x00, 0x33, 0x04, 0x00]` (V1) or `[0xfe, 0xea, 0x10, 0x06, 0x33, 0x00]` (V2) sent to `FF02`.
- **Packet Structure:** `80 80 0D 00 01 [Steps 4B LE] [Distance 2B LE] [Calories 2B LE]`
- **Live Example Decoded:** `80 80 0D 00 01 31 21 00 00 6A 17 58 01`
  - `31 21 00 00` (Little-Endian: `0x2131`) = **8,497 steps**
  - `6A 17` (Little-Endian: `0x176A`) = **5,994 meters (5.99 km)**
  - `58 01` (Little-Endian: `0x0158`) = **344 kcal**

#### C. Optical Blood Oxygen (SpO2)
- **Start Measurement:** `[0x00, 0x6b, 0x05, 0x00, 0x01]` (V1) or `[0xfe, 0xea, 0x10, 0x06, 0x6b, 0x00]` (V2)
- **Stop Measurement:** `[0x00, 0x6b, 0x05, 0x00, 0x00]` (V1)
- **Completion Packet:** `80 84 08 00 02 02 00 <SPO2_HEX>`
- **Live Example Decoded:** `80 84 08 00 02 02 00 61` $\rightarrow$ `0x61` = **97% SpO2**.

---

## 2. Critical Discoveries & Solved Protocol Pitfalls

1. **The "68-Step / 67-Step" Overwrite Bug:**
   - *Problem:* Tapping `Sync` was previously reverting the step count to `68` or `67`.
   - *Root Cause:* The sync routine sent `0x08`, which is the watch's **Display / Brightness / Timeout Settings** query. The watch returned `00 88 06 00 01 44` (or `43`). Byte 5 (`0x44` = 68, `0x43` = 67) was erroneously parsed by old step parsers.
   - *Solution:* Completely removed `00 88` from `parseActivityPacket` and replaced `0x08` with `0x33` MoYoung sync commands. Steps now strictly parse from authentic `80 80` daily payloads.
2. **Dynamic Continuous Mode vs Quick Measurement:**
   - Tapping the watch face executes a 15-second low-power quick test.
   - Sending `CMD_START_DYNAMIC_HEART_RATE_V1` (`[0x00, 0x68, 0x05, 0x00, 0x01]`) unlocks the watch's **Continuous Workout Mode**, keeping the optical LED fully powered for continuous multi-minute medical analysis.

---

## 3. Top-Tier Biomedical Algorithm Architecture

To reach the accuracy levels of **Apple Health**, **Garmin (Firstbeat)**, and **Whoop**, the app implements real-time mathematical filtering:

### A. Digital Signal Processing (DSP) & Bandpass Filtering
* Human heart rate physiologically stays between **0.5 Hz (30 BPM)** and **3.5 Hz (210 BPM)**.
* **Algorithm:** 4th-order digital Butterworth Bandpass Filter to eliminate motion artifacts, powerline hum ($50/60\text{ Hz}$), and low-frequency arm movement.
* **Hampel Filter (Outlier Rejection):**
  $$\text{Window: } 5 \text{ samples} \quad | \quad |x_i - \text{median}| > 3 \times \text{MAD} \implies \text{Reject / Calibrate}$$

### B. HRV & True Stress Estimation (RMSSD & SDNN)
We reject simplistic static stress numbers in favor of clinical autonomic balance standards:
1. **RMSSD (Root Mean Square of Successive Differences):**
   $$\text{RMSSD} = \sqrt{\frac{1}{N-1} \sum_{i=1}^{N-1} (RR_{i+1} - RR_i)^2}$$
   Direct indicator of Parasympathetic Vagal Tone (short-term 1-minute stress).
2. **SDNN (Standard Deviation of NN Intervals):**
   $$\text{SDNN} = \sqrt{\frac{1}{N-1} \sum_{i=1}^{N} (RR_i - \overline{RR})^2}$$
   Gold standard for long-term autonomic nervous system resilience.
3. **Baevsky's Stress Index ($SI$):**
   $$SI = \frac{AMo}{2 \cdot Mo \cdot MxDMn}$$

### C. True Metabolic Calorie Burn (Keytel Formula)
Instead of coarse $Steps \times 0.04$, implement Keytel's physiological energy expenditure equation:
$$\text{Burned Calories (Men)} = \left[(-55.0969 + (0.6309 \times \text{HR}) + (0.1988 \times \text{Weight}) + (0.2017 \times \text{Age})) / 4.184\right] \times 60 \times t$$

---

## 4. Phased Development Roadmap

### ✅ Phase 1: Core Connectivity & Vitals Telemetry (Completed)
- [x] Exclusive BLE session management with auto-reconnect.
- [x] MoYoung `000001ff` service discovery, `FF02` write, `FF03` notification subscription.
- [x] Live Heart Rate (3s continuous stream) decoding.
- [x] SpO2 measurement command and packet decoder.
- [x] 13-byte `80 80` daily activity parsing (Steps, Distance, Calories).
- [x] Fixed 68/67 step overwrite bug.

### 🟡 Phase 2: 1-Minute Precision Diagnostic Suite & Live Waveform (Current Priority)
- [ ] **1-Minute Precision Cardiocentric Mode:**
  - Automated 60-second countdown session using `0x68` dynamic stream.
  - Initial 10-second stabilization filter (discards motion spikes).
  - Statistical summary: True Average HR, Resting Baseline, Min/Max HR.
- [ ] **Real-time Live Pulse Waveform (SVG/Skia):** Smooth ECG-style animated canvas charting beat-by-beat telemetry.

### 🔵 Phase 3: Stress Engine & Sleep Architecture
- [ ] **Stress & Recovery Score (1–100%):** Clinical RMSSD and Baevsky Index computation from 60-second IBI streams.
- [ ] **Sleep Hypnogram Decoder (`0x34`):** Read historical flash memory packets for Deep Sleep, Light Sleep, REM, and Wake intervals.
- [ ] **Blood Pressure Estimation (`0x6C`):** Calibrated Systolic/Diastolic pulse transit estimation.

### 🟣 Phase 4: Local-First Storage & Flagship Dashboard
- [ ] SQLite / WatermelonDB integration for local encrypted telemetry storage.
- [ ] 7-day, 30-day, and 1-year historical trend charts.
- [ ] Dark Minimalist UI inspired by Apple Health & Zepp Health.
- [ ] Export to standard formats (CSV, JSON, Apple Health / Health Connect).

### 🟢 Phase 5: Hardware Remote & Automations
- [ ] **HID Service (`0x1812`):** PowerPoint/Keynote presentation clicker and PC media remote.
- [ ] **Device Finder:** Two-way vibration trigger (`0x10`) and phone ringer.
- [ ] **Custom OTA Watch Face Uploader:** Binary dial transfer over BLE.

---

## 5. Cross-PC Development Setup Guide

When continuing development on a new or different PC, follow these steps:

### Prerequisites
1. **Node.js:** v18.x or v20.x LTS installed.
2. **Java Development Kit:** JDK 17 (e.g. Microsoft OpenJDK 17 or Temurin 17).
3. **Android SDK:** Installed with `platform-tools` (ensure `adb` is on system `PATH`).
4. **Physical Android Device:** Android 10+ phone with Developer Options & USB / Wireless Debugging enabled.

### Setup Instructions
```powershell
# 1. Clone repository
git clone https://github.com/khairul-islam-shaon/Zeblaze-BLE.git
cd Zeblaze-BLE

# 2. Install dependencies
npm install

# 3. Connect phone via ADB (Wireless or USB)
adb devices

# 4. Start Metro bundler (Terminal 1)
npm start

# 5. Build and install Debug APK (Terminal 2)
.\run-app.bat
# Or manually:
cd android
.\gradlew.bat assembleDebug
cd ..
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
adb shell monkey -p com.zeblazeble -c android.intent.category.LAUNCHER 1

# 6. Mirror Phone Screen to PC (Optional)
.\mirror-phone-to-pc.bat
```
