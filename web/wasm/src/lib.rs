use jagua_rs::Instant;
use jagua_rs::io::import::Importer;
use jagua_rs::probs::spp::entities::{SPInstance, SPSolution};
use jagua_rs::probs::spp::io::{export, ext_repr::ExtSPInstance, import_instance};
use rand::{SeedableRng, rngs::Xoshiro256PlusPlus};
use serde_json::json;
use sparrow::config::{DEFAULT_SPARROW_CONFIG, ShrinkDecayStrategy};
use sparrow::consts::{DEFAULT_FAIL_DECAY_RATIO_CMPR, DEFAULT_MAX_CONSEQ_FAILS_EXPL};
use sparrow::optimizer::optimize;
use sparrow::util::listener::{OptimizationPhase, ReportType, SolutionListener};
use sparrow::util::terminator::{BasicTerminator, Terminator};
use std::time::Duration;
use wasm_bindgen::prelude::*;

#[cfg(feature = "threads")]
pub use wasm_bindgen_rayon::init_thread_pool;

#[wasm_bindgen]
pub fn thread_count() -> usize {
    #[cfg(feature = "threads")]
    { rayon::current_num_threads() }
    #[cfg(not(feature = "threads"))]
    { 1 }
}

#[cfg(test)]
mod tests;

struct Listener {
    callback: js_sys::Function,
    initialized_at: Instant,
    solve_started_at: Option<Instant>,
    sequence: u32,
}

impl Listener {
    fn send(&self, value: serde_json::Value) {
        self.callback.call1(&JsValue::NULL, &JsValue::from_str(&value.to_string()))
            .expect("worker callback must accept solver messages");
    }
}

impl SolutionListener for Listener {
    fn report_phase(&mut self, phase: OptimizationPhase) {
        let now = Instant::now();
        self.solve_started_at.get_or_insert(now);
        self.send(json!({"type": "phase", "phase": format!("{phase:?}"),
            "initializationMs": self.solve_started_at.unwrap().duration_since(self.initialized_at).as_secs_f64() * 1000.0}));
    }

    fn report(&mut self, report: ReportType, solution: &SPSolution, instance: &SPInstance) {
        let feasible = matches!(report, ReportType::ExplFeas | ReportType::CmprFeas | ReportType::Final);
        self.sequence += 1;
        self.send(json!({"type": if feasible { "candidate" } else { "live" }, "sequence": self.sequence,
            "report": format!("{report:?}"),
            "elapsedMs": self.solve_started_at.unwrap_or(self.initialized_at).elapsed().as_secs_f64() * 1000.0,
            "solution": export(instance, solution, self.initialized_at)}));
    }
}

/// The worker validates normalized geometry before crossing the WASM boundary.
#[wasm_bindgen]
pub fn run(input: &str, seconds: Option<u32>, seed: &str, clearance: f32, callback: js_sys::Function) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    let initialized_at = Instant::now();
    if !matches!(seconds, None | Some(10 | 30 | 60 | 120)) || input.len() > 10 * 1024 * 1024 || !clearance.is_finite() || clearance < 0.0 {
        return Err(JsValue::from_str("Invalid duration or oversized input"));
    }
    let seed = seed.parse::<u64>().map_err(|e| JsValue::from_str(&e.to_string()))?;
    let external: ExtSPInstance = serde_json::from_str(input)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    if !external.strip_height.is_finite() || external.strip_height <= clearance || external.strip_height > 100_000.0
        || external.items.is_empty() || external.items.len() > 500
        || external.items.iter().any(|item| item.demand == 0 || item.demand > 500)
        || external.items.iter().map(|item| item.demand).sum::<u64>() > 500 {
        return Err(JsValue::from_str("Invalid strip dimensions or demand"));
    }
    let mut config = DEFAULT_SPARROW_CONFIG;
    config.expl_cfg.separator_config.n_workers = thread_count();
    config.cmpr_cfg.separator_config.n_workers = thread_count();
    if let Some(seconds) = seconds {
        config.expl_cfg.time_limit = Duration::from_secs_f64(seconds as f64 * 0.8);
        config.cmpr_cfg.time_limit = Duration::from_secs_f64(seconds as f64 * 0.2);
    }
    // Match the native CLI's early-termination mode; time limits remain upper bounds.
    config.expl_cfg.max_conseq_failed_attempts = Some(DEFAULT_MAX_CONSEQ_FAILS_EXPL);
    config.cmpr_cfg.shrink_decay = ShrinkDecayStrategy::FailureBased(DEFAULT_FAIL_DECAY_RATIO_CMPR);
    let importer = Importer::new(config.cde_config, None, (clearance > 0.0).then_some(clearance), None);
    let instance = import_instance(&importer, &external)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mut listener = Listener { callback, initialized_at, solve_started_at: None, sequence: 0 };
    optimize(instance, Xoshiro256PlusPlus::seed_from_u64(seed), &mut listener,
        &mut WebTerminator { timed: seconds.is_some(), inner: BasicTerminator::new() }, &config.expl_cfg, &config.cmpr_cfg, None);
    listener.send(json!({"type": "finished"}));
    Ok(())
}

// Automatic runs rely on the optimizer's failure-based stopping rules.
// The supervising worker handles manual Stop by terminating the runtime.
struct WebTerminator {
    timed: bool,
    inner: BasicTerminator,
}

impl Terminator for WebTerminator {
    fn kill(&self) -> bool { self.inner.kill() }
    fn new_timeout(&mut self, timeout: Duration) {
        if self.timed { self.inner.new_timeout(timeout); }
    }
    fn timeout_at(&self) -> Option<Instant> { self.inner.timeout_at() }
}
