/**
 * Butterchurn (github.com/jberg/butterchurn, MIT): Milkdrop's visualiser in WebGL 2. The packages ship no types; these are
 * the few calls the stream room's visualiser makes (RoomVisualiser.tsx).
 */
declare module 'butterchurn' {
  /** One frame of sound, as bytes resting at 128: both channels together, then left and right (1024 samples each). */
  export type ButterchurnSound = { timeByteArray: Uint8Array; timeByteArrayL: Uint8Array; timeByteArrayR: Uint8Array };
  export type ButterchurnVisualizer = {
    connectAudio(node: AudioNode): void;
    disconnectAudio(node: AudioNode): void;
    loadPreset(preset: object, blendSeconds: number): void;
    setRendererSize(width: number, height: number): void;
    /**
     * Draws a frame. Given `audioLevels` it uses that sound instead of sampling a connected node; given `elapsedTime`
     * (seconds since the last frame) it runs its clock by that instead of the wall clock.
     */
    render(options?: { audioLevels?: ButterchurnSound; elapsedTime?: number }): void;
  };
  const butterchurn: {
    createVisualizer(context: AudioContext, canvas: HTMLCanvasElement, options: { width: number; height: number; pixelRatio?: number }): ButterchurnVisualizer;
  };
  export default butterchurn;
}

declare module 'butterchurn-presets' {
  const presets: { getPresets(): Record<string, object> };
  export default presets;
}
