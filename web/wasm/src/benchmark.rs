//! Fixed-work comparison of the same solver on native and browser runtimes.
use super::*;
use sparrow::util::listener::SeparationResult;
use std::cell::Cell;

#[wasm_bindgen]
pub fn benchmark(input: &str, seed: u32, separations_per_phase: u32) -> String {
    assert!((1..=100_000).contains(&separations_per_phase));
    let start = Instant::now();
    let external: ExtSPInstance = serde_json::from_str(input).unwrap();
    let config = solver_config("standard", 1, None).unwrap();
    let importer = Importer::new(config.cde_config, None, None, None);
    let instance = import_instance(&importer, &external).unwrap();
    let imported_ms = start.elapsed().as_secs_f64() * 1000.0;
    let completed = Cell::new(0);
    let mut listener = Measurements {
        start,
        construction_ms: 0.0,
        evaluations: 0,
        reports: 0,
        completed: &completed,
        separation_trace: Vec::new(),
    };
    let solution = optimize(
        instance.clone(),
        Xoshiro256PlusPlus::seed_from_u64(seed.into()),
        &mut listener,
        &mut WorkLimit {
            completed: &completed,
            limit: separations_per_phase,
        },
        &config.expl_cfg,
        &config.cmpr_cfg,
        None,
    )
    .unwrap();
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let external = export(&instance, &solution, start);
    let placement_bits: Vec<_> = external
        .layout
        .placed_items
        .iter()
        .map(|item| {
            let transform = &item.transformation;
            (
                item.item_id,
                transform.rotation.to_bits(),
                transform.translation.0.to_bits(),
                transform.translation.1.to_bits(),
            )
        })
        .collect();
    json!({"placementBits": placement_bits, "widthBits": external.strip_width.to_bits(),
        "separationTrace": listener.separation_trace, "elapsedMs": elapsed_ms, "importMs": imported_ms,
        "constructionMs": listener.construction_ms - imported_ms,
        "searchMs": elapsed_ms - listener.construction_ms,
        "evaluations": listener.evaluations, "reports": listener.reports,
        "solution": external}).to_string()
}

struct Measurements<'a> {
    completed: &'a Cell<u32>,
    separation_trace: Vec<(bool, usize, usize, usize)>,
    start: Instant,
    construction_ms: f64,
    evaluations: usize,
    reports: usize,
}

impl SolutionListener for Measurements<'_> {
    fn report_phase(&mut self, phase: OptimizationPhase) {
        if matches!(phase, OptimizationPhase::Exploration) {
            self.construction_ms = self.start.elapsed().as_secs_f64() * 1000.0;
        }
    }
    fn report(&mut self, _: ReportType, _: &SPSolution, _: &SPInstance) {
        self.reports += 1;
    }
    fn report_separation_result(&mut self, result: SeparationResult) {
        self.separation_trace.push((
            result.success,
            result.total_evals,
            result.total_moves,
            result.iterations,
        ));
        self.evaluations += result.total_evals;
        self.completed.set(self.completed.get() + 1);
    }
}

// Complete whole separation attempts, with the same budget in each phase.
// Seeds and scalar arithmetic must match before comparing execution time.
struct WorkLimit<'a> {
    completed: &'a Cell<u32>,
    limit: u32,
}

impl Terminator for WorkLimit<'_> {
    fn kill(&self) -> bool {
        self.completed.get() >= self.limit
    }
    fn new_timeout(&mut self, _: Duration) {
        self.completed.set(0);
    }
    fn timeout_at(&self) -> Option<Instant> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_limit_counts_completed_separations_and_resets_for_each_phase() {
        let completed = Cell::new(0);
        let mut limit = WorkLimit {
            completed: &completed,
            limit: 2,
        };
        for _ in 0..10 {
            assert!(!limit.kill());
        }
        completed.set(1);
        assert!(!limit.kill());
        completed.set(2);
        assert!(limit.kill());
        limit.new_timeout(Duration::ZERO);
        assert!(!limit.kill());
        assert_eq!(limit.timeout_at(), None);
    }
}
