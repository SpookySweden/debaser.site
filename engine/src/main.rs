//! DEBASER_OS's own screen engine (SPEC-screens.md). So far: `bench-encode`, which grabs the main screen, encodes it
//! on the NVIDIA chip with the low-delay recipe, and reports how long each step takes on this PC; and `serve`
//! (serve.rs), which sends that live to a web browser over WebRTC.

use std::env;
use std::fmt::Write as _;
use std::fs;
use std::io::Write as _;
use std::path::PathBuf;
use std::process::ExitCode;

mod control;
mod native;
mod serve;
mod settings;

use crate::native::DEFAULT_TWEAKS;

struct Stats {
    count: usize,
    p50: f64,
    p95: f64,
    p99: f64,
    max: f64,
    mean: f64,
}

fn stats(values: &[f64]) -> Option<Stats> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |p: f64| sorted[(((p / 100.0) * sorted.len() as f64).ceil() as usize).saturating_sub(1).min(sorted.len() - 1)];
    Some(Stats {
        count: sorted.len(),
        p50: at(50.0),
        p95: at(95.0),
        p99: at(99.0),
        max: sorted[sorted.len() - 1],
        mean: sorted.iter().sum::<f64>() / sorted.len() as f64,
    })
}

fn line(label: &str, s: &Option<Stats>) -> String {
    match s {
        None => format!("  {label:<34} no frames"),
        Some(s) => format!(
            "  {label:<34} middle {:>6.2} ms   worst 5% {:>6.2} ms   p99 {:>6.2}   slowest {:>6.2}   ({} frames)",
            s.p50, s.p95, s.p99, s.max, s.count
        ),
    }
}

fn json(label: &str, s: &Option<Stats>) -> String {
    match s {
        None => format!("\"{label}\": null"),
        Some(s) => format!(
            "\"{label}\": {{\"frames\": {}, \"p50Ms\": {:.3}, \"p95Ms\": {:.3}, \"p99Ms\": {:.3}, \"maxMs\": {:.3}, \"meanMs\": {:.3}}}",
            s.count, s.p50, s.p95, s.p99, s.max, s.mean
        ),
    }
}

struct Args {
    name: String,
    width: i32,
    height: i32,
    fps: i32,
    bitrate: i32,
    frames: i32,
    hevc: bool,
    intra: bool,
    preset: i32,
    tweaks: i32,
    dump: Option<String>,
    out: Option<String>,
}

fn parse(args: &[String]) -> Result<Args, String> {
    let mut a = Args { name: "encode".into(), width: 0, height: 0, fps: 60, bitrate: 20000, frames: 600, hevc: false, intra: false, preset: 1, tweaks: DEFAULT_TWEAKS, dump: None, out: None };
    let mut i = 0;
    while i < args.len() {
        let key = args[i].as_str();
        let mut value = || -> Result<String, String> {
            i += 1;
            args.get(i).cloned().ok_or_else(|| format!("{key} needs a value"))
        };
        match key {
            "--name" => a.name = value()?,
            "--width" => a.width = value()?.parse().map_err(|_| "--width is a number")?,
            "--height" => a.height = value()?.parse().map_err(|_| "--height is a number")?,
            "--fps" => a.fps = value()?.parse().map_err(|_| "--fps is a number")?,
            "--bitrate" => a.bitrate = value()?.parse().map_err(|_| "--bitrate is a number (kbit/s)")?,
            "--frames" => a.frames = value()?.parse().map_err(|_| "--frames is a number")?,
            "--preset" => a.preset = value()?.parse().map_err(|_| "--preset is 1 to 7")?,
            "--tweaks" => a.tweaks = value()?.parse().map_err(|_| "--tweaks is a number")?,
            "--dump" => a.dump = Some(value()?),
            "--out" => a.out = Some(value()?),
            "--hevc" => a.hevc = true,
            "--intra-refresh" => a.intra = true,
            other => return Err(format!("unknown option {other}")),
        }
        i += 1;
    }
    if a.frames < 1 || a.frames > 100_000 {
        return Err("--frames must be between 1 and 100000".into());
    }
    Ok(a)
}

fn bench_encode(args: &[String]) -> ExitCode {
    let a = match parse(args) {
        Ok(a) => a,
        Err(why) => {
            eprintln!("{why}");
            return ExitCode::from(2);
        }
    };
    let frames = a.frames as usize;
    let mut copy = vec![0f64; frames];
    let mut encode = vec![0f64; frames];
    let mut present = vec![0f64; frames];
    let mut bytes = vec![0i32; frames];
    let not_measured = |why: String| {
        eprintln!("NOT MEASURED. {why}");
        ExitCode::from(2)
    };
    // `--width`/`--height` mean a piece of that size cut from the middle of the screen, sent as it is (no scaling).
    let Some((screen_width, screen_height, _)) = native::screen() else {
        return not_measured("No main screen found".into());
    };
    let width = (if a.width > 0 { a.width.min(screen_width) } else { screen_width }) & !1;
    let height = (if a.height > 0 { a.height.min(screen_height) } else { screen_height }) & !1;
    let mut session = match native::Session::open(&native::Options {
        region: native::Region { x: (screen_width - width) / 2, y: (screen_height - height) / 2, width, height },
        width,
        height,
        fps: a.fps,
        bitrate_kbps: a.bitrate,
        hevc: a.hevc,
        intra_refresh: a.intra,
        preset: a.preset,
        tweaks: a.tweaks,
        skip_pointer_only: false,
    }) {
        Ok(session) => session,
        Err(why) => return not_measured(why),
    };
    let mut dump = a.dump.as_ref().and_then(|path| fs::File::create(path).ok());

    // The loop: wait for the screen to change (or one frame's time), copy, encode, time each step.
    let wait_ms = (1000 / a.fps.max(1)).max(1);
    let ticks_per_ms = session.info.ticks_per_second as f64 / 1000.0;
    let mut n = 0usize;
    let mut fresh = 0i32;
    for i in 0..frames {
        let frame = match session.next_frame(if i == 0 { 500 } else { wait_ms }, i == 0) {
            Ok(frame) => frame,
            Err(why) => return not_measured(why),
        };
        if let Some(file) = dump.as_mut() {
            let _ = file.write_all(frame.data);
        }
        copy[i] = frame.copy_ms;
        encode[i] = frame.encode_ms;
        present[i] = if frame.fresh { (frame.encoded_time - frame.present_time) as f64 / ticks_per_ms } else { -1.0 };
        bytes[i] = frame.data.len() as i32;
        n = i + 1;
        if frame.fresh {
            fresh += 1;
        }
    }
    drop(dump);
    let info = &session.info;

    // The first frame is a full picture and the encoder is still warming up: left out of the timings.
    let skip = 1.min(n);
    let grab_and_encode: Vec<f64> = (skip..n).map(|i| copy[i] + encode[i]).collect();
    let fresh_only: Vec<f64> = (skip..n).filter(|i| present[*i] >= 0.0).map(|i| present[i]).collect();
    // A frame where nothing changed is nearly free to encode, so the honest encode time is over changed frames only.
    let encode_fresh: Vec<f64> = (skip..n).filter(|i| present[*i] >= 0.0).map(|i| encode[i]).collect();
    let s_encode_fresh = stats(&encode_fresh);
    let s_copy = stats(&copy[skip..n]);
    let s_encode = stats(&encode[skip..n]);
    let s_both = stats(&grab_and_encode);
    let s_present = stats(&fresh_only);
    let sizes: Vec<f64> = bytes[skip..n].iter().map(|b| *b as f64).collect();
    let s_size = stats(&sizes);
    let codec = if a.hevc { "HEVC" } else { "H.264" };

    println!();
    println!("DEBASER ENGINE :: bench-encode :: {}", a.name);
    println!(
        "  screen {}x{} at {} Hz; encoding {}x{} {} at {} fps, {} kbit/s, preset P{}{}, tweaks {}",
        info.screen_width,
        info.screen_height,
        info.screen_hz,
        info.encode_width,
        info.encode_height,
        codec,
        a.fps,
        a.bitrate,
        a.preset,
        if a.intra { ", gradual repair on" } else { "" },
        a.tweaks
    );
    println!("  NVIDIA encoder interface: engine {}.{}, driver {}.{}", info.header_api >> 4, info.header_api & 0xf, info.driver_api >> 4, info.driver_api & 0xf);
    println!("  frames encoded {} ({} from real changes on screen, the rest repeats)", n, fresh);
    println!("{}", line("take the frame + copy on the card", &s_copy));
    println!("{}", line("encode (to finished frame in memory)", &s_encode));
    println!("{}", line("encode, changed frames only", &s_encode_fresh));
    println!("{}", line("both", &s_both));
    println!("{}", line("Windows showing it -> encoded", &s_present));
    if let Some(s) = &s_size {
        println!("  frame size: middle {:.1} KB, worst 5% {:.1} KB, largest {:.1} KB; first (full picture) {:.1} KB", s.p50 / 1024.0, s.p95 / 1024.0, s.max / 1024.0, bytes[0] as f64 / 1024.0);
    }

    let dir = a.out.map(PathBuf::from).unwrap_or_else(|| PathBuf::from("bench").join("results"));
    if fs::create_dir_all(&dir).is_ok() {
        let mut text = String::new();
        let _ = write!(
            text,
            "{{\n  \"name\": \"{}\",\n  \"kind\": \"bench-encode\",\n  \"screen\": \"{}x{}@{}\",\n  \"encode\": \"{}x{}\",\n  \"codec\": \"{}\",\n  \"fps\": {},\n  \"bitrateKbps\": {},\n  \"preset\": {},\n  \"intraRefresh\": {},\n  \"tweaks\": {},\n  \"framesEncoded\": {},\n  \"freshFrames\": {},\n  {},\n  {},\n  {},\n  {},\n  {},\n  \"firstFrameBytes\": {},\n  \"medianFrameBytes\": {}\n}}\n",
            a.name.replace('"', ""),
            info.screen_width,
            info.screen_height,
            info.screen_hz,
            info.encode_width,
            info.encode_height,
            codec,
            a.fps,
            a.bitrate,
            a.preset,
            a.intra,
            a.tweaks,
            n,
            fresh,
            json("copy", &s_copy),
            json("encode", &s_encode),
            json("encodeChangedOnly", &s_encode_fresh),
            json("copyAndEncode", &s_both),
            json("presentToEncoded", &s_present),
            bytes[0],
            s_size.as_ref().map_or(0.0, |s| s.p50) as i64
        );
        let file = dir.join(format!("{}.json", a.name.replace(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'), "-")));
        if fs::write(&file, text).is_ok() {
            println!("  saved {}", file.display());
        }
    }
    ExitCode::SUCCESS
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("bench-encode") => bench_encode(&args[1..]),
        Some("serve") => serve::serve(&args[1..]),
        Some("pointer-where") => control::pointer_where_command(&args[1..]),
        _ => {
            eprintln!("debaser-engine bench-encode [--name x] [--width W --height H] [--fps 60] [--bitrate 20000] [--frames 600] [--preset 1] [--hevc] [--intra-refresh] [--dump file] [--out folder]");
            eprintln!("debaser-engine serve {}", serve::USAGE);
            eprintln!("debaser-engine pointer-where [--cut-off]   (for bench/control-check.cjs: where the real pointer is, and what can be seen of the control strip)");
            ExitCode::from(2)
        }
    }
}
