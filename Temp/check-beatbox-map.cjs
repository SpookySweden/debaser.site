/*
 * The beat box's song map (the pixel map under the bars): the whole song for the picked channel always folds into the
 * same few pixels, whatever the note range, the length of the song or its steps; a pixel standing for several notes or
 * steps lights if any of them has a note; and the viewing box and a press on the map agree at every size.
 *   npx tsc app/features/beatbox/ui/mapPixels.ts app/features/beatbox/ui/gridView.ts app/features/beatbox/engine/songData.ts --rootDir app --outDir Temp/beatbox-map-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const map = require('./beatbox-map-out/features/beatbox/ui/mapPixels.js');
const { noteRange, GRID_SIZES } = require('./beatbox-map-out/features/beatbox/ui/gridView.js');
const { makeNote, partsPerStep, stepsPerBar } = require('./beatbox-map-out/features/beatbox/engine/songData.js');

function song({ bars = 16, beatsPerBar = 4, stepsPerBeat = 4, notes = [] } = {}) {
  const channel = { isDrum: false, octave: 4, bars: Array.from({ length: bars }, () => 1), patterns: [{ notes, instruments: [0] }], sounds: [{}] };
  return { key: 0, tempo: 150, beatsPerBar, stepsPerBeat, barCount: bars, loopStart: 0, loopLength: 4, channels: [channel] };
}

const range = (low, high) => ({ low, high, widened: false });
const sizes = GRID_SIZES.map(({ size }) => size);

// Every size of grid and every length of song fits the same room: never more pixels than it has.
for (const size of sizes) {
  for (const bars of [1, 4, 16, 33, 64, 100, 128]) {
    for (const [beatsPerBar, stepsPerBeat] of [[4, 4], [3, 3], [8, 4], [4, 24], [7, 2]]) {
      const s = song({ bars, beatsPerBar, stepsPerBeat });
      const r = noteRange(size, 4, 0, null);
      const shape = map.mapShape(s, r);
      assert.ok(shape.columns <= map.MAP_MOST_COLUMNS, `${bars} bars at ${beatsPerBar}x${stepsPerBeat}: ${shape.columns} columns`);
      assert.ok(shape.rows <= map.MAP_MOST_ROWS, `${size} notes: ${shape.rows} rows`);
      assert.ok(shape.columns * shape.stepsPerColumn >= bars * stepsPerBar(s), 'the whole song is on it');
      assert.ok(shape.rows * shape.notesPerRow >= r.high - r.low + 1, 'every note of the range is on it');
      // A bar's edges stay on pixel edges until a pixel holds whole bars.
      if (shape.stepsPerColumn <= shape.stepsPerBar) assert.equal(shape.stepsPerBar % shape.stepsPerColumn, 0, `${shape.stepsPerColumn} steps a pixel`);
      else assert.equal(shape.stepsPerColumn % shape.stepsPerBar, 0);
    }
  }
}

// At its most detailed it shows a pixel a beat and a pixel a note: an octave and a short song are drawn whole.
{
  const shape = map.mapShape(song({ bars: 8 }), range(48, 60));
  assert.equal(shape.columns, 32);
  assert.equal(shape.stepsPerColumn, 4, 'one beat a pixel');
  assert.equal(shape.rows, 13);
  assert.equal(shape.notesPerRow, 1);
}

// Fewer pixels for more: ALL the notes shares rows out, a long song shares beats and then bars.
{
  const all = map.mapShape(song({ bars: 16 }), range(0, 84));
  assert.ok(all.notesPerRow > 1 && all.rows <= map.MAP_MOST_ROWS, `ALL: ${all.notesPerRow} notes a pixel, ${all.rows} rows`);
  const long = map.mapShape(song({ bars: 16 }), range(48, 60));
  assert.equal(long.stepsPerColumn, 8, '16 bars: two beats a pixel');
  const longest = map.mapShape(song({ bars: 128 }), range(48, 60));
  assert.equal(longest.stepsPerColumn, 64, '128 bars: four whole bars a pixel');
  assert.equal(longest.columns, 32);
}

// A lone note is never lost, however much a pixel stands for, and it lands in the right place.
for (const size of sizes) {
  for (const bars of [1, 16, 128]) {
    const r = noteRange(size, 4, 0, null);
    const probe = song({ bars });
    const stepParts = partsPerStep(probe);
    const pitch = r.low + Math.floor((r.high - r.low) / 3);
    const step = 5;
    const s = song({ bars, notes: [makeNote([pitch], step * stepParts, (step + 1) * stepParts)] });
    const shape = map.mapShape(s, r);
    const lit = map.litPixels(s, s.channels[0], r, shape);
    const lastBar = bars - 1;
    const expected = `${map.columnOf(shape, lastBar, step)},${Math.floor((r.high - pitch) / shape.notesPerRow)}`;
    assert.ok(lit.has(expected), `${size} notes, ${bars} bars: the note in the last bar lights ${expected}`);
    assert.ok(lit.size <= bars, 'and only its own pixel in each bar');
  }
}

// Notes off the grid's range draw nothing; a long note lights every pixel it covers.
{
  const r = range(48, 60);
  const s = song({ bars: 1, notes: [makeNote([30], 0, 24), makeNote([50], 0, 96)] });
  const shape = map.mapShape(s, r);
  const lit = map.litPixels(s, s.channels[0], r, shape);
  assert.deepEqual([...lit].sort(), ['0,10', '1,10', '2,10', '3,10']);
}

// A press inside the viewing box lands inside it again, and a press anywhere opens a view whose box holds that pixel.
for (const size of sizes) {
  for (const bars of [1, 4, 16, 64, 128]) {
    const s = song({ bars });
    const r = noteRange(size, 4, 0, null);
    const shape = map.mapShape(s, r);
    for (let column = 0; column < shape.columns; column += 1) {
      for (let row = 0; row < shape.rows; row += 1) {
        const spot = map.spotAt(shape, (column + 0.5) / shape.columns, (row + 0.5) / shape.rows);
        assert.ok(spot.bar >= 0 && spot.bar < bars, 'a bar of the song');
        assert.ok(spot.step >= 0 && spot.step < shape.stepsPerBar, 'a step of the bar');
        assert.ok(spot.row >= 0 && spot.row < shape.totalRows, 'a row of the grid');
        // The grid shows that one step and row, as small a view as there is.
        const box = map.viewBox(shape, { bar: spot.bar, firstRow: spot.row, lastRow: spot.row, firstColumn: spot.step, lastColumn: spot.step });
        assert.ok(box.column <= column && column <= box.lastColumn, `${size} notes, ${bars} bars: pressing column ${column} shows it (${box.column}-${box.lastColumn})`);
        assert.ok(box.row <= row && row <= box.lastRow, `${size} notes, ${bars} bars: pressing row ${row} shows it (${box.row}-${box.lastRow})`);
      }
    }
  }
}

// The box covers the whole of a bar in view, and only that bar's pixels.
{
  const s = song({ bars: 16 });
  const shape = map.mapShape(s, range(48, 60));
  const box = map.viewBox(shape, { bar: 5, firstRow: 0, lastRow: 12, firstColumn: 0, lastColumn: 15 });
  assert.deepEqual(box, { column: 10, lastColumn: 11, row: 0, lastRow: 12 });
  assert.deepEqual(map.barColumns(shape, 5), { column: 10, lastColumn: 11 });
  const all = map.mapShape(s, range(0, 84));
  const allBox = map.viewBox(all, { bar: 0, firstRow: 40, lastRow: 52, firstColumn: 0, lastColumn: 15 });
  assert.equal(allBox.row, Math.floor(40 / all.notesPerRow));
  assert.equal(allBox.lastRow, Math.floor(52 / all.notesPerRow));
}

console.log('check-beatbox-map: ok');
