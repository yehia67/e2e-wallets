export interface VideoSegment<T> {
  source: T;
  /** Milliseconds on the shared monotonic clock. */
  start: number;
  end: number;
}

/** Tracks activity, not page lifetime: an idle wallet tab must not hide the app. */
export class VideoTimeline<T> {
  private history: T[] = [];
  private segments: VideoSegment<T>[] = [];
  private active: { source: T; start: number } | undefined;

  activate(source: T, at: number): void {
    if (this.active?.source === source) return;
    this.flush(at);
    this.history = this.history.filter((entry) => entry !== source);
    this.history.push(source);
    this.active = { source, start: at };
  }

  close(source: T, at: number): void {
    this.history = this.history.filter((entry) => entry !== source);
    if (this.active?.source !== source) return;
    this.flush(at);
    this.active = undefined;
    const previous = this.history.at(-1);
    if (previous !== undefined) this.activate(previous, at);
  }

  finish(at: number): VideoSegment<T>[] {
    this.flush(at);
    this.active = undefined;
    return [...this.segments];
  }

  private flush(at: number): void {
    if (this.active && at > this.active.start) {
      this.segments.push({ ...this.active, end: at });
    }
  }
}
