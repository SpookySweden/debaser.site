//! FIT THE PC TO THIS SCREEN (SPEC-screens.md): the PC really changes its own screen's mode (its size in pixels
//! and its refreshes a second) to the shape of a viewer's screen, for as long as a viewer wants that, and changes
//! it back afterwards.
//!
//! Why: a viewer with a 16:9 laptop watching an ultrawide PC either sees the PC's sides cut off or the whole
//! picture small with bars. With the PC's own screen put into a 16:9 mode, the desktop and every game on it draw
//! themselves in the viewer's shape, and nothing is cut off.
//!
//! The rules, all kept in this file:
//! - Off unless `serve` was started with `--allow-fit`.
//! - The mode found when the engine started is "the PC's own". It is what is given back.
//! - Which mode: of the modes no larger than the PC's own (in width, height and rate), the one whose shape is
//!   closest to the viewer's; of those the tallest; of that size the fastest. When nothing is closer to the
//!   viewer's shape than the PC's own mode already is, nothing is changed, and the reason is said.
//! - The PC is fitted while at least one connected viewer wants it. It goes back to its own mode when the last
//!   such viewer leaves, goes silent, or asks for its own again; when Ctrl+Alt+Shift+End is pressed on the PC;
//!   and when the engine stops.
//! - Never a change of mode while `League of Legends.exe` is running, in either direction: a new fit is refused,
//!   and a fit that is already on stays as it is until the match ends.
//! - The change is Windows' TEMPORARY kind (native/modes.cpp): nothing is saved, and Windows undoes it by itself
//!   if the engine dies.
//!
//! serve.rs decides WHEN to look (every turn of its main loop) and closes the screen share before a change is
//! carried out; what to do is decided here.
//!
//! # Pretending, for bench/fit-check.cjs only
//! With `DEBASER_PRETEND_MODES=<file>` in the environment the engine never makes a display call of any kind. The
//! file lists the modes it is to pretend the screen has, one a line as `3440x1440@180`, the PC's own first.
//! "Changing" the mode then only writes down what would have been set (shown in `/settings`, under `pcScreen`),
//! and the engine carries on as if the screen now had that size, so the piece of screen sent and MATCH's sums
//! can be checked. This PC's real mode is never changed by a check.

use crate::control::BLOCKED_BY_MATCH;
use crate::settings::quoted;

/// One mode: a size in pixels and a number of refreshes a second. (Laid out as native/modes.h has it.)
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Mode {
    pub width: i32,
    pub height: i32,
    pub hz: i32,
}

impl Mode {
    fn words(&self) -> String {
        format!("{}x{} AT {}", self.width, self.height, self.hz)
    }

    fn json(&self) -> String {
        format!("{{\"width\": {}, \"height\": {}, \"hz\": {}}}", self.width, self.height, self.hz)
    }
}

extern "C" {
    fn dbe_mode_now(mode: *mut Mode) -> i32;
    fn dbe_modes(out: *mut Mode, most: i32) -> i32;
    fn dbe_mode_would_take(mode: *const Mode) -> i32;
    fn dbe_mode_set_for_now(mode: *const Mode) -> i32;
    fn dbe_mode_give_back() -> i32;
    fn dbe_guard_fit_begin() -> i32;
    fn dbe_guard_fit_end();
    fn dbe_guard_fit_cut() -> i32;
}

/// What is said when the cut-off key on the PC put the screen back.
const PUT_BACK_AT_THE_PC: &str = "THE PC'S SCREEN WAS PUT BACK AT THE PC (CTRL+ALT+SHIFT+END)";
/// What is said when `serve` was not started with `--allow-fit`.
pub const NOT_ALLOWED: &str = "THIS PC DOES NOT ALLOW ITS SCREEN TO BE CHANGED";

/// Shapes this close to each other count as the same shape (1366x768 is "16:9"): half a percent.
const SAME_SHAPE: f64 = 0.005;

/// The mode to put the PC into for a viewer whose screen is `view_width` by `view_height`, or None when nothing
/// the PC has is closer to that shape than its own mode already is.
pub fn choose(modes: &[Mode], own: Mode, view_width: i32, view_height: i32) -> Option<Mode> {
    if view_width <= 0 || view_height <= 0 || own.width <= 0 || own.height <= 0 {
        return None;
    }
    let wanted = view_width as f64 / view_height as f64;
    // How far a mode's shape is from the viewer's: 0 is the same shape. (Taken as a ratio, so that "a third too
    // wide" and "a third too narrow" are equally far.)
    let off = |mode: &Mode| (mode.width as f64 / mode.height as f64 / wanted).ln().abs();
    // Never larger than the PC's own mode, and never faster.
    let within: Vec<&Mode> = modes.iter().filter(|m| m.width > 0 && m.height > 0 && m.width <= own.width && m.height <= own.height && m.hz > 0 && m.hz <= own.hz).collect();
    let closest = within.iter().map(|m| off(*m)).fold(f64::INFINITY, f64::min);
    if !(closest + SAME_SHAPE < off(&own)) {
        return None;
    }
    // Of the modes in that shape: the tallest, and of that size the fastest.
    within.into_iter().filter(|m| off(*m) <= closest + SAME_SHAPE).max_by_key(|m| (m.height, m.width, m.hz)).copied()
}

/// Windows' answer to a change of mode, in words.
fn windows_says(answer: i32) -> String {
    match answer {
        1 => "Windows says the PC must be restarted before it can use that mode".to_string(),
        -1 => "the graphics driver would not make the change".to_string(),
        -2 => "the monitor does not have that mode".to_string(),
        -3 => "Windows could not write its settings".to_string(),
        other => format!("Windows refused (its answer {other})"),
    }
}

/// The screen whose mode is changed: the real one, or (for the check) a pretended one.
enum Display {
    Real,
    Pretend { modes: Vec<Mode>, record: Vec<String> },
}

/// What is to be done to the PC's screen.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Step {
    /// Put it into this mode.
    To(Mode),
    /// Give it back its own.
    Back,
}

/// How FIT stands.
pub struct Fit {
    /// `--allow-fit` was given. Without it nothing here ever changes anything.
    pub allowed: bool,
    display: Display,
    /// The mode the PC had when the engine started: what is given back.
    pub own: Mode,
    /// The mode the PC is in now.
    pub now: Mode,
    /// The mode it was put into for a viewer, while it is.
    fitted: Option<Mode>,
    /// Why it is not fitted when a viewer wants it (or what else is worth saying), in plain words.
    why: Option<String>,
    /// How many connected viewers want it.
    wanted_by: usize,
    /// A mode that could not be set: not tried again until what is wanted changes.
    refused: Option<Mode>,
    /// The cut-off key on the PC is used (always in the engine; not in this file's own tests).
    use_guard: bool,
    guard_up: bool,
    /// The real screen's modes, listed once.
    listed: Option<Vec<Mode>>,
}

impl Fit {
    /// Sets FIT up as the engine starts. `real_screen` is the PC's screen as it is now (width, height, rate).
    /// With `DEBASER_PRETEND_MODES` set, the screen and its modes are pretended from that file instead.
    pub fn start(allowed: bool, real_screen: (i32, i32, i32)) -> Result<Fit, String> {
        let pretended = match std::env::var_os("DEBASER_PRETEND_MODES").filter(|path| !path.is_empty()) {
            Some(path) => {
                let text = std::fs::read_to_string(&path).map_err(|why| format!("DEBASER_PRETEND_MODES names a file that cannot be read ({why})"))?;
                let modes = pretended_modes(&text)?;
                Some(modes)
            }
            None => None,
        };
        let (display, own) = match pretended {
            Some(modes) => {
                let own = modes[0];
                (Display::Pretend { modes, record: Vec::new() }, own)
            }
            None => (Display::Real, Mode { width: real_screen.0, height: real_screen.1, hz: real_screen.2 }),
        };
        Ok(Fit { allowed, display, own, now: own, fitted: None, why: None, wanted_by: 0, refused: None, use_guard: true, guard_up: false, listed: None })
    }

    /// The screen's modes are pretended (the check's dry run): no display call is ever made.
    pub fn pretended(&self) -> bool {
        matches!(self.display, Display::Pretend { .. })
    }

    /// The pretended screen as it now is, when it is pretended. (The real one is asked of Windows by the caller.)
    pub fn pretended_screen(&self) -> Option<Mode> {
        self.pretended().then_some(self.now)
    }

    #[allow(dead_code)]
    pub fn fitted(&self) -> bool {
        self.fitted.is_some()
    }

    fn modes(&mut self) -> Vec<Mode> {
        match &self.display {
            Display::Pretend { modes, .. } => modes.clone(),
            Display::Real => self
                .listed
                .get_or_insert_with(|| {
                    let mut modes = [Mode::default(); 512];
                    // The native side fills at most `modes.len()` and says how many it filled. It only reads.
                    let count = unsafe { dbe_modes(modes.as_mut_ptr(), modes.len() as i32) }.clamp(0, modes.len() as i32) as usize;
                    modes[..count].to_vec()
                })
                .clone(),
        }
    }

    /// Whether Ctrl+Alt+Shift+End was pressed on the PC since last asked, while the screen was fitted. When it
    /// was, the caller forgets every viewer's wish for a fit (or the screen would be changed straight back), and
    /// the next `decide` gives the PC its own mode again.
    pub fn cut_off_pressed(&mut self) -> bool {
        // The native side only hands over a flag its own thread set.
        if !(self.guard_up && unsafe { dbe_guard_fit_cut() } != 0) {
            return false;
        }
        println!("  FIT: Ctrl+Alt+Shift+End was pressed on this PC: its screen goes back to its own mode");
        self.why = Some(PUT_BACK_AT_THE_PC.to_string());
        true
    }

    /// Looked at every turn of the engine's main loop: with `wanted` the screen (width, height) of the first
    /// connected viewer that wants a fit, if any does, is there anything to do to the PC's screen?
    pub fn decide(&mut self, wanted: Option<(i32, i32)>, wanted_by: usize, match_running: bool) -> Option<Step> {
        self.wanted_by = wanted_by;
        if !self.allowed {
            return None;
        }
        if match_running {
            // Never a change of mode while a match runs, in either direction.
            if wanted.is_some() && self.fitted.is_none() {
                self.why = Some(BLOCKED_BY_MATCH.to_string());
            } else if wanted.is_none() && self.fitted.is_some() {
                self.why = Some("THE PC'S SCREEN GOES BACK TO ITS OWN WHEN THE LEAGUE MATCH ENDS".to_string());
            }
            return None;
        }
        let target = match wanted {
            None => {
                // Nobody wants it: nothing to explain, except that the PC itself put it back.
                if self.why.as_deref() != Some(PUT_BACK_AT_THE_PC) {
                    self.why = None;
                }
                None
            }
            Some((width, height)) => {
                let modes = self.modes();
                let chosen = choose(&modes, self.own, width, height);
                if chosen.is_none() {
                    self.why = Some(format!("NOTHING CLOSER: THE PC'S OWN {}x{} IS ALREADY THE NEAREST ITS MONITOR HAS TO THIS SCREEN'S SHAPE ({width}x{height})", self.own.width, self.own.height));
                }
                chosen
            }
        };
        if target == self.fitted {
            if target.is_some() {
                self.why = None;
            }
            return None;
        }
        // A mode the monitor or Windows would not take is not asked for again and again.
        if target.is_some() && target == self.refused {
            return None;
        }
        self.refused = None;
        Some(match target {
            Some(mode) => Step::To(mode),
            None => Step::Back,
        })
    }

    fn guard_down(&mut self) {
        if self.guard_up {
            unsafe { dbe_guard_fit_end() };
            self.guard_up = false;
        }
    }

    /// Carries a step out. The caller has closed its screen share first (Windows withdraws it at a change of mode
    /// anyway). Returns the PC's mode as it is afterwards: the new one, or what it was when the change failed.
    pub fn carry_out(&mut self, step: Step) -> Mode {
        match step {
            Step::To(mode) => {
                // The cut-off key first. Without a way to put the screen back from the PC's own keyboard there is no fit.
                if self.use_guard && !self.guard_up {
                    if unsafe { dbe_guard_fit_begin() } != 0 {
                        unsafe { dbe_guard_fit_end() };
                        self.why = Some("REFUSED: THE PC COULD NOT SET UP ITS CUT-OFF KEY (CTRL+ALT+SHIFT+END)".to_string());
                        self.refused = Some(mode);
                        println!("  FIT: refused. Ctrl+Alt+Shift+End could not be set up as the cut-off key (another program owns it)");
                        return self.now;
                    }
                    self.guard_up = true;
                }
                let done = match &mut self.display {
                    Display::Pretend { record, .. } => {
                        record.push(format!("{{\"what\": \"set\", \"width\": {}, \"height\": {}, \"hz\": {}}}", mode.width, mode.height, mode.hz));
                        Ok(mode)
                    }
                    Display::Real => set_really(mode),
                };
                match done {
                    Ok(now) => {
                        self.fitted = Some(mode);
                        self.now = now;
                        self.why = None;
                        println!("  FIT: this PC's screen is now {} (its own: {}){}. Ctrl+Alt+Shift+End on this PC puts it back.", now.words(), self.own.words(), if self.pretended() { " (PRETENDED, for the check: nothing was changed)" } else { "" });
                    }
                    Err(why) => {
                        println!("  FIT: this PC's screen would NOT change to {}: {why}", mode.words());
                        self.why = Some(format!("THE PC'S SCREEN WOULD NOT CHANGE TO {}: {why}", mode.words()));
                        self.refused = Some(mode);
                        if self.fitted.is_none() {
                            self.guard_down();
                        }
                    }
                }
            }
            Step::Back => {
                let own = self.own;
                let done = match &mut self.display {
                    Display::Pretend { record, .. } => {
                        record.push("{\"what\": \"given back\"}".to_string());
                        Ok(own)
                    }
                    Display::Real => give_back_really(own),
                };
                self.fitted = None;
                self.refused = None;
                match done {
                    Ok(now) => {
                        self.now = now;
                        println!("  FIT: this PC's screen is back to its own, {}{}", now.words(), if self.pretended() { " (PRETENDED, for the check)" } else { "" });
                    }
                    Err((now, why)) => {
                        self.now = now;
                        println!("  FIT: this PC's screen could NOT be put back to {}: {why}. It is {}.", own.words(), now.words());
                        self.why = Some(format!("THE PC'S SCREEN COULD NOT BE PUT BACK TO {}: {why}", own.words()));
                    }
                }
                self.guard_down();
            }
        }
        self.now
    }

    /// The engine is stopping: the PC gets its own mode back, whatever else is going on.
    pub fn stop(&mut self) {
        if self.fitted.is_some() {
            self.carry_out(Step::Back);
        }
        self.guard_down();
    }

    /// For `/settings`, under "pcScreen". `yours` says whether the viewer asking is one that wants the fit.
    pub fn json(&self, yours: bool) -> String {
        let why = if !self.allowed { Some(NOT_ALLOWED.to_string()) } else { self.why.clone() };
        let record = match &self.display {
            Display::Pretend { record, .. } => format!(", \"pretended\": true, \"record\": [{}]", record.join(", ")),
            Display::Real => ", \"pretended\": false".to_string(),
        };
        format!(
            "{{\"allowed\": {}, \"own\": {}, \"now\": {}, \"fitted\": {}, \"wantedBy\": {}, \"yours\": {}, \"why\": {}{}}}",
            self.allowed,
            self.own.json(),
            self.now.json(),
            self.fitted.is_some(),
            self.wanted_by,
            yours && self.allowed,
            why.as_deref().map_or("null".to_string(), quoted),
            record
        )
    }
}

/// The PC's real mode now, when Windows says.
fn mode_now() -> Option<Mode> {
    let mut mode = Mode::default();
    // The native side only reads Windows' current mode into `mode`.
    (unsafe { dbe_mode_now(&mut mode) } == 0 && mode.width > 0 && mode.height > 0).then_some(mode)
}

/// REALLY changes the PC's screen to `mode` (temporary kind), after asking Windows whether it would take it.
/// Returns the mode the PC is in afterwards, as Windows reports it.
fn set_really(mode: Mode) -> Result<Mode, String> {
    // First only asked (nothing changes), then done.
    let would = unsafe { dbe_mode_would_take(&mode) };
    if would != 0 {
        return Err(windows_says(would));
    }
    let did = unsafe { dbe_mode_set_for_now(&mode) };
    if did != 0 {
        return Err(windows_says(did));
    }
    Ok(mode_now().unwrap_or(mode))
}

/// REALLY gives the PC's screen back the mode in Windows' settings, and makes sure that is the PC's own (the
/// mode found when the engine started). On failure: the mode the PC is left in, and why.
fn give_back_really(own: Mode) -> Result<Mode, (Mode, String)> {
    let gave = unsafe { dbe_mode_give_back() };
    let mut now = mode_now().unwrap_or(own);
    if now == own {
        return Ok(now);
    }
    // Windows' settings held something other than what the PC had when the engine started (or the call failed):
    // the PC's own mode is asked for by name.
    let named = set_really(own);
    now = mode_now().unwrap_or(now);
    if now == own {
        return Ok(now);
    }
    Err((now, named.err().unwrap_or_else(|| windows_says(gave))))
}

/// Reads the check's list of pretended modes: one a line, `3440x1440@180`, the PC's own first.
fn pretended_modes(text: &str) -> Result<Vec<Mode>, String> {
    let mut modes = Vec::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with('#')) {
        let parsed = line.split_once('@').and_then(|(size, hz)| {
            let (width, height) = size.split_once('x')?;
            Some(Mode { width: width.trim().parse().ok()?, height: height.trim().parse().ok()?, hz: hz.trim().parse().ok()? })
        });
        match parsed {
            Some(mode) if mode.width > 0 && mode.height > 0 && mode.hz > 0 => modes.push(mode),
            _ => return Err(format!("DEBASER_PRETEND_MODES: \"{line}\" is not a mode (write each as 3440x1440@180)")),
        }
    }
    if modes.is_empty() {
        return Err("DEBASER_PRETEND_MODES: the file lists no modes".into());
    }
    Ok(modes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mode(width: i32, height: i32, hz: i32) -> Mode {
        Mode { width, height, hz }
    }

    /// A monitor like this PC's: an ultrawide at 3440x1440, up to 180 a second.
    fn ultrawide() -> Vec<Mode> {
        pretended_modes(
            "3440x1440@180\n3440x1440@144\n3440x1440@120\n3440x1440@60\n2560x1440@144\n2560x1440@120\n2560x1440@60\n2560x1080@180\n2560x1080@60\n\
             1920x1200@60\n1920x1080@180\n1920x1080@144\n1920x1080@60\n1680x1050@60\n1600x1200@60\n1280x1024@75\n1280x720@60\n1024x768@75\n800x600@75\n3840x2160@60\n2560x1440@240\n",
        )
        .unwrap()
    }

    #[test]
    fn the_mode_chosen() {
        let modes = ultrawide();
        let own = modes[0];
        // A 16:9 viewer: the tallest 16:9 mode no taller than the PC's own, at the fastest rate it has for that
        // size that is not above the PC's own rate (240 is; a mode larger than the PC's own is never taken).
        assert_eq!(choose(&modes, own, 1920, 1080), Some(mode(2560, 1440, 144)));
        assert_eq!(choose(&modes, own, 1366, 768), Some(mode(2560, 1440, 144)));
        assert_eq!(choose(&modes, own, 3840, 2160), Some(mode(2560, 1440, 144)));
        // A 16:10 viewer gets the tallest 16:10 mode; a 4:3 one the tallest 4:3; a 5:4 one the only 5:4.
        assert_eq!(choose(&modes, own, 1280, 800), Some(mode(1920, 1200, 60)));
        assert_eq!(choose(&modes, own, 1024, 768), Some(mode(1600, 1200, 60)));
        assert_eq!(choose(&modes, own, 1280, 1024), Some(mode(1280, 1024, 75)));
        // A viewer in the PC's own shape, or wider than anything the monitor has: nothing closer.
        assert_eq!(choose(&modes, own, 3440, 1440), None);
        assert_eq!(choose(&modes, own, 1720, 720), None);
        assert_eq!(choose(&modes, own, 5120, 1440), None);
        // A shape the monitor has no mode for gets the nearest there is: 3:2 lies between 16:10 and 4:3, nearer 16:10.
        assert_eq!(choose(&modes, own, 2160, 1440), Some(mode(1920, 1200, 60)));
        // With the PC running at 120, nothing faster than 120 is chosen.
        assert_eq!(choose(&modes, mode(3440, 1440, 120), 1920, 1080), Some(mode(2560, 1440, 120)));
        // A PC that is already 16:9 is left alone by a 16:9 viewer, and a nonsense viewer by everyone.
        assert_eq!(choose(&modes, mode(2560, 1440, 144), 1920, 1080), None);
        assert_eq!(choose(&modes, own, 0, 1080), None);
        assert_eq!(choose(&[], own, 1920, 1080), None);
    }

    fn pretend() -> Fit {
        let modes = ultrawide();
        let own = modes[0];
        Fit { allowed: true, display: Display::Pretend { modes, record: Vec::new() }, own, now: own, fitted: None, why: None, wanted_by: 0, refused: None, use_guard: false, guard_up: false, listed: None }
    }

    fn record(fit: &Fit) -> Vec<String> {
        match &fit.display {
            Display::Pretend { record, .. } => record.clone(),
            Display::Real => Vec::new(),
        }
    }

    #[test]
    fn fitted_while_wanted_and_given_back() {
        let mut fit = pretend();
        assert_eq!(fit.decide(None, 0, false), None);
        // A 16:9 viewer asks.
        let step = fit.decide(Some((1920, 1080)), 1, false).expect("a step");
        assert_eq!(step, Step::To(mode(2560, 1440, 144)));
        assert_eq!(fit.carry_out(step), mode(2560, 1440, 144));
        assert!(fit.fitted());
        // Still wanted (by two now): nothing more to do.
        assert_eq!(fit.decide(Some((1920, 1080)), 2, false), None);
        assert!(fit.json(true).contains("\"fitted\": true, \"wantedBy\": 2, \"yours\": true, \"why\": null"));
        // The first viewer left and the one that is left has another shape: straight to that one's mode.
        let step = fit.decide(Some((1280, 800)), 1, false).expect("a step");
        assert_eq!(step, Step::To(mode(1920, 1200, 60)));
        fit.carry_out(step);
        // Nobody wants it: back to the PC's own.
        let step = fit.decide(None, 0, false).expect("a step");
        assert_eq!(step, Step::Back);
        assert_eq!(fit.carry_out(step), mode(3440, 1440, 180));
        assert!(!fit.fitted());
        assert_eq!(record(&fit), ["{\"what\": \"set\", \"width\": 2560, \"height\": 1440, \"hz\": 144}", "{\"what\": \"set\", \"width\": 1920, \"height\": 1200, \"hz\": 60}", "{\"what\": \"given back\"}"]);
        // A viewer in the PC's own shape: nothing is done, and the reason is said.
        assert_eq!(fit.decide(Some((3440, 1440)), 1, false), None);
        assert!(fit.json(true).contains("NOTHING CLOSER"), "{}", fit.json(true));
        // The engine stopping while fitted gives it back.
        let step = fit.decide(Some((1920, 1080)), 1, false).unwrap();
        fit.carry_out(step);
        fit.stop();
        assert!(!fit.fitted());
        assert_eq!(fit.now, fit.own);
    }

    #[test]
    fn never_a_change_during_a_match() {
        let mut fit = pretend();
        // A match is running: a fit is refused, and nothing is set.
        assert_eq!(fit.decide(Some((1920, 1080)), 1, true), None);
        assert!(fit.json(true).contains(BLOCKED_BY_MATCH));
        assert!(record(&fit).is_empty());
        // It ends: the fit is made.
        let step = fit.decide(Some((1920, 1080)), 1, false).unwrap();
        fit.carry_out(step);
        // A match starts while fitted and the viewer leaves: the mode is left alone until the match ends.
        assert_eq!(fit.decide(None, 0, true), None);
        assert!(fit.fitted());
        assert!(fit.json(false).contains("WHEN THE LEAGUE MATCH ENDS"));
        assert_eq!(fit.decide(None, 0, false), Some(Step::Back));
    }

    #[test]
    fn not_without_allow_fit() {
        let mut fit = pretend();
        fit.allowed = false;
        assert_eq!(fit.decide(Some((1920, 1080)), 1, false), None);
        let said = fit.json(true);
        assert!(said.contains("\"allowed\": false") && said.contains("\"yours\": false") && said.contains(NOT_ALLOWED), "{said}");
    }

    #[test]
    fn the_pretended_list_is_read() {
        assert_eq!(pretended_modes("# this PC\n 3440x1440@180 \n\n2560x1440@144\n").unwrap(), vec![mode(3440, 1440, 180), mode(2560, 1440, 144)]);
        assert!(pretended_modes("3440x1440").is_err());
        assert!(pretended_modes("\n").is_err());
    }

    #[test]
    fn the_real_modes_are_listed_without_changing_anything() {
        // Only read from Windows: the mode the PC is in now is one of the modes its monitor offers.
        let now = mode_now().expect("the PC's mode");
        let mut fit = Fit::start(false, (now.width, now.height, now.hz)).unwrap();
        if fit.pretended() {
            return;
        }
        let modes = fit.modes();
        assert!(modes.contains(&now), "{now:?} is not among {} modes", modes.len());
    }
}
