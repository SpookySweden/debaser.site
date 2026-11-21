import { pointerLook, type PictureBox, type PointerShape } from './wire';

/**
 * SCREENS, THE PC'S POINTER, ported from the engine's own viewer page (`engine/web/viewer.html`, that part of
 * CONTROL): while this device holds control in POINTER mode, its own pointer over the picture takes the shape the
 * PC's pointer has (an arrow, a text bar, a hand, a resize arrow), and hides when the PC hides its own. The stream
 * carries no pointer; the PC sends each new shape as pixels on the `keys` channel (`pointerShapeFrom` in wire.ts).
 *
 * When this device is not controlling, nothing here changes anything: the picture keeps the site's own pointer.
 * The shape is the PC's own picture of its pointer, scaled; nothing is drawn here that the PC did not send.
 */

export type PointerShapeLinks = {
  /** The picture's box: the element whose pointer is set. */
  stage: HTMLElement;
  /** This device holds control, with the mouse in POINTER mode. */
  pointing: () => boolean;
  /** Where the picture really is on the page. */
  pictureBox: () => PictureBox | null;
  /** How wide the piece of the PC's screen being sent is, in the PC's pixels; 0 when not known. */
  regionWidth: () => number;
};

/** What this device's pointer over the picture is now. */
export type PointerUse = 'none' | 'shape' | 'arrow' | 'hidden';

export class ScreenPointerShape {
  /** 'none': not controlling, the site's own pointer. 'arrow': the plain arrow, and `why`. */
  use: PointerUse = 'none';
  why = '';

  /** The PC is showing its pointer (false: a game or a film has hidden it). */
  private shown = true;
  private shape: PointerShape | null = null;
  /** The shape at its own size, on a canvas. */
  private picture: HTMLCanvasElement | null = null;
  /** Which scaled picture `address` holds ("number width height"), and that picture as a "data:" address. */
  private made = '';
  private address = '';
  /** The pointer style last put on the picture. */
  private css = '';

  constructor(private readonly links: PointerShapeLinks) {}

  /** `81`: the PC's pointer is showing, or hidden. */
  heardShown(shown: boolean): void {
    this.shown = shown;
    this.show();
  }

  /** `82`: a new shape. */
  heardShape(shape: PointerShape): void {
    this.shape = shape;
    this.picture = null;
    if (shape.pixels !== null) {
      const canvas = document.createElement('canvas');
      canvas.width = shape.width;
      canvas.height = shape.height;
      canvas.getContext('2d')?.putImageData(new ImageData(shape.pixels, shape.width, shape.height), 0, 0);
      this.picture = canvas;
    }
    this.show();
  }

  /**
   * Sets this device's pointer over the picture. Called whenever anything it depends on changes: a new shape, the PC
   * hiding or showing its pointer, control beginning or ending, the kind of mouse, the picture moving or changing
   * size, the piece of the PC's screen being sent.
   */
  show(): void {
    let use: PointerUse = 'none';
    let css = '';
    let why = '';
    if (this.links.pointing()) {
      if (!this.shown) {
        use = 'hidden';
        css = 'none';
      } else {
        // One pixel of the PC's screen is this many page pixels, the way the picture is being shown now.
        const box = this.links.pictureBox();
        const across = this.links.regionWidth();
        const look = pointerLook(this.picture === null && this.shape !== null ? { ...this.shape, pixels: null } : this.shape, box !== null && across > 0 ? box.width / across : 1);
        if (look.use === 'arrow' || this.picture === null || this.shape === null) {
          use = 'arrow';
          css = 'default';
          why = look.use === 'arrow' ? look.why : '';
        } else {
          const made = `${this.shape.number} ${look.width} ${look.height}`;
          if (this.made !== made) {
            const canvas = document.createElement('canvas');
            canvas.width = look.width;
            canvas.height = look.height;
            const pen = canvas.getContext('2d');
            if (pen !== null) {
              // At its own size the pixels are copied as they are; at any other they are smoothed.
              pen.imageSmoothingEnabled = look.width !== this.shape.width || look.height !== this.shape.height;
              pen.imageSmoothingQuality = 'high';
              pen.drawImage(this.picture, 0, 0, look.width, look.height);
            }
            this.address = canvas.toDataURL('image/png');
            this.made = made;
          }
          use = 'shape';
          css = `url(${this.address}) ${look.hotX} ${look.hotY}, default`;
        }
      }
    }
    if (css !== this.css) {
      this.links.stage.style.cursor = css;
      this.css = css;
    }
    this.use = use;
    this.why = why;
  }

  /** Gives the picture its own pointer back. */
  stop(): void {
    if (this.css !== '') this.links.stage.style.cursor = '';
    this.css = '';
    this.use = 'none';
    this.why = '';
  }
}
