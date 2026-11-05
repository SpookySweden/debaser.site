// Moves song data between BeepBox's objects and the plain values the rest of the app uses.
import { Config, Note, Pattern, type Song } from "beepbox";
import type { ChannelData, NoteData, PatternData, SongData } from "./songData";

function noteToData(note: Note): NoteData {
  return {
    pitches: [...note.pitches],
    start: note.start,
    end: note.end,
    pins: note.pins.map((pin) => ({ interval: pin.interval, time: pin.time, size: pin.size })),
    continuesLastPattern: note.continuesLastPattern,
  };
}

function patternToData(pattern: Pattern): PatternData {
  return { notes: pattern.notes.map(noteToData), instruments: [...pattern.instruments] };
}

export function songToData(song: Song): SongData {
  return {
    key: song.key,
    tempo: song.tempo,
    beatsPerBar: song.beatsPerBar,
    stepsPerBeat: Config.rhythms[song.rhythm]?.stepsPerBeat ?? 4,
    barCount: song.barCount,
    loopStart: song.loopStart,
    loopLength: song.loopLength,
    channels: song.channels.map(
      (channel, index): ChannelData => ({
        isDrum: song.getChannelIsNoise(index),
        octave: channel.octave,
        bars: [...channel.bars],
        patterns: channel.patterns.map(patternToData),
      }),
    ),
  };
}

function dataToNote(data: NoteData): Note {
  const note = new Note(-1, data.start, data.end, Config.noteSizeMax);
  note.pitches = [...data.pitches];
  note.pins = data.pins.map((pin) => ({ interval: pin.interval, time: pin.time, size: pin.size }));
  note.continuesLastPattern = data.continuesLastPattern;
  return note;
}

/**
 * Writes changes into the song the synth is reading, without stopping it. Only patterns that
 * changed are rewritten: a note the synth is sounding must keep its object, or it would restart.
 */
export function writeDataToSong(song: Song, previous: SongData, next: SongData): void {
  song.key = next.key;
  song.tempo = next.tempo;
  song.barCount = next.barCount;
  song.loopStart = next.loopStart;
  song.loopLength = next.loopLength;

  next.channels.forEach((channelData, channelIndex) => {
    const channel = song.channels[channelIndex];
    if (!channel) throw new Error(`The song has no channel ${channelIndex}.`);
    channel.bars.length = 0;
    channel.bars.push(...channelData.bars);

    channelData.patterns.forEach((patternData, patternIndex) => {
      if (previous.channels[channelIndex]?.patterns[patternIndex] === patternData) return;
      const pattern = channel.patterns[patternIndex] ?? new Pattern();
      channel.patterns[patternIndex] = pattern;
      pattern.notes = patternData.notes.map(dataToNote);
      pattern.instruments.length = 0;
      pattern.instruments.push(...patternData.instruments);
    });
  });

  // BeepBox wants the same number of patterns on every channel.
  song.patternsPerChannel = Math.max(...song.channels.map((channel) => channel.patterns.length));
  for (const channel of song.channels) {
    while (channel.patterns.length < song.patternsPerChannel) channel.patterns.push(new Pattern());
  }
}
