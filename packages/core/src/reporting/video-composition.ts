import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);

export interface VideoClip {
  path: string;
  /** Offset into this page's own video, in seconds. */
  offset: number;
  duration: number;
}

/** Encode bounded batches so long tests don't open hundreds of decoders simultaneously. */
export async function composeVideo(
  clips: readonly VideoClip[],
  output: string,
  ffmpegPath = 'ffmpeg',
): Promise<void> {
  if (clips.length === 0) throw new Error('No visual pages were recorded.');
  if (clips.length <= 8) return encodeClips(clips, output, ffmpegPath);
  const scratch = await mkdtemp(join(dirname(output), 'video-parts-'));
  try {
    const parts: string[] = [];
    for (let index = 0; index < clips.length; index += 8) {
      const name = `part-${index}.webm`;
      await encodeClips(clips.slice(index, index + 8), join(scratch, name), ffmpegPath);
      parts.push(`file '${name}'`);
    }
    const list = join(scratch, 'parts.txt');
    await writeFile(list, parts.join('\n'));
    await execFileAsync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', output], { timeout: 120_000 });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * The content region of a clip as an ffmpeg `crop`, or undefined when the frame is all
 * content.
 *
 * Chromium's video capture can paint a page into part of the canvas and fill the rest
 * with flat mid-grey (128,128,128) — a block down one side of every frame. The cause is
 * below Playwright, in how the compositor and the canvas agree on size, so the border is
 * measured and removed instead.
 *
 * `cropdetect`'s limit is the value at or below which a pixel counts as border, and it
 * only ever crops inward from the edges across whole rows and columns. A limit above the
 * grey catches it while leaving any page whose edges are lighter untouched.
 */
async function detectContentCrop(
  clip: string,
  ffmpegPath: string,
  at: number,
): Promise<string | undefined> {
  // One frame, from a point where the layout has settled.
  //
  // `cropdetect` accumulates the union of everything it sees, so across many frames a
  // single fully painted one — a loading screen, a modal backdrop — reports "no border"
  // for the whole clip. Sampling one settled frame measures the border that is actually
  // there for the rest of it.
  const { stderr } = await execFileAsync(ffmpegPath, [
    '-hide_banner', '-nostdin', '-ss', at.toFixed(3), '-i', clip, '-frames:v', '1',
    '-vf', `cropdetect=limit=${GREY_BORDER_LIMIT}:round=2:reset=1`,
    '-f', 'null', '-',
  ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }).catch((error: unknown) => ({
    stderr: (error as { stderr?: string }).stderr ?? '',
  }));

  const last = [...String(stderr).matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].at(-1);
  if (!last) return undefined;
  const [, w, h, x, y] = last;

  // A dark page is border-coloured all over and would "detect" as almost nothing. Refuse
  // any crop that throws most of the frame away: an uncropped clip beats a destroyed one.
  const probe = [...String(stderr).matchAll(/w:(\d+) h:(\d+)/g)].at(-1);
  if (probe) {
    const [, fullW, fullH] = probe.map(Number) as unknown as [string, number, number];
    if (Number(w) < fullW * 0.5 || Number(h) < fullH * 0.5) return undefined;
  }
  if (Number(w) <= 0 || Number(h) <= 0) return undefined;

  return `crop=${w}:${h}:${x}:${y}`;
}

/** Chromium's unpainted-canvas grey is (128,128,128); sit just above it. */
const GREY_BORDER_LIMIT = 130;

async function encodeClips(clips: readonly VideoClip[], output: string, ffmpegPath: string): Promise<void> {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
  for (const clip of clips) {
    args.push('-ss', clip.offset.toFixed(3), '-i', clip.path);
  }
  const crops = await Promise.all(
    clips.map((clip) => detectContentCrop(clip.path, ffmpegPath, clip.offset + clip.duration / 2)),
  );
  const filters = clips.map((clip, index) =>
    `[${index}:v]setpts=PTS-STARTPTS,` +
    (crops[index] ? `${crops[index]},` : '') +
    'scale=1280:720:force_original_aspect_ratio=decrease,' +
    'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,' +
    `fps=25,tpad=stop_mode=clone:stop_duration=${clip.duration.toFixed(3)},` +
    `trim=duration=${clip.duration.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`,
  );
  filters.push(clips.map((_, index) => `[v${index}]`).join('') +
    `concat=n=${clips.length}:v=1:a=0[out]`);
  // VP9 at a constant quality rather than VP8 at a fixed bitrate. These recordings are
  // screen content — small text on flat colour — which a 2Mbps VP8 stream smears badly,
  // and `-deadline realtime -cpu-used 8` is the live-streaming preset: the fastest and
  // worst libvpx offers. `good`/`cpu-used 3` with row threading keeps composition to a
  // few seconds for a minute of footage while leaving the UI legible.
  args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-an',
    '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
    '-deadline', 'good', '-cpu-used', '3', '-row-mt', '1', '-threads', '4',
    '-pix_fmt', 'yuv420p', output);
  await execFileAsync(ffmpegPath, args, { timeout: 120_000, maxBuffer: 1024 * 1024 });
}
