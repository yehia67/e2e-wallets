// No runtime imports: `node --test` runs this straight from source, where `.js` specifiers cannot
// be resolved onto `.ts` files, so the pure parts of the screenshot video live here.
import type { ScreenshotVideoOptions } from './artifacts.js';

/** One captured frame: its file name inside the frames directory and when it was taken (ms). */
export interface FrameEntry {
  file: string;
  at: number;
}

/**
 * The ffmpeg concat list for the frames: each frame shown for as long as it was current, and the
 * last one held for `tailMs` so the end state stays readable. The final `file` line repeats the
 * last frame, which is what the concat demuxer needs to honour the last duration.
 */
export function buildConcatList(frames: readonly FrameEntry[], tailMs: number): string {
  const lines = frames.map((frame, index) => {
    const next = frames[index + 1];
    const duration = next ? (next.at - frame.at) / 1000 : tailMs / 1000;
    return `file '${frame.file}'\nduration ${Math.max(duration, 0.001).toFixed(3)}`;
  });
  const last = frames.at(-1);
  if (last) lines.push(`file '${last.file}'`);
  return lines.join('\n') + '\n';
}

/** ffmpeg arguments that encode a concat list into an H.264 mp4 browsers and reports can play. */
export function ffmpegEncodeArgs(
  list: string,
  output: string,
  options: Required<ScreenshotVideoOptions>,
): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'concat', '-safe', '0', '-i', list,
    // Odd dimensions are padded by a pixel: yuv420p needs even sizes.
    '-vf', `pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=${options.fps}`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(options.crf), '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    output,
  ];
}

