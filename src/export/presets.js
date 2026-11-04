// Export presets (kept separate so the page can list them without loading the encoders).

// GIF frame rates divide 100 so centisecond delays are exact (keeps a 2x replay at true 2x).
export const GIF_PRESETS = {
  readme: { label: 'README 320×180 · 10 fps', width: 320, height: 180, fps: 10, colors: 48 },
  hd: { label: 'Large 480×270 · 10 fps', width: 480, height: 270, fps: 10, colors: 128 },
  tiny: { label: 'Tiny 256×144 · 5 fps', width: 256, height: 144, fps: 5, colors: 48 },
};
// GitHub caps drag-and-drop image uploads at 10 MB; committed files may be larger but load slowly.
export const README_SIZE_LIMIT = 10 * 1024 * 1024;

export const VIDEO_PRESETS = {
  p720: { label: '1280×720 · 30 fps', width: 1280, height: 720, fps: 30, bitrate: 6_000_000 },
  p1080: { label: '1920×1080 · 30 fps', width: 1920, height: 1080, fps: 30, bitrate: 10_000_000 },
  p480: { label: '854×480 · 30 fps', width: 854, height: 480, fps: 30, bitrate: 3_000_000 },
};
