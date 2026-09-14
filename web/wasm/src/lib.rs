use jagua_rs::Instant;
use jagua_rs::io::import::Importer;
use jagua_rs::probs::spp::entities::{SPInstance, SPProblem, SPSolution};
use jagua_rs::probs::spp::io::{export, ext_repr::{ExtSPInstance, ExtSPSolution}, import_instance, import_solution};
use rand::{SeedableRng, rngs::Xoshiro256PlusPlus};
use serde_json::json;
use sparrow::config::{DEFAULT_SPARROW_CONFIG, ShrinkDecayStrategy, SparrowConfig};
use sparrow::consts::{DEFAULT_FAIL_DECAY_RATIO_CMPR, DEFAULT_MAX_CONSEQ_FAILS_EXPL};
use sparrow::optimizer::{optimize, compress::compression_phase, separator::Separator};
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

#[cfg(feature = "benchmark")]
pub mod benchmark;

#[cfg(test)]
mod tests;

struct Listener {
    callback: js_sys::Function,
    initialized_at: Instant,
    solve_started_at: Option<Instant>,
    sequence: u32,
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
        self.sequence += 1;
        self.send(json!({"type": if feasible { "candidate" } else { "live" }, "sequence": self.sequence,
            "report": format!("{report:?}"),
            "elapsedMs": self.solve_started_at.unwrap_or(self.initialized_at).elapsed().as_secs_f64() * 1000.0,
            "solution": export(instance, solution, self.initialized_at)}));
    }
}

/// The worker validates normalized geometry before crossing the WASM boundary.
#[wasm_bindgen]
pub fn run(input: &str, seconds: Option<u32>, seed: &str, clearance: f32, preset: &str, callback: js_sys::Function, compression_start: Option<String>) -> Result<(), JsValue> {
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
    let config = solver_config(preset, thread_count(), seconds).map_err(JsValue::from_str)?;
    let importer = Importer::new(config.cde_config, None, (clearance > 0.0).then_some(clearance), None);
    let instance = import_instance(&importer, &external)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mut listener = Listener { callback, initialized_at, solve_started_at: None, sequence: 0,
        exploration_workers: config.expl_cfg.separator_config.n_workers,
        compression_workers: config.cmpr_cfg.separator_config.n_workers };
    let mut terminator = WebTerminator { timed: seconds.is_some(), inner: BasicTerminator::new() };
    if let Some(snapshot) = compression_start {
        let external_solution: ExtSPSolution = serde_json::from_str(&snapshot)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        validate_compression_start(&external, &external_solution).map_err(JsValue::from_str)?;
        let solution = import_solution(&instance, &external_solution);
        let mut problem = SPProblem::new(instance.clone());
        problem.restore(&solution);
        listener.report_phase(OptimizationPhase::Compression);
        terminator.new_timeout(config.cmpr_cfg.time_limit);
        let mut separator = Separator::new(instance.clone(), problem, Xoshiro256PlusPlus::seed_from_u64(seed), config.cmpr_cfg.separator_config);
        let compressed = compression_phase(&instance, &mut separator, &solution, &mut listener, &terminator, &config.cmpr_cfg);
        listener.report(ReportType::Final, &compressed, &instance);
    } else {
        optimize(instance, Xoshiro256PlusPlus::seed_from_u64(seed), &mut listener,
            &mut terminator, &config.expl_cfg, &config.cmpr_cfg, None)
        .map_err(|error| JsValue::from_str(&format!("No valid initial placement could be constructed for item {}. Review the part size, allowed rotations, material width, and clearance.", error.item_id)))?;
    }
    listener.send(json!({"type": "finished"}));
    Ok(())
}

// Fast search values imported from sparrow_extended/src/config.rs (FAST_SPARROW_CONFIG).
// Keep Studio's exact geometry import, user clearance and stop-condition controls.
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
}

impl Terminator for WebTerminator {
    fn kill(&self) -> bool { self.inner.kill() }
    fn new_timeout(&mut self, timeout: Duration) {
        if self.timed { self.inner.new_timeout(timeout); }
    }
    fn timeout_at(&self) -> Option<Instant> { self.inner.timeout_at() }
}

// Only native feasible snapshots are supplied by the coordinator. Check their
// dimensions and placements before importing into jagua's infallible API.
fn validate_compression_start(instance: &ExtSPInstance, solution: &ExtSPSolution) -> Result<(), &'static str> {
    if !solution.strip_width.is_finite() || solution.strip_width <= 0.0 {
        return Err("Invalid compression width");
    }
    let mut counts = vec![0_u64; instance.items.len()];
    for placement in &solution.layout.placed_items {
        let Some(count) = counts.get_mut(placement.item_id as usize) else { return Err("Invalid compression item"); };
        let transform = &placement.transformation;
        if !transform.rotation.is_finite() || !transform.translation.0.is_finite() || !transform.translation.1.is_finite() {
            return Err("Invalid compression placement");
        }
        *count += 1;
    }
    if counts.iter().zip(&instance.items).any(|(count, item)| *count != item.demand) {
        return Err("Invalid compression quantities");
    }
    Ok(())
}
