use log::{Level, LevelFilter, Log, Metadata, Record};
use std::sync::Once;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(inline_js = "export function capture_log(line) { globalThis.postMessage({type: 'solver-log', line, timestamp: performance.timeOrigin + performance.now()}); }")]
extern "C" {
    fn capture_log(line: &str);
}

struct DiagnosticLogger;
static LOGGER: DiagnosticLogger = DiagnosticLogger;
static INIT: Once = Once::new();

pub fn init() {
    INIT.call_once(|| {
        log::set_logger(&LOGGER).expect("the solver owns its logger");
        log::set_max_level(LevelFilter::Info);
    });
}

impl Log for DiagnosticLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool { metadata.level() <= Level::Info }
    fn log(&self, record: &Record<'_>) {
        if self.enabled(record.metadata()) {
            capture_log(&format!("{} [{}] {}", record.level(), record.target(), record.args()));
        }
    }
    fn flush(&self) {}
}
