// The sounds a channel can have, in groups: BeepBox's own instrument list under plain names, and its plain waves. The chosen sound is
// kept in the song as BeepBox's own instrument settings, so saved songs, share links and sound files all carry it.
import { Config, Instrument } from "beepbox";
import { SOUND_BANK, type BankSound } from "./soundBank";

interface WaveRecipe {
  readonly id: string;
  readonly label: string;
  /** BeepBox's name for the instrument type. */
  readonly type: string;
  /** BeepBox's name for the wave, for the types that have one. */
  readonly wave?: string;
}

type SoundRecipe = WaveRecipe | BankSound;

interface RecipeGroup {
  readonly id: string;
  readonly label: string;
  /** The note a sound in this group is tried on: a bass low down, the drums on a sound that suits them. */
  readonly tryPitch: number;
  readonly sounds: readonly SoundRecipe[];
}

const TUNE_WAVES: readonly WaveRecipe[] = [
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

const DRUM_WAVES: readonly WaveRecipe[] = [
  { id: "retro", label: "Retro", type: "noise", wave: "retro" },
  { id: "white", label: "White noise", type: "noise", wave: "white" },
  { id: "clang", label: "Clang", type: "noise", wave: "clang" },
  { id: "buzz", label: "Buzz", type: "noise", wave: "buzz" },
  { id: "hollow", label: "Hollow", type: "noise", wave: "hollow" },
  { id: "spectrum", label: "Spectrum", type: "spectrum" },
  { id: "drumset", label: "Plain drum set", type: "drumset" },
];

const bank = (group: string): readonly BankSound[] => SOUND_BANK[group] ?? [];

const MIDDLE_C = 48;
const LOW_C = 24;
const KICK = 0;
const MID_DRUM = 6;

const TUNE_GROUPS: readonly RecipeGroup[] = [
  { id: "keys", label: "Keys", tryPitch: MIDDLE_C, sounds: bank("keys") },
  { id: "bass", label: "Bass", tryPitch: LOW_C, sounds: bank("bass") },
  { id: "plucked", label: "Plucked", tryPitch: MIDDLE_C, sounds: bank("plucked") },
  { id: "horns", label: "Horns", tryPitch: MIDDLE_C, sounds: bank("horns") },
  { id: "winds", label: "Winds", tryPitch: MIDDLE_C, sounds: bank("winds") },
  { id: "pads", label: "Pads", tryPitch: MIDDLE_C, sounds: bank("pads") },
  { id: "chip", label: "Chip", tryPitch: MIDDLE_C, sounds: [...TUNE_WAVES, ...bank("chip")] },
];

const DRUM_GROUPS: readonly RecipeGroup[] = [
  { id: "hits", label: "Hits", tryPitch: KICK, sounds: bank("hits") },
  { id: "noises", label: "Noises", tryPitch: MID_DRUM, sounds: [...DRUM_WAVES, ...bank("noises")] },
];

const groupsFor = (isDrum: boolean) => (isDrum ? DRUM_GROUPS : TUNE_GROUPS);

export interface SoundChoice {
  readonly value: string;
  readonly label: string;
}

export interface SoundGroup {
  readonly id: string;
  readonly label: string;
  readonly choices: readonly SoundChoice[];
}

/** What a channel can be set to, in groups. Drum channels have their own list: BeepBox won't play the others on them. */
export function soundGroups(isDrum: boolean): readonly SoundGroup[] {
  return groupsFor(isDrum).map(({ id, label, sounds }) => ({
    id,
    label,
    choices: sounds.map((sound) => ({ value: sound.id, label: sound.label })),
  }));
}

function findRecipe(id: string, isDrum: boolean): SoundRecipe | undefined {
  for (const group of groupsFor(isDrum)) {
    const found = group.sounds.find((sound) => sound.id === id);
    if (found) return found;
  }
  return undefined;
}

/** The group a sound is in, or the first one for a sound that isn't on the list. */
export function groupOfSound(id: string | null, isDrum: boolean): string {
  const groups = groupsFor(isDrum);
  return (groups.find((group) => group.sounds.some((sound) => sound.id === id)) ?? groups[0])?.id ?? "";
}

/** Which pitch to try a sound on. */
export function tryPitchOf(id: string, isDrum: boolean): number {
  return groupsFor(isDrum).find((group) => group.sounds.some((sound) => sound.id === id))?.tryPitch ?? (isDrum ? KICK : MIDDLE_C);
}

interface InstrumentSettings {
  readonly type?: unknown;
  readonly wave?: unknown;
  readonly volume?: unknown;
  readonly pan?: unknown;
}

/** A sound's settings as text, leaving out how loud and where in the stereo, which belong to the channel. */
function fingerprint(settings: object): string {
  const { volume, pan, ...rest } = settings as Record<string, unknown>;
  void volume;
  void pan;
  return JSON.stringify(rest);
}

/** BeepBox's settings for a sound. It keeps how loud and where in the stereo the channel was. */
export function makeSound(id: string, isDrum: boolean, keepFrom: object | undefined): object {
  const recipe = findRecipe(id, isDrum);
  if (!recipe) throw new Error(`There's no sound called ${id}.`);
  const instrument = new Instrument(isDrum);
  if ("settings" in recipe) {
    instrument.fromJsonObject(recipe.settings, isDrum);
  } else {
    const type = Config.instrumentTypeNames.indexOf(recipe.type);
    if (type === -1) throw new Error(`BeepBox has no instrument type called ${recipe.type}.`);
    instrument.setTypeAndReset(type, isDrum);
    if (recipe.wave !== undefined) {
      const waves = isDrum ? Config.chipNoises : Config.chipWaves;
      const wave = waves.dictionary[recipe.wave];
      if (!wave) throw new Error(`BeepBox has no wave called ${recipe.wave}.`);
      if (isDrum) instrument.chipNoise = wave.index;
      else instrument.chipWave = wave.index;
    }
  }
  const { volume, pan } = (keepFrom ?? {}) as InstrumentSettings;
  return { ...(instrument.toJsonObject() as object), ...(volume === undefined ? {} : { volume }), ...(pan === undefined ? {} : { pan }) };
}

const fingerprints: Partial<Record<"tune" | "drum", ReadonlyMap<string, string>>> = {};

function fingerprintsFor(isDrum: boolean): ReadonlyMap<string, string> {
  const which = isDrum ? "drum" : "tune";
  const known = fingerprints[which];
  if (known) return known;
  const made = new Map<string, string>();
  for (const group of groupsFor(isDrum)) {
    for (const sound of group.sounds) made.set(fingerprint(makeSound(sound.id, isDrum, undefined)), sound.id);
  }
  fingerprints[which] = made;
  return made;
}

/** Are these settings just as that sound on the list makes them? A plain wave a song has changed is named after it, but isn't it. */
export function soundIsExactly(id: string, settings: object | undefined, isDrum: boolean): boolean {
  return settings !== undefined && fingerprintsFor(isDrum).get(fingerprint(settings)) === id;
}

/** Which sound these settings are, or null for one a song brought with it that isn't on the list. */
export function soundIdOf(settings: object | undefined, isDrum: boolean): string | null {
  if (!settings) return null;
  const exact = fingerprintsFor(isDrum).get(fingerprint(settings));
  if (exact) return exact;
  // Not an exact match, such as a wave a song has changed a little: the plain wave it's based on is close enough to name.
  const { type, wave } = settings as InstrumentSettings;
  const waves: readonly WaveRecipe[] = isDrum ? DRUM_WAVES : TUNE_WAVES;
  return waves.find((sound) => sound.type === type && (sound.wave === undefined || sound.wave === wave))?.id ?? null;
}
