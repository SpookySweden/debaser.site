//! THE PC'S OWN POINTER SHAPE (SPEC-screens.md): the arrow, text bar, hand or resize arrow Windows is showing,
//! told to viewers so that a viewer controlling the PC sees the right one.
//!
//! The picture that is streamed has no pointer in it. Windows says separately what the pointer looks like, and
//! only when that changes (native/core.cpp keeps the last it heard). Here that shape is turned into plain pixels
//! and into the two messages that carry it to a viewer's page, on the reliable `keys` channel (control.rs lists
//! every message):
//!
//! - `81 shown`: 1 the PC is showing its pointer, 0 it is hidden (games hide it).
//! - `82 n n w w h h x x y y how pixels...`: a new shape. `n` its number (it goes up by one with each new shape),
//!   `w` `h` its size in pixels, `x` `y` its hot spot (the pixel that is "the pointer's place"), all 16-bit,
//!   low byte first. Then `how` the pixels follow:
//!     - 0: as they are, four bytes a pixel (red, green, blue, and how solid: 0 see-through to 255 solid),
//!       row by row from the top;
//!     - 1: the same pixels as runs: `count red green blue solid`, meaning that pixel `count` times (1 to 255).
//!       Pointers are mostly see-through, so this is usually a tenth of the size;
//!     - 2: none: the shape was too large to send, and the page shows its plain arrow.
//!
//! Windows has three kinds of pointer. Colour ones have a "how solid" byte already. The other two can also ask
//! for pixels that INVERT whatever is under them (the classic text bar does), which a web page's pointer cannot
//! do. Those pixels are drawn white with a one-pixel black edge instead, which shows on any background.

use crate::native::RawPointerShape;

/// The first byte of "the PC's pointer is showing / hidden".
pub const SHOWN: u8 = 0x81;
/// The first byte of a new shape.
pub const SHAPE: u8 = 0x82;

const AS_IT_IS: u8 = 0;
const IN_RUNS: u8 = 1;
const TOO_LARGE: u8 = 2;
/// A shape message longer than this is not sent: the channel holds at most 128 KB waiting to go, and this leaves
/// room beside it. Real shapes are far below it (a 128 by 128 pointer with no two neighbouring pixels alike is
/// 65 KB; an ordinary arrow is a few hundred bytes as runs).
const LARGEST_MESSAGE: usize = 100_000;
/// Windows' own limit on a pointer's size.
const LARGEST_SIDE: usize = 256;

/// A pointer shape as plain pixels: four bytes each (red, green, blue, solid), row by row from the top.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Shape {
    pub width: u16,
    pub height: u16,
    pub hot_x: u16,
    pub hot_y: u16,
    pub rgba: Vec<u8>,
}

/// What one pixel of a Windows pointer asks for.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pixel {
    Clear,
    Solid([u8; 4]),
    Invert,
}

/// Turns a shape as Windows hands it over into plain pixels. None when what Windows handed over makes no sense
/// (a size of nothing, or fewer bytes than the size needs).
pub fn from_windows(raw: &RawPointerShape) -> Option<Shape> {
    let width = usize::try_from(raw.width).ok()?;
    let pitch = usize::try_from(raw.pitch).ok()?;
    // The one-bit kind is two pictures, one above the other, so its real height is half what Windows says.
    let height = usize::try_from(raw.height).ok()? / if raw.kind == 1 { 2 } else { 1 };
    if width == 0 || height == 0 || width > LARGEST_SIDE || height > LARGEST_SIDE {
        return None;
    }
    let mut pixels = Vec::with_capacity(width * height);
    match raw.kind {
        // One bit a pixel, twice: the top picture says "keep what is underneath", the bottom one "flip it".
        // Neither: black. Flip only: white. Keep only: see-through. Both: inverted.
        1 => {
            if pitch * height * 2 > raw.data.len() || pitch * 8 < width {
                return None;
            }
            let bit = |row: usize, x: usize| raw.data[row * pitch + x / 8] & (0x80 >> (x % 8)) != 0;
            for y in 0..height {
                for x in 0..width {
                    pixels.push(match (bit(y, x), bit(y + height, x)) {
                        (false, false) => Pixel::Solid([0, 0, 0, 255]),
                        (false, true) => Pixel::Solid([255, 255, 255, 255]),
                        (true, false) => Pixel::Clear,
                        (true, true) => Pixel::Invert,
                    });
                }
            }
        }
        // Colour, four bytes a pixel in Windows' order (blue, green, red, how solid).
        2 | 4 => {
            if pitch < width * 4 || pitch * (height - 1) + width * 4 > raw.data.len() {
                return None;
            }
            for y in 0..height {
                for x in 0..width {
                    let at = y * pitch + x * 4;
                    let (blue, green, red, last) = (raw.data[at], raw.data[at + 1], raw.data[at + 2], raw.data[at + 3]);
                    pixels.push(if raw.kind == 2 {
                        if last == 0 { Pixel::Clear } else { Pixel::Solid([red, green, blue, last]) }
                    } else if last == 0 {
                        // The masked kind: a mask byte of 0 means "this colour, solid"...
                        Pixel::Solid([red, green, blue, 255])
                    } else if red == 0 && green == 0 && blue == 0 {
                        // ...and otherwise "flip what is underneath by this colour": black flips nothing,
                        Pixel::Clear
                    } else {
                        // and anything else inverts.
                        Pixel::Invert
                    });
                }
            }
        }
        _ => return None,
    }

    // Inverting pixels become white with a black edge. The edge needs one pixel of room all round.
    let inverting = pixels.iter().any(|p| *p == Pixel::Invert);
    let room = usize::from(inverting);
    let (out_width, out_height) = (width + room * 2, height + room * 2);
    let mut rgba = vec![0u8; out_width * out_height * 4];
    let at = |x: isize, y: isize| -> Option<Pixel> { (x >= 0 && y >= 0 && (x as usize) < width && (y as usize) < height).then(|| pixels[y as usize * width + x as usize]) };
    for oy in 0..out_height {
        for ox in 0..out_width {
            let (x, y) = (ox as isize - room as isize, oy as isize - room as isize);
            let colour = match at(x, y) {
                Some(Pixel::Solid(colour)) => colour,
                Some(Pixel::Invert) => [255, 255, 255, 255],
                // See-through (or the room round the outside): black where it touches an inverting pixel.
                _ => {
                    let touches = inverting && (-1..=1).any(|dy| (-1..=1).any(|dx| at(x + dx, y + dy) == Some(Pixel::Invert)));
                    if touches { [0, 0, 0, 255] } else { [0, 0, 0, 0] }
                }
            };
            rgba[(oy * out_width + ox) * 4..][..4].copy_from_slice(&colour);
        }
    }
    let hot = |value: i32, most: usize| (value.max(0) as usize).min(most - 1) + room;
    Some(Shape { width: out_width as u16, height: out_height as u16, hot_x: hot(raw.hot_x, width) as u16, hot_y: hot(raw.hot_y, height) as u16, rgba })
}

/// The same pixels as runs: `count red green blue solid`, for each stretch of identical pixels.
fn in_runs(rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut pixels = rgba.chunks_exact(4);
    let Some(mut current) = pixels.next() else { return out };
    let mut count = 1u8;
    for pixel in pixels {
        if pixel == current && count < 255 {
            count += 1;
        } else {
            out.push(count);
            out.extend_from_slice(current);
            current = pixel;
            count = 1;
        }
    }
    out.push(count);
    out.extend_from_slice(current);
    out
}

/// The `82` message that carries a shape to a viewer's page.
pub fn shape_message(shape: &Shape, number: u16) -> Vec<u8> {
    let mut message = vec![SHAPE];
    for value in [number, shape.width, shape.height, shape.hot_x, shape.hot_y] {
        message.extend_from_slice(&value.to_le_bytes());
    }
    let runs = in_runs(&shape.rgba);
    let (how, pixels) = if runs.len() < shape.rgba.len() { (IN_RUNS, runs.as_slice()) } else { (AS_IT_IS, shape.rgba.as_slice()) };
    if message.len() + 1 + pixels.len() > LARGEST_MESSAGE {
        message.push(TOO_LARGE);
    } else {
        message.push(how);
        message.extend_from_slice(pixels);
    }
    message
}

/// The `81` message.
pub fn shown_message(shown: bool) -> [u8; 2] {
    [SHOWN, shown as u8]
}

/// What viewers are to be told about the PC's pointer: the newest shape (as its ready-made message) and whether
/// the pointer is showing. Each viewer remembers the number of the last shape it was sent.
#[derive(Default)]
pub struct News {
    /// How many shapes there have been; 0 = none yet. (It wraps round after 65535, skipping 0.)
    pub number: u16,
    pub message: Option<std::sync::Arc<[u8]>>,
    pub shown: Option<bool>,
    /// The newest shape's size and hot spot, for the engine's own printing and `/settings`.
    pub size: (u16, u16),
}

impl News {
    /// A new shape from Windows (or from the check's pretending). Returns false when it made no sense.
    pub fn take_shape(&mut self, raw: &RawPointerShape) -> bool {
        let Some(shape) = from_windows(raw) else { return false };
        self.number = if self.number == u16::MAX { 1 } else { self.number + 1 };
        self.size = (shape.width, shape.height);
        self.message = Some(shape_message(&shape, self.number).into());
        true
    }
}

/// For bench/pointer-check.cjs only, so the page's handling of shapes can be proved without anyone moving the real
/// mouse over a text box: with `DEBASER_PRETEND_POINTER_FILE=<path>` in the environment, the engine ignores the
/// real pointer and takes its shape from one word in that file instead, read again whenever the file changes.
/// The words: `block` (a colour pointer, 24 by 32), `bar` (a one-bit pointer with inverting pixels, 8 by 20),
/// `mask` (the masked kind, 16 by 16), `large` (200 by 200, more than a browser will show as a pointer), and
/// `hidden` (the pointer is not showing; the shape stays as it was). The shapes are plain rectangles made only for
/// the check; they are in Windows' own three layouts, so the check also proves the turning into pixels above.
pub fn pretend(word: &str) -> Option<(Option<RawPointerShape>, bool)> {
    match word.trim() {
        "hidden" => Some((None, false)),
        "block" | "large" => {
            // Colour: the left half solid white, the right half half-solid red, a see-through row along the top.
            let (width, height, hot) = if word.trim() == "block" { (24usize, 32usize, (3, 5)) } else { (200, 200, (100, 100)) };
            let mut data = vec![0u8; width * height * 4];
            for y in 1..height {
                for x in 0..width {
                    let colour: [u8; 4] = if x < width / 2 { [255, 255, 255, 255] } else { [0, 0, 255, 128] };
                    data[(y * width + x) * 4..][..4].copy_from_slice(&colour);
                }
            }
            Some((Some(RawPointerShape { kind: 2, width: width as i32, height: height as i32, pitch: (width * 4) as i32, hot_x: hot.0, hot_y: hot.1, data }), true))
        }
        "bar" => {
            // One bit, 8 wide and 20 tall, rows two bytes long as Windows pads them. Everything see-through except
            // columns 3 and 4, which invert; the top-left pixel is solid black and the one beside it solid white.
            let (width, height, pitch) = (8usize, 20usize, 2usize);
            let mut data = vec![0u8; pitch * height * 2];
            for y in 0..height {
                data[y * pitch] = 0xFF; // keep what is underneath, everywhere...
                data[(y + height) * pitch] = 0b0001_1000; // ...and flip it in the two middle columns
            }
            data[0] = 0b0011_1111; // the first two pixels of the top row do not keep what is underneath:
            data[height * pitch] = 0b0101_1000; // the first stays black, the second is flipped to white
            Some((Some(RawPointerShape { kind: 1, width: width as i32, height: (height * 2) as i32, pitch: pitch as i32, hot_x: 4, hot_y: 10, data }), true))
        }
        "mask" => {
            // Masked colour, 16 by 16: a solid black edge, an inverting inside, see-through corners.
            let size = 16usize;
            let mut data = vec![0u8; size * size * 4];
            for y in 0..size {
                for x in 0..size {
                    let edge = x == 0 || y == 0 || x == size - 1 || y == size - 1;
                    let corner = (x == 0 || x == size - 1) && (y == 0 || y == size - 1);
                    let pixel: [u8; 4] = if corner { [0, 0, 0, 255] } else if edge { [0, 0, 0, 0] } else { [255, 255, 255, 255] };
                    data[(y * size + x) * 4..][..4].copy_from_slice(&pixel);
                }
            }
            Some((Some(RawPointerShape { kind: 4, width: size as i32, height: size as i32, pitch: (size * 4) as i32, hot_x: 8, hot_y: 8, data }), true))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(shape: &Shape, x: usize, y: usize) -> [u8; 4] {
        let at = (y * shape.width as usize + x) * 4;
        [shape.rgba[at], shape.rgba[at + 1], shape.rgba[at + 2], shape.rgba[at + 3]]
    }

    /// What the page does with a run-length message, to prove the two ends agree.
    fn out_of_runs(runs: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        for run in runs.chunks_exact(5) {
            for _ in 0..run[0] {
                out.extend_from_slice(&run[1..]);
            }
        }
        out
    }

    #[test]
    fn a_colour_pointer_keeps_its_pixels_and_hot_spot() {
        let raw = pretend("block").unwrap().0.unwrap();
        let shape = from_windows(&raw).unwrap();
        assert_eq!((shape.width, shape.height, shape.hot_x, shape.hot_y), (24, 32, 3, 5));
        assert_eq!(pixel(&shape, 0, 0), [0, 0, 0, 0]); // the see-through top row
        assert_eq!(pixel(&shape, 2, 5), [255, 255, 255, 255]);
        assert_eq!(pixel(&shape, 20, 5), [255, 0, 0, 128]); // Windows' blue-green-red order turned round
    }

    #[test]
    fn a_one_bit_pointer_with_inverting_pixels_gets_a_white_bar_with_a_black_edge() {
        let raw = pretend("bar").unwrap().0.unwrap();
        let shape = from_windows(&raw).unwrap();
        // One pixel of room all round for the edge, and the hot spot moves with it.
        assert_eq!((shape.width, shape.height, shape.hot_x, shape.hot_y), (10, 22, 5, 11));
        assert_eq!(pixel(&shape, 1, 1), [0, 0, 0, 255]); // the solid black pixel
        assert_eq!(pixel(&shape, 2, 1), [255, 255, 255, 255]); // the solid white one
        assert_eq!(pixel(&shape, 4, 10), [255, 255, 255, 255]); // an inverting pixel: white
        assert_eq!(pixel(&shape, 5, 10), [255, 255, 255, 255]);
        assert_eq!(pixel(&shape, 3, 10), [0, 0, 0, 255]); // its edge, both sides
        assert_eq!(pixel(&shape, 6, 10), [0, 0, 0, 255]);
        assert_eq!(pixel(&shape, 4, 0), [0, 0, 0, 255]); // and above the bar, in the room that was added
        assert_eq!(pixel(&shape, 8, 10), [0, 0, 0, 0]); // away from the bar: see-through
    }

    #[test]
    fn a_masked_pointer() {
        let raw = pretend("mask").unwrap().0.unwrap();
        let shape = from_windows(&raw).unwrap();
        assert_eq!((shape.width, shape.height, shape.hot_x, shape.hot_y), (18, 18, 9, 9));
        assert_eq!(pixel(&shape, 2, 1), [0, 0, 0, 255]); // the solid black edge
        assert_eq!(pixel(&shape, 9, 9), [255, 255, 255, 255]); // the inverting inside
        assert_eq!(pixel(&shape, 0, 9), [0, 0, 0, 0]); // outside it
    }

    #[test]
    fn nonsense_from_windows_is_refused() {
        let good = pretend("block").unwrap().0.unwrap();
        assert!(from_windows(&RawPointerShape { data: good.data[..100].to_vec(), ..good.clone() }).is_none());
        assert!(from_windows(&RawPointerShape { width: 0, ..good.clone() }).is_none());
        assert!(from_windows(&RawPointerShape { width: 300, ..good.clone() }).is_none());
        assert!(from_windows(&RawPointerShape { kind: 3, ..good }).is_none());
    }

    #[test]
    fn the_message_and_its_runs() {
        let shape = from_windows(&pretend("block").unwrap().0.unwrap()).unwrap();
        let message = shape_message(&shape, 7);
        assert_eq!(&message[..12], &[SHAPE, 7, 0, 24, 0, 32, 0, 3, 0, 5, 0, IN_RUNS]);
        assert!(message.len() < shape.rgba.len() / 4, "{} bytes", message.len());
        assert_eq!(out_of_runs(&message[12..]), shape.rgba);
        // Pixels that do not repeat are sent as they are.
        let noisy = Shape { width: 2, height: 2, hot_x: 0, hot_y: 0, rgba: vec![1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255] };
        let message = shape_message(&noisy, 1);
        assert_eq!(message[11], AS_IT_IS);
        assert_eq!(&message[12..], &noisy.rgba[..]);
        // A run longer than 255 is split.
        let long = in_runs(&vec![9u8; 300 * 4]);
        assert_eq!(long, vec![255, 9, 9, 9, 9, 45, 9, 9, 9, 9]);
        // A shape whose message would be too long goes without its pixels.
        let mut huge = Shape { width: 256, height: 256, hot_x: 0, hot_y: 0, rgba: vec![0u8; 256 * 256 * 4] };
        for (i, byte) in huge.rgba.iter_mut().enumerate() {
            *byte = (i / 4 % 251) as u8;
        }
        assert_eq!(shape_message(&huge, 2)[11], TOO_LARGE);
        assert_eq!(shown_message(false), [SHOWN, 0]);
    }

    #[test]
    fn the_news_counts_shapes() {
        let mut news = News::default();
        assert!(news.take_shape(&pretend("block").unwrap().0.unwrap()));
        assert!(news.take_shape(&pretend("large").unwrap().0.unwrap()));
        assert_eq!((news.number, news.size), (2, (200, 200)));
        assert_eq!(pretend("hidden"), Some((None, false)));
        assert_eq!(pretend("nothing"), None);
    }
}
