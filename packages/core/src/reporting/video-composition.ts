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

async function encodeClips(clips: readonly VideoClip[], output: string, ffmpegPath: string): Promise<void> {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
  for (const clip of clips) {
    args.push('-ss', clip.offset.toFixed(3), '-i', clip.path);
  }
  const filters = clips.map((clip, index) =>
    `[${index}:v]setpts=PTS-STARTPTS,` +
    'scale=1280:720:force_original_aspect_ratio=decrease,' +
    'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,' +
    `fps=25,tpad=stop_mode=clone:stop_duration=${clip.duration.toFixed(3)},` +
    `trim=duration=${clip.duration.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`,
  );
  filters.push(clips.map((_, index) => `[v${index}]`).join('') +
    `concat=n=${clips.length}:v=1:a=0[out]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-an',
    '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-threads', '2',
    '-b:v', '2M', output);
  await execFileAsync(ffmpegPath, args, { timeout: 120_000, maxBuffer: 1024 * 1024 });
}
