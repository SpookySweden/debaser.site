//! The stream's settings (SPEC-screens.md): what a viewer may ask for, what the PC allows, and the sum that turns
//! the two into "this piece of the screen, sent at this size, this often, with this much data".
//!
//! One encoder serves every viewer, so the settings belong to the stream, not to a viewer: the last change wins.
//! Nothing here touches the screen or the encoder; `serve.rs` acts on what `plan` works out.

use crate::native::Region;

/// The shape of the picture that is sent.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Shape {
    /// The shape of the viewer's own screen (it sends its size along).
    Match,
    /// The whole of the PC's screen, whatever its shape.
    Native,
    Wide16x9,
    Wide16x10,
    Wide21x9,
    Old4x3,
    /// A piece of a fixed size cut from the middle and sent as it is. Only the PC's own `--width`/`--height` start
    /// the stream like this (the measuring runs do); a viewer cannot ask for it.
    Cut,
}

impl Shape {
    pub fn name(self) -> &'static str {
        match self {
            Shape::Match => "match",
            Shape::Native => "native",
            Shape::Wide16x9 => "16:9",
            Shape::Wide16x10 => "16:10",
            Shape::Wide21x9 => "21:9",
            Shape::Old4x3 => "4:3",
            Shape::Cut => "cut",
        }
    }

    /// The shapes a viewer (or `--shape`) may name.
    pub fn parse(name: &str) -> Option<Shape> {
        [Shape::Match, Shape::Native, Shape::Wide16x9, Shape::Wide16x10, Shape::Wide21x9, Shape::Old4x3].into_iter().find(|shape| shape.name() == name)
    }
}

/// What has been asked for. `lines` 0 means "as many as the piece of the screen has".
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Asked {
    pub shape: Shape,
    /// The viewer's screen in real pixels, for `Shape::Match`.
    pub view_width: i32,
    pub view_height: i32,
    /// The size of the piece, for `Shape::Cut`.
    pub cut_width: i32,
    pub cut_height: i32,
    pub lines: i32,
    /// Frames a second, when a fixed number was asked for.
    pub fps: i32,
    /// AUTO: as many frames a second as the viewer's own screen shows (`view_hz`, which it measures and sends).
    pub fps_auto: bool,
    pub view_hz: i32,
    pub bitrate_kbps: i32,
}

/// The most the PC will send, whatever is asked.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Limits {
    pub max_lines: i32,
    pub max_fps: i32,
    pub max_bitrate_kbps: i32,
}

impl Limits {
    /// Both sets of limits at once: the smaller of each.
    pub fn within(self, other: Limits) -> Limits {
        Limits { max_lines: self.max_lines.min(other.max_lines), max_fps: self.max_fps.min(other.max_fps), max_bitrate_kbps: self.max_bitrate_kbps.min(other.max_bitrate_kbps) }
    }
}

/// While a League match runs on the PC the stream is held to this, so a viewer cannot make the game stutter.
pub const MATCH_CAP: Limits = Limits { max_lines: 1080, max_fps: 60, max_bitrate_kbps: 12000 };
pub const MATCH_CAP_NAME: &str = "LEAGUE MATCH";
pub const MATCH_PROCESS: &str = "League of Legends.exe";

pub const LINES_CHOICES: [i32; 3] = [720, 1080, 1440];
pub const FPS_CHOICES: [i32; 4] = [30, 60, 120, 180];
/// AUTO takes any whole rate a screen may have (144, 165, 240...), but never less than this.
pub const SLOWEST_AUTO: i32 = 24;
/// H.264 pictures are at most this wide; a wider piece of screen is shrunk to it.
const WIDEST: i32 = 4096;
/// No picture is made shorter than this (unless the piece of screen itself is): the encoder has a smallest size.
const SHORTEST: i32 = 360;

/// What to do: the piece of the screen to take and the picture to make of it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Plan {
    pub region: Region,
    pub width: i32,
    pub height: i32,
    pub fps: i32,
    pub bitrate_kbps: i32,
}

/// `a * b / c`, to the nearest whole number.
fn scaled(a: i32, b: i32, c: i32) -> i32 {
    ((a as i64 * b as i64 + c as i64 / 2) / c.max(1) as i64) as i32
}

/// The sum. The piece is the largest rectangle of the asked shape that fits the screen, in its middle; the
/// picture is that piece made no taller than the lines asked for (or allowed, or the viewer's own screen), in the
/// same shape, with even numbers, and never larger than the piece.
pub fn plan(asked: &Asked, limits: &Limits, screen_width: i32, screen_height: i32) -> Plan {
    let (screen_width, screen_height) = ((screen_width & !1).max(2), (screen_height & !1).max(2));
    // The shape as "wide : tall". None = the whole screen.
    let shape = match asked.shape {
        Shape::Native => None,
        Shape::Wide16x9 => Some((16, 9)),
        Shape::Wide16x10 => Some((16, 10)),
        Shape::Wide21x9 => Some((21, 9)),
        Shape::Old4x3 => Some((4, 3)),
        Shape::Match if asked.view_width > 0 && asked.view_height > 0 => Some((asked.view_width, asked.view_height)),
        Shape::Match | Shape::Cut => None,
    };
    let (mut region_width, mut region_height) = (screen_width, screen_height);
    if asked.shape == Shape::Cut && asked.cut_width > 0 && asked.cut_height > 0 {
        region_width = asked.cut_width.min(screen_width) & !1;
        region_height = asked.cut_height.min(screen_height) & !1;
    } else if let Some((wide, tall)) = shape {
        // Shapes no stranger than a phone held upright or two screens side by side.
        let (wide, tall) = if wide * 2 < tall { (1, 2) } else if wide > tall * 4 { (4, 1) } else { (wide, tall) };
        // A shape within 3% of the screen's own is the screen's own: "21:9" on a 3440x1440 screen is all of it.
        let (ours, theirs) = (screen_width as i64 * tall as i64, wide as i64 * screen_height as i64);
        if (ours - theirs).abs() * 100 > ours * 3 {
            if theirs < ours {
                region_width = scaled(screen_height, wide, tall) & !1;
            } else {
                region_height = scaled(screen_width, tall, wide) & !1;
            }
        }
    }
    let (region_width, region_height) = (region_width.clamp(2, screen_width), region_height.clamp(2, screen_height));
    let region = Region { x: ((screen_width - region_width) / 2) & !1, y: ((screen_height - region_height) / 2) & !1, width: region_width, height: region_height };

    let mut tall = if asked.lines > 0 { asked.lines } else { region_height };
    tall = tall.min(limits.max_lines);
    if asked.shape == Shape::Match && asked.view_height > 0 {
        tall = tall.min(asked.view_height);
    }
    let mut height = tall.max(SHORTEST).min(region_height) & !1;
    let mut width = if height == region_height { region_width } else { (scaled(region_width, height, region_height) + 1) & !1 };
    if width > WIDEST {
        width = WIDEST;
        height = scaled(region_height, WIDEST, region_width) & !1;
    }
    Plan {
        region,
        width: width.clamp(2, region_width),
        height: height.clamp(2, region_height),
        // AUTO is the viewer's own rate; either way, never more than the PC's screen shows or a cap allows.
        fps: (if asked.fps_auto && asked.view_hz > 0 { asked.view_hz.max(SLOWEST_AUTO) } else { asked.fps }).min(limits.max_fps).max(1),
        bitrate_kbps: asked.bitrate_kbps.min(limits.max_bitrate_kbps).max(1000),
    }
}

/// One value of the small JSON a viewer sends.
#[derive(Clone, PartialEq, Debug)]
pub enum Value {
    Text(String),
    Number(f64),
    /// true, false or null: nothing in the settings uses them.
    Other,
}

/// Reads a flat JSON object, such as `{"shape": "16:9", "lines": 720}`: names with text or number values, nothing
/// nested. That is all a settings request ever is, so no JSON library is brought in for it.
pub fn parse_flat(text: &str) -> Result<Vec<(String, Value)>, String> {
    let bytes = text.as_bytes();
    let mut at = 0usize;
    let skip = |at: &mut usize| {
        while *at < bytes.len() && bytes[*at].is_ascii_whitespace() {
            *at += 1;
        }
    };
    let string = |at: &mut usize| -> Result<String, String> {
        if bytes.get(*at) != Some(&b'"') {
            return Err("a name or text in double quotes was expected".into());
        }
        *at += 1;
        let mut out = Vec::new();
        loop {
            match bytes.get(*at) {
                None => return Err("the text never ends".into()),
                Some(b'"') => {
                    *at += 1;
                    return String::from_utf8(out).map_err(|_| "the text is not UTF-8".to_string());
                }
                Some(b'\\') => {
                    match bytes.get(*at + 1) {
                        Some(b'"') => out.push(b'"'),
                        Some(b'\\') => out.push(b'\\'),
                        Some(b'/') => out.push(b'/'),
                        _ => return Err("only \\\" \\\\ and \\/ are understood after a backslash".into()),
                    }
                    *at += 2;
                }
                Some(byte) => {
                    out.push(*byte);
                    *at += 1;
                }
            }
        }
    };
    skip(&mut at);
    if bytes.get(at) != Some(&b'{') {
        return Err("a JSON object, starting with {, was expected".into());
    }
    at += 1;
    let mut pairs = Vec::new();
    skip(&mut at);
    if bytes.get(at) == Some(&b'}') {
        return Ok(pairs);
    }
    loop {
        skip(&mut at);
        let name = string(&mut at)?;
        skip(&mut at);
        if bytes.get(at) != Some(&b':') {
            return Err(format!("a colon was expected after \"{name}\""));
        }
        at += 1;
        skip(&mut at);
        let value = match bytes.get(at) {
            Some(b'"') => Value::Text(string(&mut at)?),
            Some(b'{') | Some(b'[') => return Err(format!("\"{name}\" holds a list or an object; only plain values are understood")),
            Some(_) => {
                let from = at;
                while at < bytes.len() && !matches!(bytes[at], b',' | b'}') && !bytes[at].is_ascii_whitespace() {
                    at += 1;
                }
                match &text[from..at] {
                    "true" | "false" | "null" => Value::Other,
                    number => Value::Number(number.parse::<f64>().ok().filter(|n| n.is_finite()).ok_or_else(|| format!("\"{name}\" is not a number or text"))?),
                }
            }
            None => return Err("the object never ends".into()),
        };
        pairs.push((name, value));
        skip(&mut at);
        match bytes.get(at) {
            Some(b',') => at += 1,
            Some(b'}') => return Ok(pairs),
            _ => return Err("a comma or } was expected".into()),
        }
    }
}

/// Takes a viewer's request into what is asked. Only the settings it names change. Anything it does not
/// understand is refused whole, with the reason, and nothing changes.
pub fn take_request(asked: &Asked, pairs: &[(String, Value)]) -> Result<Asked, String> {
    let mut next = *asked;
    let whole = |name: &str, value: &Value| -> Result<i32, String> {
        match value {
            Value::Number(n) if n.fract() == 0.0 && *n >= 0.0 && *n <= 1_000_000.0 => Ok(*n as i32),
            _ => Err(format!("\"{name}\" must be a whole number")),
        }
    };
    for (name, value) in pairs {
        match name.as_str() {
            "shape" => {
                next.shape = match value {
                    Value::Text(text) => Shape::parse(text).ok_or_else(|| format!("\"shape\" is one of match, native, 16:9, 16:10, 21:9, 4:3 (not \"{text}\")"))?,
                    _ => return Err("\"shape\" must be text".into()),
                }
            }
            "viewWidth" => next.view_width = whole(name, value)?.clamp(1, 16384),
            "viewHeight" => next.view_height = whole(name, value)?.clamp(1, 16384),
            "lines" => {
                next.lines = match value {
                    Value::Text(text) if text == "native" => 0,
                    Value::Number(_) if LINES_CHOICES.contains(&whole(name, value)?) => whole(name, value)?,
                    _ => return Err("\"lines\" is one of 720, 1080, 1440 or \"native\"".into()),
                }
            }
            "fps" => match value {
                Value::Text(text) if text == "auto" => next.fps_auto = true,
                Value::Number(_) if FPS_CHOICES.contains(&whole(name, value)?) => {
                    next.fps = whole(name, value)?;
                    next.fps_auto = false;
                }
                _ => return Err("\"fps\" is one of 30, 60, 120, 180 or \"auto\"".into()),
            },
            "viewHz" => next.view_hz = whole(name, value)?.clamp(SLOWEST_AUTO, 1000),
            "bitrateKbps" => next.bitrate_kbps = whole(name, value)?.max(1000),
            other => return Err(format!("\"{other}\" is not a setting (shape, viewWidth, viewHeight, lines, fps, viewHz, bitrateKbps)")),
        }
    }
    if next.fps_auto && next.view_hz <= 0 {
        return Err("\"fps\": \"auto\" needs viewHz (how many frames a second the viewer's own screen shows)".into());
    }
    if next.shape == Shape::Match && (next.view_width <= 0 || next.view_height <= 0) {
        return Err("\"shape\": \"match\" needs viewWidth and viewHeight (the viewer's screen in real pixels)".into());
    }
    Ok(next)
}

/// Text made safe to sit inside JSON double quotes.
pub fn quoted(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push(' '),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPEN: Limits = Limits { max_lines: 1440, max_fps: 180, max_bitrate_kbps: 50000 };

    fn asked(shape: Shape, lines: i32) -> Asked {
        Asked { shape, view_width: 0, view_height: 0, cut_width: 0, cut_height: 0, lines, fps: 60, fps_auto: false, view_hz: 0, bitrate_kbps: 20000 }
    }

    fn sizes(p: Plan) -> (i32, i32, i32, i32, i32, i32) {
        (p.region.x, p.region.y, p.region.width, p.region.height, p.width, p.height)
    }

    #[test]
    fn sixteen_nine_from_an_ultrawide() {
        assert_eq!(sizes(plan(&asked(Shape::Wide16x9, 720), &OPEN, 3440, 1440)), (440, 0, 2560, 1440, 1280, 720));
        assert_eq!(sizes(plan(&asked(Shape::Wide16x9, 1080), &OPEN, 3440, 1440)), (440, 0, 2560, 1440, 1920, 1080));
        // Asking for more lines than there are sends the piece as it is: nothing is blown up on the PC.
        assert_eq!(sizes(plan(&asked(Shape::Wide16x9, 0), &OPEN, 3440, 1440)), (440, 0, 2560, 1440, 2560, 1440));
    }

    #[test]
    fn matching_a_laptop() {
        let mut a = asked(Shape::Match, 1080);
        (a.view_width, a.view_height) = (1920, 1200);
        assert_eq!(sizes(plan(&a, &OPEN, 3440, 1440)), (568, 0, 2304, 1440, 1728, 1080));
        // The viewer's own screen is a ceiling too: a 1280x800 screen is not sent 1080 lines.
        (a.view_width, a.view_height) = (1280, 800);
        assert_eq!(sizes(plan(&a, &OPEN, 3440, 1440)), (568, 0, 2304, 1440, 1280, 800));
    }

    #[test]
    fn native_and_nearly_native() {
        assert_eq!(sizes(plan(&asked(Shape::Native, 0), &OPEN, 3440, 1440)), (0, 0, 3440, 1440, 3440, 1440));
        assert_eq!(sizes(plan(&asked(Shape::Native, 1080), &OPEN, 3440, 1440)), (0, 0, 3440, 1440, 2580, 1080));
        // "21:9" is within 3% of 3440x1440, so it is all of that screen.
        assert_eq!(sizes(plan(&asked(Shape::Wide21x9, 0), &OPEN, 3440, 1440)), (0, 0, 3440, 1440, 3440, 1440));
        // A shape wider than the screen keeps the full width and loses top and bottom.
        assert_eq!(sizes(plan(&asked(Shape::Wide21x9, 0), &OPEN, 1920, 1080)), (0, 128, 1920, 822, 1920, 822));
        assert_eq!(sizes(plan(&asked(Shape::Old4x3, 720), &OPEN, 1920, 1080)), (240, 0, 1440, 1080, 960, 720));
    }

    #[test]
    fn the_cut_the_measuring_runs_use() {
        let mut a = asked(Shape::Cut, 0);
        (a.cut_width, a.cut_height) = (1920, 1080);
        assert_eq!(sizes(plan(&a, &OPEN, 3440, 1440)), (760, 180, 1920, 1080, 1920, 1080));
    }

    #[test]
    fn limits_and_the_match_cap_win() {
        let mut a = asked(Shape::Native, 0);
        (a.fps, a.bitrate_kbps) = (180, 40000);
        let p = plan(&a, &OPEN.within(MATCH_CAP), 3440, 1440);
        assert_eq!((p.width, p.height, p.fps, p.bitrate_kbps), (2580, 1080, 60, 12000));
        let p = plan(&a, &Limits { max_lines: 1440, max_fps: 144, max_bitrate_kbps: 50000 }, 3440, 1440);
        assert_eq!((p.width, p.height, p.fps, p.bitrate_kbps), (3440, 1440, 144, 40000));
    }

    #[test]
    fn frames_a_second_on_auto() {
        // A 180 Hz PC: the viewer's own rate, whatever whole number it is, up to the PC's.
        let mut a = asked(Shape::Wide16x9, 1080);
        a.fps_auto = true;
        for (view_hz, sent) in [(144, 144), (165, 165), (60, 60), (240, 180), (30, 30), (10, 24)] {
            a.view_hz = view_hz;
            assert_eq!(plan(&a, &OPEN, 3440, 1440).fps, sent, "a {view_hz} Hz viewer");
        }
        // A slower PC screen, a host limit and the match cap all still win.
        a.view_hz = 144;
        assert_eq!(plan(&a, &Limits { max_lines: 1440, max_fps: 120, max_bitrate_kbps: 50000 }, 3440, 1440).fps, 120);
        assert_eq!(plan(&a, &OPEN.within(MATCH_CAP), 3440, 1440).fps, 60);
        // AUTO before any viewer has said its rate falls back on the fixed number.
        a.view_hz = 0;
        assert_eq!(plan(&a, &OPEN, 3440, 1440).fps, 60);
        // Asking: AUTO needs the rate; a fixed number switches AUTO off again.
        let start = asked(Shape::Wide16x9, 1080);
        assert!(take_request(&start, &parse_flat(r#"{"fps":"auto"}"#).unwrap()).is_err());
        let auto = take_request(&start, &parse_flat(r#"{"fps":"auto","viewHz":144}"#).unwrap()).unwrap();
        assert_eq!((auto.fps_auto, auto.view_hz, auto.fps), (true, 144, 60));
        let fixed = take_request(&auto, &parse_flat(r#"{"fps":120}"#).unwrap()).unwrap();
        assert_eq!((fixed.fps_auto, fixed.fps), (false, 120));
        assert!(take_request(&start, &parse_flat(r#"{"fps":"fast"}"#).unwrap()).is_err());
    }

    #[test]
    fn requests() {
        let start = asked(Shape::Wide16x9, 1080);
        let pairs = parse_flat(r#" { "shape": "match", "viewWidth": 1920, "viewHeight": 1200, "lines": "native", "fps": 30 } "#).unwrap();
        let next = take_request(&start, &pairs).unwrap();
        assert_eq!((next.shape, next.view_width, next.view_height, next.lines, next.fps, next.bitrate_kbps), (Shape::Match, 1920, 1200, 0, 30, 20000));
        assert!(take_request(&start, &parse_flat(r#"{"shape":"match"}"#).unwrap()).is_err());
        assert!(take_request(&start, &parse_flat(r#"{"shape":"cut"}"#).unwrap()).is_err());
        assert!(take_request(&start, &parse_flat(r#"{"fps":75}"#).unwrap()).is_err());
        assert!(take_request(&start, &parse_flat(r#"{"lines":900}"#).unwrap()).is_err());
        assert!(take_request(&start, &parse_flat(r#"{"colour":"red"}"#).unwrap()).is_err());
        assert!(parse_flat(r#"{"shape":{"a":1}}"#).is_err());
        assert!(parse_flat("[1]").is_err());
        assert_eq!(parse_flat("{}").unwrap(), vec![]);
    }
}
