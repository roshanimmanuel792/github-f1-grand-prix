// MP4 export: WebCodecs + mediabunny (real MP4 container). Falls back to MediaRecorder,
// whose output format is reported honestly (MP4 only if the browser actually produced MP4).
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, getFirstEncodableVideoCodec } from 'mediabunny';

export class UnsupportedVideoError extends Error {}

export async function webCodecsCodec(width, height) {
  if (typeof VideoEncoder === 'undefined') return null;
  try {
    return await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width, height });
  } catch {
    return null;
  }
}

export function mediaRecorderType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** What this browser can produce. */
export async function videoSupport(width = 1280, height = 720) {
  const codec = await webCodecsCodec(width, height);
  if (codec) return { method: 'webcodecs', container: 'mp4', codec };
  const type = mediaRecorderType();
  if (type) return { method: 'mediarecorder', container: type.startsWith('video/mp4') ? 'mp4' : 'webm', codec: type };
  return null;
}

/**
 * Frame-accurate encoder fed one frame at a time (timestamps from the replay clock).
 * @returns {{codec, container, add(t: number): Promise<void>, finish(): Promise<Blob>, cancel(): Promise<void>}}
 */
export async function createVideoWriter(canvas, { fps, bitrate }) {
  const codec = await webCodecsCodec(canvas.width, canvas.height);
  if (codec) {
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    return {
      codec,
      container: 'mp4',
      method: 'webcodecs',
      add: (t) => source.add(t, 1 / fps),
      async finish() {
        await output.finalize();
        return new Blob([output.target.buffer], { type: 'video/mp4' });
      },
      cancel: () => output.cancel(),
    };
  }
  const type = mediaRecorderType();
  if (!type) throw new UnsupportedVideoError('This browser cannot encode video (no WebCodecs or MediaRecorder). Try Chrome, Edge or Safari.');
  // MediaRecorder timestamps frames by wall clock, so frames are paced in real time.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(1000);
  let next = performance.now();
  return {
    codec: type,
    container: type.startsWith('video/mp4') ? 'mp4' : 'webm',
    method: 'mediarecorder',
    async add() {
      track.requestFrame();
      next += 1000 / fps;
      const wait = next - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    },
    finish: () =>
      new Promise((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: type.split(';')[0] }));
        recorder.stop();
      }),
    async cancel() {
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}
