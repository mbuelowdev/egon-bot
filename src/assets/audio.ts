/**
 * Duration, sample rate, and channel count straight out of the container headers. Best
 * effort by design: a reader that cannot make sense of a file records nothing and the
 * upload still succeeds, because the human's description is the required part and the
 * measurements are the bonus. Nothing here throws.
 */

export type AudioMeasurement = {
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
};

const MPEG_BITRATES_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const MPEG_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MPEG_SAMPLE_RATES = [44100, 48000, 32000, 0];

function roundSeconds(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.round(value * 1000) / 1000;
}

/** RIFF/WAVE: walk the chunk list for `fmt ` and `data`. */
export function measureWav(buffer: Buffer): AudioMeasurement | undefined {
  if (buffer.length < 12 || buffer.toString("latin1", 0, 4) !== "RIFF") {
    return undefined;
  }
  if (buffer.toString("latin1", 8, 12) !== "WAVE") {
    return undefined;
  }
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let byteRate: number | undefined;
  let dataBytes: number | undefined;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("latin1", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      byteRate = buffer.readUInt32LE(body + 8);
    } else if (id === "data") {
      dataBytes = Math.min(size, Math.max(0, buffer.length - body));
    }
    offset = body + size + (size % 2);
  }
  const measurement: AudioMeasurement = {};
  if (channels !== undefined && channels > 0) {
    measurement.channels = channels;
  }
  if (sampleRate !== undefined && sampleRate > 0) {
    measurement.sampleRate = sampleRate;
  }
  if (byteRate !== undefined && byteRate > 0 && dataBytes !== undefined) {
    const seconds = roundSeconds(dataBytes / byteRate);
    if (seconds !== undefined) {
      measurement.durationSeconds = seconds;
    }
  }
  return Object.keys(measurement).length > 0 ? measurement : undefined;
}

function oggPageBodyOffset(buffer: Buffer, pageStart: number): number | undefined {
  if (pageStart + 27 > buffer.length) {
    return undefined;
  }
  const segments = buffer.readUInt8(pageStart + 26);
  const body = pageStart + 27 + segments;
  return body <= buffer.length ? body : undefined;
}

function lastOggGranule(buffer: Buffer): number | undefined {
  for (let i = buffer.length - 27; i >= 0; i -= 1) {
    if (buffer.readUInt32BE(i) !== 0x4f676753) {
      continue;
    }
    const granule = buffer.readBigUInt64LE(i + 6);
    if (granule === 0xffffffffffffffffn) {
      continue;
    }
    return Number(granule);
  }
  return undefined;
}

/** Ogg: identification header in page 0, duration from the final page's granule position. */
export function measureOgg(buffer: Buffer): AudioMeasurement | undefined {
  if (buffer.length < 27 || buffer.toString("latin1", 0, 4) !== "OggS") {
    return undefined;
  }
  const body = oggPageBodyOffset(buffer, 0);
  if (body === undefined) {
    return undefined;
  }
  const measurement: AudioMeasurement = {};
  let granuleRate: number | undefined;
  if (buffer.length >= body + 16 && buffer.toString("latin1", body + 1, body + 7) === "vorbis") {
    measurement.channels = buffer.readUInt8(body + 11);
    measurement.sampleRate = buffer.readUInt32LE(body + 12);
    granuleRate = measurement.sampleRate;
  } else if (buffer.length >= body + 16 && buffer.toString("latin1", body, body + 8) === "OpusHead") {
    measurement.channels = buffer.readUInt8(body + 9);
    measurement.sampleRate = buffer.readUInt32LE(body + 12);
    // Opus granule positions are always counted at 48 kHz, whatever the input rate was.
    granuleRate = 48000;
  } else {
    return undefined;
  }
  const granule = lastOggGranule(buffer);
  if (granule !== undefined && granuleRate !== undefined && granuleRate > 0) {
    const seconds = roundSeconds(granule / granuleRate);
    if (seconds !== undefined) {
      measurement.durationSeconds = seconds;
    }
  }
  if (measurement.channels === 0) {
    delete measurement.channels;
  }
  if (measurement.sampleRate === 0) {
    delete measurement.sampleRate;
  }
  return Object.keys(measurement).length > 0 ? measurement : undefined;
}

function id3Length(buffer: Buffer): number {
  if (buffer.length < 10 || buffer.toString("latin1", 0, 3) !== "ID3") {
    return 0;
  }
  const size =
    ((buffer.readUInt8(6) & 0x7f) << 21) |
    ((buffer.readUInt8(7) & 0x7f) << 14) |
    ((buffer.readUInt8(8) & 0x7f) << 7) |
    (buffer.readUInt8(9) & 0x7f);
  return 10 + size;
}

/** MPEG audio: first frame header for the format, Xing/Info frame count for the duration. */
export function measureMp3(buffer: Buffer): AudioMeasurement | undefined {
  const start = id3Length(buffer);
  for (let i = start; i + 4 <= buffer.length && i < start + 65536; i += 1) {
    if (buffer.readUInt8(i) !== 0xff || (buffer.readUInt8(i + 1) & 0xe0) !== 0xe0) {
      continue;
    }
    const versionBits = (buffer.readUInt8(i + 1) >> 3) & 0x03;
    const layerBits = (buffer.readUInt8(i + 1) >> 1) & 0x03;
    if (versionBits === 1 || layerBits === 0) {
      continue;
    }
    const bitrateIndex = (buffer.readUInt8(i + 2) >> 4) & 0x0f;
    const rateIndex = (buffer.readUInt8(i + 2) >> 2) & 0x03;
    const channelMode = (buffer.readUInt8(i + 3) >> 6) & 0x03;
    const mpeg1 = versionBits === 3;
    const table = mpeg1 ? MPEG_BITRATES_V1_L3 : MPEG_BITRATES_V2_L3;
    const bitrateKbps = table[bitrateIndex] ?? 0;
    const baseRate = MPEG_SAMPLE_RATES[rateIndex] ?? 0;
    if (bitrateKbps === 0 || baseRate === 0) {
      continue;
    }
    const sampleRate = mpeg1 ? baseRate : versionBits === 2 ? baseRate / 2 : baseRate / 4;
    const samplesPerFrame = mpeg1 ? 1152 : 576;
    const measurement: AudioMeasurement = {
      sampleRate,
      channels: channelMode === 3 ? 1 : 2,
    };
    const tagOffset = buffer.indexOf("Xing", i, "latin1");
    const infoOffset = buffer.indexOf("Info", i, "latin1");
    const xing = tagOffset >= 0 && tagOffset < i + 200 ? tagOffset : infoOffset >= 0 && infoOffset < i + 200 ? infoOffset : -1;
    let seconds: number | undefined;
    if (xing >= 0 && xing + 12 <= buffer.length && (buffer.readUInt32BE(xing + 4) & 0x1) === 1) {
      const frames = buffer.readUInt32BE(xing + 8);
      seconds = roundSeconds((frames * samplesPerFrame) / sampleRate);
    }
    if (seconds === undefined) {
      seconds = roundSeconds(((buffer.length - i) * 8) / (bitrateKbps * 1000));
    }
    if (seconds !== undefined) {
      measurement.durationSeconds = seconds;
    }
    return measurement;
  }
  return undefined;
}

export function measureAudio(buffer: Buffer, ext: string): AudioMeasurement | undefined {
  try {
    if (ext === ".wav") {
      return measureWav(buffer);
    }
    if (ext === ".ogg") {
      return measureOgg(buffer);
    }
    if (ext === ".mp3") {
      return measureMp3(buffer);
    }
  } catch {
    return undefined;
  }
  return undefined;
}
