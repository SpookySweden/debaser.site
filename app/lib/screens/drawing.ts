import { fittedBox, type PictureBox } from './wire';
import type { Drawing, Upscaling } from './wishes';

/**
 * SCREENS: how this device draws the picture it is sent, ported from the engine's own viewer page
 * (`engine/web/viewer.html`, its DRAWING part). Nothing here reaches the PC.
 *
 * Two ways. FAST: each frame is taken straight off the stream the moment it is decoded and drawn on ONE canvas that
 * asks the browser to skip its own drawing queue. NORMAL: the browser's own <video> element. FAST is used wherever
 * the browser can do it; where it cannot, the picture is drawn NORMAL and one line says why.
 *
 * Four ways of fitting the picture to its box (UPSCALING), each of which works either way of drawing: OFF (real
 * size, in the middle), SMOOTH (stretched softly), SHARP (stretched in hard squares), SHARPENED (stretched, then
 * sharpened by a small shader).
 *
 * The shaders below draw the stream's own frames and nothing else: no picture is made here.
 */

export type DrawingParts = {
  /** The box the picture is fitted into. */
  stage: HTMLElement;
  /** Receives the stream either way (it is what the browser's own numbers hang off); shown only in NORMAL. */
  video: HTMLVideoElement;
  /** FAST's one canvas. */
  fastCanvas: HTMLCanvasElement;
  /** NORMAL's sharpening canvas, over the <video>. */
  sharpCanvas: HTMLCanvasElement;
};

// One triangle that covers the whole canvas, made from the corner's number alone; both shaders below sit on it.
const VERTEX = `#version 300 es
out vec2 at;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  at = vec2(corner.x, 1.0 - corner.y);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;
// The frame as it is.
const PLAIN = `#version 300 es
precision mediump float;
uniform sampler2D frame;
in vec2 at;
out vec4 colour;
void main() {
  colour = vec4(texture(frame, at).rgb, 1.0);
}`;
// SHARPENED: reads the pixel and its four neighbours, looks at how much contrast is already there, and pushes the
// pixel away from its neighbours' average by an amount that shrinks where the contrast is already strong (so
// edges gain bite without bright halos).
const SHARPEN = `#version 300 es
precision mediump float;
uniform sampler2D frame;
uniform vec2 pixel;     // one pixel of the stream, in the picture's own 0-to-1 measure
uniform float strength; // the most that is taken from each neighbour
in vec2 at;
out vec4 colour;
void main() {
  vec3 here = texture(frame, at).rgb;
  vec3 up = texture(frame, at - vec2(0.0, pixel.y)).rgb;
  vec3 down = texture(frame, at + vec2(0.0, pixel.y)).rgb;
  vec3 left = texture(frame, at - vec2(pixel.x, 0.0)).rgb;
  vec3 right = texture(frame, at + vec2(pixel.x, 0.0)).rgb;
  vec3 darkest = min(here, min(min(up, down), min(left, right)));
  vec3 brightest = max(here, max(max(up, down), max(left, right)));
  // The room left before black or white would clip, as a share of the brightest: little room, little sharpening.
  vec3 room = clamp(min(darkest, 1.0 - brightest) / max(brightest, vec3(0.001)), 0.0, 1.0);
  vec3 pull = -sqrt(room) * strength;
  colour = vec4(clamp((here + pull * (up + down + left + right)) / (1.0 + 4.0 * pull), 0.0, 1.0), 1.0);
}`;
const SHARPEN_STRENGTH = 0.2;

/** Builds one of the shaders above on a canvas's graphics. Null when the device will not take it. */
function makeProgram(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram | null {
  const compile = (kind: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(kind);
    if (shader === null) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (vertex === null || fragment === null) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'frame'), 0);
  const strength = gl.getUniformLocation(program, 'strength');
  if (strength !== null) gl.uniform1f(strength, SHARPEN_STRENGTH);
  return program;
}

/** The one texture a canvas's graphics keep the newest frame in. */
function makeFrameTexture(gl: WebGL2RenderingContext): void {
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** The browser's way of handing a page each decoded frame (Chrome and Edge); not in every browser, nor in TypeScript's list. */
type FrameSource = { readable: ReadableStream<VideoFrame> };
type FrameSourceMaker = new (init: { track: MediaStreamTrack }) => FrameSource;
const frameSourceMaker = (): FrameSourceMaker | undefined => (window as unknown as { MediaStreamTrackProcessor?: FrameSourceMaker }).MediaStreamTrackProcessor;

const px = (value: number): string => `${value}px`;

export class ScreenDrawing {
  /** What is really in use. */
  shown: Drawing = 'normal';
  /** Why FAST is not in use, when it was wanted. */
  note = '';
  /** What is really in use (in NORMAL, SHARPENED falls back to SMOOTH where it cannot run). */
  upscalingShown: Upscaling = 'smooth';
  upscalingNote = '';
  /** Whether the browser gave FAST's canvas its "skip the queue" kind (null: FAST never set up). */
  lowLatency: boolean | null = null;
  /** Frames FAST has drawn. */
  framesDrawn = 0;

  private track: MediaStreamTrack | null = null;
  private wanted: Drawing = 'fast';
  private upscalingWanted: Upscaling = 'smooth';
  private stopped = false;

  private fastGl: WebGL2RenderingContext | null = null;
  private fastPlain: WebGLProgram | null = null;
  private fastSharpen: WebGLProgram | null = null;
  private fastSharpenPixel: WebGLUniformLocation | null = null;
  private fastReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  /** The size of the newest frame FAST drew. */
  private wide = 0;
  private tall = 0;
  /** Why FAST can no longer run on this device, once it cannot. */
  private fastBroken = '';

  private sharpGl: WebGL2RenderingContext | null = null;
  private sharpPixel: WebGLUniformLocation | null = null;
  private sharpRunning = false;

  constructor(
    private readonly parts: DrawingParts,
    /** Called when what is really in use changed, or the first frame was drawn. */
    private readonly onChanged: () => void,
    private readonly onFirstFrame: () => void,
  ) {
    parts.fastCanvas.addEventListener('webglcontextlost', this.fastLost);
    parts.sharpCanvas.addEventListener('webglcontextlost', this.sharpLost);
  }

  /** The stream's video, once it has arrived. */
  setTrack(track: MediaStreamTrack | null): void {
    this.track = track;
    this.stopFastReader();
    this.show(this.wanted, this.upscalingWanted);
  }

  /** Lets go of everything: the frame reader, the redraw loop, the listeners. */
  stop(): void {
    this.stopped = true;
    this.stopFastReader();
    this.sharpRunning = false;
    this.track = null;
    this.parts.fastCanvas.removeEventListener('webglcontextlost', this.fastLost);
    this.parts.sharpCanvas.removeEventListener('webglcontextlost', this.sharpLost);
  }

  // If the device takes the graphics away (a driver restart, too many tabs), the browser's own player takes over.
  private readonly fastLost = () => {
    this.fastGl = null;
    this.fastBroken = 'this device took the graphics away';
    this.show(this.wanted, this.upscalingWanted);
  };

  private readonly sharpLost = () => {
    this.sharpGl = null;
    if (this.upscalingWanted === 'sharpened') this.show(this.wanted, this.upscalingWanted);
  };

  /* --- FAST ------------------------------------------------------------------------------------ */

  /** Sets FAST up once. Returns '' when it can run, or why it cannot. */
  private prepareFast(): string {
    if (this.fastBroken) return this.fastBroken;
    if (this.fastGl !== null) return '';
    if (frameSourceMaker() === undefined) return 'this browser does not hand decoded frames to a page';
    // "desynchronized" is the request to skip the browser's own drawing queue; a browser may say no and still draw.
    const gl = this.parts.fastCanvas.getContext('webgl2', { desynchronized: true, alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (gl === null) return 'this browser has no WebGL2';
    this.fastPlain = makeProgram(gl, PLAIN);
    this.fastSharpen = makeProgram(gl, SHARPEN);
    if (this.fastPlain === null || this.fastSharpen === null) return "this device's graphics would not take the drawing shaders";
    this.fastSharpenPixel = gl.getUniformLocation(this.fastSharpen, 'pixel');
    makeFrameTexture(gl);
    this.lowLatency = Boolean(gl.getContextAttributes()?.desynchronized);
    this.fastGl = gl;
    return '';
  }

  private drawFast(frame: VideoFrame): void {
    const gl = this.fastGl;
    if (gl === null) return;
    if (frame.displayWidth !== this.wide || frame.displayHeight !== this.tall) {
      // The stream changed size (its settings changed): the canvas is laid out again before this frame is drawn.
      this.wide = frame.displayWidth;
      this.tall = frame.displayHeight;
      this.layOut();
      this.onChanged();
    }
    gl.viewport(0, 0, this.parts.fastCanvas.width, this.parts.fastCanvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.flush();
    this.framesDrawn += 1;
    if (this.framesDrawn === 1) this.onFirstFrame();
  }

  /** Starts taking frames straight off the stream. Each is drawn and given back at once. */
  private startFastReader(): void {
    if (this.fastReader !== null || this.track === null) return;
    const Maker = frameSourceMaker();
    if (Maker === undefined) return;
    let reader: ReadableStreamDefaultReader<VideoFrame>;
    try {
      reader = new Maker({ track: this.track }).readable.getReader();
    } catch {
      this.fastBroken = "this browser would not hand over the stream's frames";
      this.show(this.wanted, this.upscalingWanted);
      return;
    }
    this.fastReader = reader;
    const read = async () => {
      for (;;) {
        const { value: frame, done } = await reader.read();
        if (done || frame === undefined) break;
        if (this.fastReader === reader) this.drawFast(frame);
        frame.close();
      }
    };
    read().catch(() => {
      /* the stream ended */
    });
  }

  private stopFastReader(): void {
    const reader = this.fastReader;
    if (reader === null) return;
    this.fastReader = null;
    reader.cancel().catch(() => {
      /* already over */
    });
  }

  /* --- NORMAL's sharpening: a second canvas over the <video> element, redrawn from it at every frame it shows. */

  /** Sets it up once. Returns '' when it can run, or why it cannot. */
  private prepareSharpen(): string {
    if (this.sharpGl !== null) return '';
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return 'this browser does not hand video frames to a page';
    const gl = this.parts.sharpCanvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
    if (gl === null) return 'this browser has no WebGL2';
    const program = makeProgram(gl, SHARPEN);
    if (program === null) return "this device's graphics would not take the sharpening shader";
    makeFrameTexture(gl);
    this.sharpPixel = gl.getUniformLocation(program, 'pixel');
    this.sharpGl = gl;
    return '';
  }

  private drawSharpened(): void {
    const gl = this.sharpGl;
    const { video, sharpCanvas } = this.parts;
    if (gl === null || !video.videoWidth) return;
    gl.viewport(0, 0, sharpCanvas.width, sharpCanvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform2f(this.sharpPixel, 1 / video.videoWidth, 1 / video.videoHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private readonly sharpenEveryFrame = () => {
    if (!this.sharpRunning || this.stopped) return;
    this.drawSharpened();
    this.parts.video.requestVideoFrameCallback(this.sharpenEveryFrame);
  };

  /* --- both ways ------------------------------------------------------------------------------- */

  /** The size of the picture as it arrives. */
  pictureSize(): { wide: number; tall: number } {
    if (this.shown === 'fast' && this.wide) return { wide: this.wide, tall: this.tall };
    return { wide: this.parts.video.videoWidth, tall: this.parts.video.videoHeight };
  }

  /** Sizes whatever is drawing the picture, for the way of fitting in use. */
  layOut(): void {
    const { stage, video, fastCanvas, sharpCanvas } = this.parts;
    const ratio = window.devicePixelRatio || 1;
    const size = this.pictureSize();
    const have = size.wide > 0 && size.tall > 0;
    const fit = have ? Math.min(stage.clientWidth / size.wide, stage.clientHeight / size.tall) : 0;
    const isFast = this.shown === 'fast';
    const mode = this.upscalingShown;

    // NORMAL, OFF: the <video> element at one stream pixel to one screen pixel.
    video.style.width = !isFast && mode === 'off' && have ? px(size.wide / ratio) : '';
    video.style.height = !isFast && mode === 'off' && have ? px(size.tall / ratio) : '';

    // NORMAL, SHARPENED: its canvas takes the place the picture would fill, one canvas pixel per screen pixel.
    const sharpening = !isFast && mode === 'sharpened' && have;
    sharpCanvas.hidden = !sharpening;
    if (sharpening) {
      sharpCanvas.style.width = px(size.wide * fit);
      sharpCanvas.style.height = px(size.tall * fit);
      sharpCanvas.width = Math.max(2, Math.round(size.wide * fit * ratio));
      sharpCanvas.height = Math.max(2, Math.round(size.tall * fit * ratio));
    }

    // FAST: the one canvas. For OFF, SMOOTH and SHARP it holds the frame at its own size and the page places it
    // (real size in the middle, or stretched to fit, softly or in hard squares). For SHARPENED it is exactly the
    // size the picture is shown at, and the shader does the stretching and the sharpening in one go.
    fastCanvas.hidden = !(isFast && have);
    if (isFast && have && this.fastGl !== null) {
      const shaded = mode === 'sharpened';
      const wide = shaded ? Math.max(2, Math.round(size.wide * fit * ratio)) : size.wide;
      const tall = shaded ? Math.max(2, Math.round(size.tall * fit * ratio)) : size.tall;
      // (Setting a canvas's size wipes it, so it is only set when it changes.)
      if (fastCanvas.width !== wide) fastCanvas.width = wide;
      if (fastCanvas.height !== tall) fastCanvas.height = tall;
      fastCanvas.style.width = shaded ? px(size.wide * fit) : mode === 'off' ? px(size.wide / ratio) : '';
      fastCanvas.style.height = shaded ? px(size.tall * fit) : mode === 'off' ? px(size.tall / ratio) : '';
      this.fastGl.useProgram(shaded ? this.fastSharpen : this.fastPlain);
      if (shaded) this.fastGl.uniform2f(this.fastSharpenPixel, 1 / size.wide, 1 / size.tall);
    }
  }

  /** Where the picture really is on the page, whichever way it is being drawn (CONTROL's pointer needs to know). */
  pictureBox(): PictureBox | null {
    const { video, fastCanvas, sharpCanvas } = this.parts;
    const size = this.pictureSize();
    if (!size.wide || !size.tall) return null;
    const element = this.shown === 'fast' ? fastCanvas : sharpCanvas.hidden ? video : sharpCanvas;
    const rect = element.getBoundingClientRect();
    const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    // At its real size, or on a canvas made exactly as large as the picture is shown: the element IS the picture.
    if (this.upscalingShown === 'off' || (this.upscalingShown === 'sharpened' && element !== video)) return box;
    // Otherwise the picture is fitted inside the element, in its middle.
    return fittedBox(box, size.wide, size.tall);
  }

  /**
   * How an element that draws the picture sits in the stage: filling it and fitted inside (SMOOTH, SHARP), or in
   * the middle at a size of its own (OFF; SHARPENED on FAST's canvas), softly or in hard squares.
   */
  private place(element: HTMLElement, middle: boolean, squares: boolean): void {
    element.style.left = middle ? '50%' : '';
    element.style.top = middle ? '50%' : '';
    element.style.transform = middle ? 'translate(-50%, -50%)' : '';
    element.style.objectFit = middle ? 'fill' : '';
    element.style.imageRendering = squares ? 'pixelated' : '';
  }

  /** Puts the chosen ways of drawing and fitting into effect. Called whenever anything they depend on changes. */
  show(wanted: Drawing, upscaling: Upscaling): void {
    if (this.stopped) return;
    this.wanted = wanted;
    this.upscalingWanted = upscaling;

    let way = wanted;
    this.note = '';
    if (way === 'fast') {
      const why = this.prepareFast();
      if (why) {
        way = 'normal';
        this.note = `FAST cannot run here (${why}), so the picture is drawn NORMAL instead.`;
      }
    }
    this.shown = way;

    let mode = upscaling;
    this.upscalingNote = '';
    if (mode === 'sharpened' && way === 'normal') {
      const why = this.prepareSharpen();
      if (why) {
        mode = 'smooth';
        this.upscalingNote = `SHARPENED cannot run here (${why}), so the picture is drawn SMOOTH instead.`;
      }
    }
    this.upscalingShown = mode;

    const { video, fastCanvas, sharpCanvas } = this.parts;
    this.place(video, mode === 'off', mode === 'sharp');
    this.place(fastCanvas, mode === 'off' || mode === 'sharpened', mode === 'sharp');
    // In FAST the <video> element still receives the stream but is not shown.
    video.style.visibility = way === 'fast' ? 'hidden' : '';
    this.layOut();

    if (way === 'fast') this.startFastReader();
    else this.stopFastReader();
    const sharpening = way === 'normal' && mode === 'sharpened' && !sharpCanvas.hidden;
    if (sharpening && !this.sharpRunning) {
      this.sharpRunning = true;
      video.requestVideoFrameCallback(this.sharpenEveryFrame);
    }
    if (!sharpening) this.sharpRunning = false;
    this.onChanged();
  }
}
