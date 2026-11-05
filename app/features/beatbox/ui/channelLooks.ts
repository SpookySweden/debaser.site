// Each channel's notes have their own shape, so channels can be told apart without colour.
import type { CSSProperties } from "react";
import type { SongData } from "../engine/songData";

type Shape = "square" | "round" | "cut" | "point";

const PITCH_SHAPES: readonly Shape[] = ["square", "round", "cut"];

function shapeOf(song: SongData, channelIndex: number): Shape {
  if (song.channels[channelIndex]?.isDrum) return "point";
  return PITCH_SHAPES[channelIndex % PITCH_SHAPES.length] ?? "square";
}

const CLIP_PATHS: Record<"cut" | "point", Record<"start" | "end" | "both", string>> = {
  cut: {
    start: "polygon(25% 0, 100% 0, 100% 100%, 25% 100%, 0 75%, 0 25%)",
    end: "polygon(0 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 0 100%)",
    both: "polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%)",
  },
  point: {
    start: "polygon(25% 0, 100% 0, 100% 100%, 25% 100%, 0 50%)",
    end: "polygon(0 0, 75% 0, 100% 50%, 75% 100%, 0 100%)",
    both: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
  },
};

/** The shape of one cell of a note. Only a note's two ends are shaped. */
export function noteShapeStyle(
  song: SongData,
  channelIndex: number,
  isStart: boolean,
  isEnd: boolean,
): CSSProperties {
  const shape = shapeOf(song, channelIndex);
  if (shape === "square" || (!isStart && !isEnd)) return {};
  const ends = isStart && isEnd ? "both" : isStart ? "start" : "end";
  if (shape === "round") {
    const radius = "50%";
    return {
      borderTopLeftRadius: isStart ? radius : 0,
      borderBottomLeftRadius: isStart ? radius : 0,
      borderTopRightRadius: isEnd ? radius : 0,
      borderBottomRightRadius: isEnd ? radius : 0,
    };
  }
  return { clipPath: CLIP_PATHS[shape][ends] };
}

export function channelName(song: SongData, channelIndex: number): string {
  const channel = song.channels[channelIndex];
  if (channel?.isDrum) {
    const firstDrum = song.channels.findIndex((other) => other.isDrum);
    const drumChannels = song.channels.filter((other) => other.isDrum).length;
    return drumChannels > 1 ? `Drums ${channelIndex - firstDrum + 1}` : "Drums";
  }
  return `Tune ${channelIndex + 1}`;
}
