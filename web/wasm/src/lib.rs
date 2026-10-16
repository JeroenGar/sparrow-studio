use jagua_rs::Instant;
use jagua_rs::io::import::Importer;
use jagua_rs::probs::spp::entities::{SPInstance, SPSolution};
use jagua_rs::probs::spp::io::{export, ext_repr::ExtSPInstance, import_instance};
use rand::{SeedableRng, rngs::Xoshiro256PlusPlus};
use serde_json::json;
use sparrow::config::{DEFAULT_SPARROW_CONFIG, ShrinkDecayStrategy, SparrowConfig};
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

mod svg;
mod logging;
pub mod job;

#[cfg(feature = "benchmark")]
pub mod benchmark;

#[cfg(test)]
mod tests;

struct Listener {
    callback: js_sys::Function,
    initialized_at: Instant,
    solve_started_at: Option<Instant>,
    sequence: u32,
    last_snapshot: Option<Instant>,
    exploration_workers: usize,
    compression_workers: usize,
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
            "workers": match phase { OptimizationPhase::Exploration => self.exploration_workers, OptimizationPhase::Compression => self.compression_workers },
            "initializationMs": self.solve_started_at.unwrap().duration_since(self.initialized_at).as_secs_f64() * 1000.0}));
    }

    fn report(&mut self, report: ReportType, solution: &SPSolution, instance: &SPInstance) {
        let feasible = matches!(report, ReportType::ExplFeas | ReportType::CmprFeas | ReportType::Final);
        let now = Instant::now();
        // Throttle live serialization at the source; always deliver feasible results.
        if !feasible && self.last_snapshot.is_some_and(|last| now.duration_since(last) < Duration::from_millis(100)) {
            return;
        }
        self.last_snapshot = Some(now);
        self.sequence += 1;
        self.send(json!({"type": if feasible { "candidate" } else { "live" }, "sequence": self.sequence,
            "report": format!("{report:?}"),
            "elapsedMs": self.solve_started_at.unwrap_or(self.initialized_at).elapsed().as_secs_f64() * 1000.0,
            "solution": export(instance, solution, self.initialized_at)}));
    }
}

/// The worker validates normalized geometry before crossing the WASM boundary.
#[wasm_bindgen]
pub fn run(input: &str, seconds: Option<u32>, seed: &str, clearance: f32, preset: &str, callback: js_sys::Function, interrupt: Option<js_sys::Function>) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    logging::init();
    let initialized_at = Instant::now();
    if !matches!(seconds, None | Some(10 | 30 | 60 | 120 | 300 | 600)) || input.len() > 10 * 1024 * 1024 || !clearance.is_finite() || clearance < 0.0 {
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
    let mut config = solver_config(preset, thread_count(), seconds).map_err(JsValue::from_str)?;
    config.min_item_separation = (clearance > 0.0).then_some(clearance);
    callback.call1(&JsValue::NULL, &JsValue::from_str(&json!({
        "type": "configuration", "configuration": format!("{config:#?}")
    }).to_string())).expect("worker callback must accept solver messages");
    let importer = Importer::new(config.cde_config, config.poly_simpl_tolerance, config.min_item_separation, config.narrow_concavity_cutoff_ratio);
    let instance = import_instance(&importer, &external)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mut listener = Listener { callback, initialized_at, solve_started_at: None, sequence: 0, last_snapshot: None,
        exploration_workers: config.expl_cfg.separator_config.n_workers,
        compression_workers: config.cmpr_cfg.separator_config.n_workers };
    let mut terminator = WebTerminator { timed: seconds.is_some(), inner: BasicTerminator::new(), interrupt };
    optimize(instance, Xoshiro256PlusPlus::seed_from_u64(seed), &mut listener,
        &mut terminator, &config.expl_cfg, &config.cmpr_cfg, None)
    .map_err(|error| JsValue::from_str(&format!("No valid initial placement could be constructed for item {}. Review the part size, allowed rotations, material width, and clearance.", error.item_id)))?;
    listener.send(json!({"type": "finished"}));
    Ok(())
}

// Fast search values imported from sparrow_extended/src/config.rs (FAST_SPARROW_CONFIG).
// Keep sparrow's geometry optimizations, user clearance and stop-condition controls.
fn solver_config(preset: &str, workers: usize, seconds: Option<u32>) -> Result<SparrowConfig, &'static str> {
    let mut config = DEFAULT_SPARROW_CONFIG;
    config.expl_cfg.max_conseq_failed_attempts = Some(DEFAULT_MAX_CONSEQ_FAILS_EXPL);
    config.cmpr_cfg.shrink_decay = ShrinkDecayStrategy::FailureBased(DEFAULT_FAIL_DECAY_RATIO_CMPR);
    match preset {
        "standard" => {},
        "fast" => {
            config.expl_cfg.shrink_step = 0.01;
            config.expl_cfg.max_conseq_failed_attempts = Some(10);
            config.expl_cfg.separator_config.iter_no_imprv_limit = 50;
            config.expl_cfg.separator_config.strike_limit = 2;
            config.expl_cfg.separator_config.n_workers = 2;
            config.cmpr_cfg.shrink_range = (0.0005, 0.0001);
            config.cmpr_cfg.shrink_decay = ShrinkDecayStrategy::FailureBased(0.9);
            config.cmpr_cfg.separator_config.iter_no_imprv_limit = 50;
            config.cmpr_cfg.separator_config.strike_limit = 2;
            config.cde_config.cd_threshold = 16;
        },
        _ => return Err("Invalid solver preset"),
    }
    config.expl_cfg.separator_config.n_workers = config.expl_cfg.separator_config.n_workers.min(workers);
    config.cmpr_cfg.separator_config.n_workers = config.cmpr_cfg.separator_config.n_workers.min(workers);
    if let Some(seconds) = seconds {
        config.expl_cfg.time_limit = Duration::from_secs_f64(seconds as f64 * 0.8);
        config.cmpr_cfg.time_limit = Duration::from_secs_f64(seconds as f64 * 0.2);
    }
    Ok(config)
}

// Automatic runs rely on the optimizer's failure-based stopping rules.
// The supervising worker handles manual Stop by terminating the runtime.
struct WebTerminator {
    timed: bool,
    inner: BasicTerminator,
    interrupt: Option<js_sys::Function>,
}

impl Terminator for WebTerminator {
    fn kill(&self) -> bool {
        self.inner.kill() || self.interrupt.as_ref().is_some_and(|signal|
            signal.call1(&JsValue::NULL, &JsValue::FALSE)
                .expect("worker must read the phase interrupt").as_bool().unwrap_or(false))
    }
    fn new_timeout(&mut self, timeout: Duration) {
        if let Some(signal) = &self.interrupt {
            signal.call1(&JsValue::NULL, &JsValue::TRUE).expect("worker must reset the phase interrupt");
        }
        if self.timed { self.inner.new_timeout(timeout); }
    }
    fn timeout_at(&self) -> Option<Instant> { self.inner.timeout_at() }
}

/// Checks a job input in the Sparrow Pro format: `null` when the local backend can run it, and
/// otherwise the API's error code with its field errors, as JSON.
#[wasm_bindgen]
pub fn check_job(input: &str) -> String {
    match serde_json::from_str::<sparrow_pro_schema::v1::Input>(input) {
        Err(error) => json!({"code": "invalid_job_input", "field_errors": [{"param": "/input", "message": error.to_string()}]}),
        Ok(input) => match job::check(&input) {
            Ok(()) => serde_json::Value::Null,
            Err(refusal) => serde_json::to_value(refusal).expect("refusals serialize"),
        },
    }.to_string()
}

/// Runs a checked job input in the Sparrow Pro format with open-source sparrow. `callback`
/// receives JSON messages: `started`, then `snapshot` for each better feasible layout and
/// `search` for the layout being worked on, a few times a second, then `finished`. A failure is
/// returned as JSON with the API's job error `code` and a `message`.
#[wasm_bindgen]
pub fn run_job(input: &str, time_limit_seconds: u32, auto_termination: bool, seed: f64, callback: js_sys::Function) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    logging::init();
    let started_at = Instant::now();
    let fail = |code: &str, message: String| JsValue::from_str(&json!({"code": code, "message": message}).to_string());
    let input: sparrow_pro_schema::v1::Input = serde_json::from_str(input)
        .map_err(|error| fail("invalid_job_input", error.to_string()))?;
    if let Err(refusal) = job::check(&input) {
        return Err(fail("invalid_job_input", format!("The input was refused: {:?}", refusal.field_errors)));
    }
    let job::Instance { instance: external, separation, mapping, raised_boundary } = job::instance(&input);
    let seconds = time_limit_seconds.max(1) as f64;
    let mut config = DEFAULT_SPARROW_CONFIG;
    if auto_termination {
        config.expl_cfg.max_conseq_failed_attempts = Some(DEFAULT_MAX_CONSEQ_FAILS_EXPL);
        config.cmpr_cfg.shrink_decay = ShrinkDecayStrategy::FailureBased(DEFAULT_FAIL_DECAY_RATIO_CMPR);
    }
    let threads = thread_count();
    config.expl_cfg.separator_config.n_workers = config.expl_cfg.separator_config.n_workers.min(threads);
    config.cmpr_cfg.separator_config.n_workers = config.cmpr_cfg.separator_config.n_workers.min(threads);
    config.expl_cfg.time_limit = Duration::from_secs_f64(seconds * 0.8);
    config.cmpr_cfg.time_limit = Duration::from_secs_f64(seconds * 0.2);
    config.min_item_separation = (separation > 0.0).then_some(separation);
    let importer = Importer::new(config.cde_config, config.poly_simpl_tolerance, config.min_item_separation, config.narrow_concavity_cutoff_ratio);
    let instance = import_instance(&importer, &external)
        .map_err(|error| fail("invalid_job_input", format!("Open-source sparrow could not read a part: {error}")))?;
    let diagnostics: Vec<_> = raised_boundary.map(|(requested, used)|
        json!({"kind": "boundary_separation_raised", "requested": requested, "used": used})).into_iter().collect();
    let mut listener = JobListener { callback, mapping, started_at, last_search: None, phase: None, attempts: [0, 0] };
    listener.send(json!({"type": "started", "diagnostics": diagnostics}));
    optimize(instance, Xoshiro256PlusPlus::seed_from_u64(seed as u64), &mut listener,
        &mut BasicTerminator::new(), &config.expl_cfg, &config.cmpr_cfg, None)
        .map_err(|error| fail("no_feasible_solution", format!("Part {} fits nowhere on the strip, in any permitted rotation.", input.parts[error.item_id].id)))?;
    let used = started_at.elapsed().as_secs_f64();
    let termination = if !auto_termination || used >= seconds * 0.98 { "time_limit" } else { "auto_terminated" };
    listener.send(json!({"type": "finished", "termination": termination, "replay": listener.replay()}));
    Ok(())
}

struct JobListener {
    callback: js_sys::Function,
    mapping: job::Mapping,
    started_at: Instant,
    last_search: Option<Instant>,
    phase: Option<OptimizationPhase>,
    attempts: [u64; 2],
}

impl JobListener {
    fn replay(&self) -> serde_json::Value {
        json!({"exploration_attempts": self.attempts[0], "compression_attempts": self.attempts[1]})
    }

    fn send(&self, value: serde_json::Value) {
        self.callback.call1(&JsValue::NULL, &JsValue::from_str(&value.to_string()))
            .expect("worker callback must accept job messages");
    }
}

impl SolutionListener for JobListener {
    fn report_phase(&mut self, phase: OptimizationPhase) { self.phase = Some(phase); }

    fn report_separation_result(&mut self, _result: sparrow::util::listener::SeparationResult) {
        self.attempts[matches!(self.phase, Some(OptimizationPhase::Compression)) as usize] += 1;
    }

    fn report(&mut self, report: ReportType, solution: &SPSolution, instance: &SPInstance) {
        let feasible = matches!(report, ReportType::ExplFeas | ReportType::CmprFeas | ReportType::Final);
        let now = Instant::now();
        // The search moves many times a second; a few layouts a second show it at work.
        if !feasible && self.last_search.is_some_and(|last| now.duration_since(last) < Duration::from_millis(250)) {
            return;
        }
        let external = export(instance, solution, self.started_at);
        let elapsed_seconds = now.duration_since(self.started_at).as_secs_f64();
        let solution = self.mapping.solution(&external);
        if feasible {
            self.send(json!({"type": "snapshot", "elapsed_seconds": elapsed_seconds, "solution": solution,
                "stats": self.mapping.stats(&external), "replay": self.replay()}));
        } else {
            self.last_search = Some(now);
            self.send(json!({"type": "search", "elapsed_seconds": elapsed_seconds, "solution": solution}));
        }
    }
}
