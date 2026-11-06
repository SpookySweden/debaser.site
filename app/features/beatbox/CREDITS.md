# Credits

Licences of everything reused in debaser-beatbox.

## BeepBox

npm package `beepbox` 4.2.0, by John Nesky: https://github.com/johnnesky/beepbox

The example song on the demo page and in the engine tests comes from this package's README, under the same licence.

Two things come from BeepBox's own editor (v4.2.2 of the same repository, same licence), not the package:
- `engine/soundBank.ts`: the settings of the named sounds in the Sounds window, from its instrument list `editor/EditorConfig.ts`. They're
  settings for this synth, not recordings: there are no sound files. The plain names are ours.
- `ui/loopEdit.ts`: how the loop bar drags, worked out from `editor/LoopEditor.ts`.

```
MIT License

Copyright (c) 2012-2024 John Nesky and contributing authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
