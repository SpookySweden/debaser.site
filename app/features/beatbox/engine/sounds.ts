// The sounds a channel can have: BeepBox's own instrument types and waves, under plain names. The chosen sound is kept in
// the song as BeepBox's own instrument settings, so saved songs, share links and sound files all carry it.
import { Config, Instrument } from "beepbox";

interface SoundRecipe {
  readonly id: string;
  readonly label: string;
  /** BeepBox's name for the instrument type. */
  readonly type: string;
  /** BeepBox's name for the wave, for the types that have one. */
  readonly wave?: string;
}

const TUNE_SOUNDS: readonly SoundRecipe[] = [
  { id: "rounded", label: "Round", type: "chip", wave: "rounded" },
  { id: "triangle", label: "Triangle", type: "chip", wave: "triangle" },
  { id: "square", label: "Square", type: "chip", wave: "square" },
  { id: "pulse-4", label: "Thin pulse", type: "chip", wave: "1/4 pulse" },
  { id: "pulse-8", label: "Thinner pulse", type: "chip", wave: "1/8 pulse" },
  { id: "sawtooth", label: "Saw", type: "chip", wave: "sawtooth" },
  { id: "double-saw", label: "Double saw", type: "chip", wave: "double saw" },
  { id: "double-pulse", label: "Double pulse", type: "chip", wave: "double pulse" },
  { id: "spiky", label: "Spiky", type: "chip", wave: "spiky" },
  { id: "fm", label: "FM", type: "FM" },
  { id: "harmonics", label: "Harmonics", type: "harmonics" },
  { id: "pwm", label: "Pulse width", type: "PWM" },
  { id: "string", label: "Plucked string", type: "Picked String" },
  { id: "supersaw", label: "Supersaw", type: "supersaw" },
  { id: "spectrum", label: "Spectrum", type: "spectrum" },
];

const DRUM_SOUNDS: readonly SoundRecipe[] = [
  { id: "retro", label: "Retro", type: "noise", wave: "retro" },
  { id: "white", label: "White noise", type: "noise", wave: "white" },
  { id: "clang", label: "Clang", type: "noise", wave: "clang" },
  { id: "buzz", label: "Buzz", type: "noise", wave: "buzz" },
  { id: "hollow", label: "Hollow", type: "noise", wave: "hollow" },
  { id: "spectrum", label: "Spectrum", type: "spectrum" },
  { id: "drumset", label: "Drum set", type: "drumset" },
];

export interface SoundChoice {
  readonly value: string;
  readonly label: string;
}

/** What a channel can be set to. Drum channels have their own list: BeepBox won't play the others on them. */
export function soundChoices(isDrum: boolean): readonly SoundChoice[] {
  return (isDrum ? DRUM_SOUNDS : TUNE_SOUNDS).map(({ id, label }) => ({ value: id, label }));
}

interface InstrumentSettings {
  readonly type?: unknown;
  readonly wave?: unknown;
  readonly volume?: unknown;
  readonly pan?: unknown;
}

/** Which sound these settings are, or null for one a song brought with it that isn't on the list. */
export function soundIdOf(settings: object | undefined, isDrum: boolean): string | null {
  const { type, wave } = (settings ?? {}) as InstrumentSettings;
  const match = (isDrum ? DRUM_SOUNDS : TUNE_SOUNDS).find(
    (sound) => sound.type === type && (sound.wave === undefined || sound.wave === wave),
  );
  return match?.id ?? null;
}

/** BeepBox's settings for a sound. It keeps how loud and where in the stereo the channel was. */
export function makeSound(id: string, isDrum: boolean, keepFrom: object | undefined): object {
  const recipe = (isDrum ? DRUM_SOUNDS : TUNE_SOUNDS).find((sound) => sound.id === id);
  if (!recipe) throw new Error(`There's no sound called ${id}.`);
  const type = Config.instrumentTypeNames.indexOf(recipe.type);
  if (type === -1) throw new Error(`BeepBox has no instrument type called ${recipe.type}.`);
  const instrument = new Instrument(isDrum);
  instrument.setTypeAndReset(type, isDrum);
  if (recipe.wave !== undefined) {
    const waves = isDrum ? Config.chipNoises : Config.chipWaves;
    const wave = waves.dictionary[recipe.wave];
    if (!wave) throw new Error(`BeepBox has no wave called ${recipe.wave}.`);
    if (isDrum) instrument.chipNoise = wave.index;
    else instrument.chipWave = wave.index;
  }
  const { volume, pan } = (keepFrom ?? {}) as InstrumentSettings;
  return { ...(instrument.toJsonObject() as object), ...(volume === undefined ? {} : { volume }), ...(pan === undefined ? {} : { pan }) };
}
