import assert from "node:assert/strict";
import { test } from "node:test";
import { measureAudio, measureMp3, measureOgg, measureWav } from "./audio.js";

function makeWav(options: {
  channels: number;
  sampleRate: number;
  bits: number;
  seconds: number;
}): Buffer {
  const blockAlign = (options.channels * options.bits) / 8;
  const byteRate = options.sampleRate * blockAlign;
  const dataBytes = Math.round(byteRate * options.seconds);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(options.channels, 22);
  header.writeUInt32LE(options.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(options.bits, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
}

function oggPage(granule: number, body: Buffer, sequence: number): Buffer {
  const segments: number[] = [];
  let left = body.length;
  while (left >= 255) {
    segments.push(255);
    left -= 255;
  }
  segments.push(left);
  const header = Buffer.alloc(27 + segments.length);
  header.write("OggS", 0, "latin1");
  header.writeUInt8(0, 4);
  header.writeUInt8(sequence === 0 ? 2 : 4, 5);
  header.writeBigUInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(1, 14);
  header.writeUInt32LE(sequence, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt8(segments.length, 26);
  for (const [i, size] of segments.entries()) {
    header.writeUInt8(size, 27 + i);
  }
  return Buffer.concat([header, body]);
}

function makeOggVorbis(channels: number, sampleRate: number, seconds: number): Buffer {
  const id = Buffer.alloc(30);
  id.writeUInt8(1, 0);
  id.write("vorbis", 1, "latin1");
  id.writeUInt32LE(0, 7);
  id.writeUInt8(channels, 11);
  id.writeUInt32LE(sampleRate, 12);
  return Buffer.concat([
    oggPage(0, id, 0),
    oggPage(Math.round(sampleRate * seconds), Buffer.alloc(64), 1),
  ]);
}

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo — the header every mp3 encoder emits. */
function makeMp3(payloadBytes: number, withId3: boolean): Buffer {
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  const audio = Buffer.concat([frame, Buffer.alloc(payloadBytes)]);
  if (!withId3) {
    return audio;
  }
  const tag = Buffer.alloc(10 + 64);
  tag.write("ID3", 0, "latin1");
  tag.writeUInt8(4, 3);
  tag.writeUInt8(64, 9);
  return Buffer.concat([tag, audio]);
}

test("WAV reports channels, sample rate, and duration from its chunks", () => {
  assert.deepEqual(measureWav(makeWav({ channels: 2, sampleRate: 44100, bits: 16, seconds: 1.5 })), {
    channels: 2,
    sampleRate: 44100,
    durationSeconds: 1.5,
  });
  assert.deepEqual(measureWav(makeWav({ channels: 1, sampleRate: 22050, bits: 8, seconds: 2 })), {
    channels: 1,
    sampleRate: 22050,
    durationSeconds: 2,
  });
});

test("Ogg Vorbis reports the identification header and the final granule as duration", () => {
  assert.deepEqual(measureOgg(makeOggVorbis(2, 44100, 1.5)), {
    channels: 2,
    sampleRate: 44100,
    durationSeconds: 1.5,
  });
});

test("MP3 reads its frame header and estimates duration from the bitrate", () => {
  const measured = measureMp3(makeMp3(16000, false));
  assert.equal(measured?.sampleRate, 44100);
  assert.equal(measured?.channels, 2);
  assert.ok((measured?.durationSeconds ?? 0) > 0.9 && (measured?.durationSeconds ?? 0) < 1.1);
  assert.equal(measureMp3(makeMp3(16000, true))?.sampleRate, 44100);
});

test("a file the reader cannot make sense of measures nothing instead of throwing", () => {
  assert.equal(measureWav(Buffer.from("nope")), undefined);
  assert.equal(measureOgg(Buffer.from("nope")), undefined);
  assert.equal(measureMp3(Buffer.alloc(64)), undefined);
  assert.equal(measureAudio(Buffer.alloc(0), ".wav"), undefined);
  assert.equal(measureAudio(makeWav({ channels: 2, sampleRate: 44100, bits: 16, seconds: 1 }), ".png"), undefined);
});
