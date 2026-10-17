// No runtime imports: `node --test` runs this straight from source.

/** Netlify `_headers`: long cache for the immutable media, no indexing, no framing. */
export function headersFile(): string {
  return [
    '# Media files are content-addressed by the build; cache them for good.',
    '/media/*.mp4',
    '  Content-Type: video/mp4',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/media/*.webm',
    '  Content-Type: video/webm',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/media/*.png',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/media/*.jpg',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/*',
    '  X-Robots-Tag: noindex',
    '  X-Frame-Options: DENY',
    '',
  ].join('\n');
}

/**
 * A `netlify.toml` that publishes the folder as it is. The Next.js plugin is switched off because
 * Netlify injects it whenever a `package.json` with `next` sits above the folder, and it refuses a
 * static publish directory.
 */
export function netlifyToml(): string {
  return [
    '# Static evidence site: publish this folder as it is, nothing is built.',
    '[build]',
    '  publish = "."',
    '  command = "true"',
    '',
    '[build.environment]',
    '  NETLIFY_NEXT_PLUGIN_SKIP = "true"',
    '',
  ].join('\n');
}
