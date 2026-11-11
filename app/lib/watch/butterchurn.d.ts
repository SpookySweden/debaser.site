/**
 * Butterchurn (github.com/jberg/butterchurn, MIT): Milkdrop's visualiser in WebGL 2. The packages ship no types; these are
 * the few calls the stream room's visualiser makes (RoomVisualiser.tsx).
 */
declare module 'butterchurn' {
  export type ButterchurnVisualizer = {
    connectAudio(node: AudioNode): void;
    disconnectAudio(node: AudioNode): void;
    loadPreset(preset: object, blendSeconds: number): void;
    setRendererSize(width: number, height: number): void;
    render(): void;
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
