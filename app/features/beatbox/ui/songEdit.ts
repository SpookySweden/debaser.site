// Edits to the song's bars and patterns, as plain functions that return a new song.
import { freePatternNumber, MAX_BARS, type ChannelData, type NoteData, type SongData } from "../engine/songData";

function replaceChannel(song: SongData, channelIndex: number, channel: ChannelData): SongData {
  return { ...song, channels: song.channels.map((other, index) => (index === channelIndex ? channel : other)) };
}

/** Gives a channel new sounds, as one undo step like any other edit. */
export function setChannelSound(song: SongData, channelIndex: number, sounds: readonly object[]): SongData {
  const channel = song.channels[channelIndex];
  return channel ? replaceChannel(song, channelIndex, { ...channel, sounds }) : song;
}

/** Changes the notes of the pattern on this bar. A silent bar gets a new pattern first. */
export function replacePatternNotes(
  song: SongData,
  channelIndex: number,
  bar: number,
  notes: readonly NoteData[],
): SongData {
  let channel = song.channels[channelIndex];
  if (!channel) throw new Error(`The song has no channel ${channelIndex}.`);
  let patternNumber = channel.bars[bar] ?? 0;
  if (patternNumber === 0) {
    const free = freePatternNumber(channel);
    patternNumber = free.patternNumber;
    channel = {
      ...free.channel,
      bars: free.channel.bars.map((number, index) => (index === bar ? patternNumber : number)),
    };
  }
  const patterns = channel.patterns.map((pattern, index) =>
    index === patternNumber - 1 ? { ...pattern, notes } : pattern,
  );
  return replaceChannel(song, channelIndex, { ...channel, patterns });
}

/** Sets which pattern a bar plays, adding patterns if the number is new. 0 makes the bar silent. */
export function setBarPattern(song: SongData, channelIndex: number, bar: number, patternNumber: number): SongData {
  const channel = song.channels[channelIndex];
  if (!channel) throw new Error(`The song has no channel ${channelIndex}.`);
  const number = Math.max(0, Math.min(MAX_BARS, patternNumber));
  const patterns = [...channel.patterns];
  while (patterns.length < number) patterns.push({ notes: [], instruments: [0] });
  return replaceChannel(song, channelIndex, {
    ...channel,
    patterns,
    bars: channel.bars.map((old, index) => (index === bar ? number : old)),
  });
}

/** Sets the bars that repeat, kept inside the song. */
export function setLoop(song: SongData, firstBar: number, lastBar: number): SongData {
  const start = Math.max(0, Math.min(firstBar, lastBar));
  const end = Math.min(song.barCount - 1, Math.max(firstBar, lastBar));
  return { ...song, loopStart: start, loopLength: end - start + 1 };
}

export function barsUsingPattern(channel: ChannelData, patternNumber: number): number {
  return patternNumber === 0 ? 0 : channel.bars.filter((number) => number === patternNumber).length;
}
