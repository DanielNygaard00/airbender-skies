/**
 * The browser globals three.js needs in order to decode an embedded texture, so that tests can
 * keep loading the committed model in the `node` environment.
 *
 * Two tests load `public/models/character.glb` for real and measure the skeleton it produces —
 * that is the only way to catch a replacement model whose bones are named differently or whose
 * clips are timed differently, and it is worth keeping. It worked without any of this until the
 * model gained a texture, because the previous one had none: `images: []`, so `GLTFLoader` never
 * entered its image path. The character pack embeds one 1024-pixel atlas, and that path opens
 * with `self.URL`, wraps the buffer view in a `Blob`, and hands the object URL to a loader —
 * none of which exists in `node`.
 *
 * `jsdom` was the alternative and it is the wrong tool: it would supply `self` and `Image` but
 * still cannot decode a PNG, so the decode would fail slightly later and much less clearly, and
 * every test in the suite would pay for a DOM none of the other 132 files want.
 *
 * So the decode is stubbed rather than performed. `createImageBitmap` existing at all is what
 * routes three.js to `ImageBitmapLoader`, and returning a 1x1 placeholder is enough: the tests
 * measure bone transforms and clip plans, and not one of them looks at a pixel. A test that ever
 * does needs a real renderer, which this environment could not give it either way.
 */
const globals = globalThis as Record<string, unknown>

globals['self'] ??= globalThis
globals['createImageBitmap'] ??= (): Promise<{
  width: number
  height: number
  close: () => void
}> => Promise.resolve({ width: 1, height: 1, close: () => {} })
