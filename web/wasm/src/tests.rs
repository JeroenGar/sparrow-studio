use super::*;
use jagua_rs::entities::Instance;
use sparrow::consts::LBF_SAMPLE_CONFIG;
use sparrow::optimizer::lbf::LBFBuilder;

#[test]
fn automatic_runs_ignore_phase_timeouts_but_timed_runs_keep_them() {
    let mut automatic = WebTerminator {
        timed: false,
        inner: BasicTerminator::new(),
    };
    automatic.new_timeout(Duration::ZERO);
    assert_eq!(automatic.timeout_at(), None);
    assert!(!automatic.kill());
    let mut timed = WebTerminator {
        timed: true,
        inner: BasicTerminator::new(),
    };
    timed.new_timeout(Duration::from_secs(10));
    assert!(timed.timeout_at().is_some());
    assert!(!timed.kill());
}

#[test]
fn clearance_is_a_full_gap_and_a_full_edge_allowance() {
    let input: ExtSPInstance = serde_json::from_value(json!({
        "name":"two rectangles", "strip_height":16,
        "items":[{"id":0,"demand":2,"allowed_orientations":[0],
            "shape":{"type":"rectangle","data":{"x_min":0,"y_min":0,"width":10,"height":10}}}]
    }))
    .unwrap();
    let epoch = Instant::now();
    let importer = Importer::new(DEFAULT_SPARROW_CONFIG.cde_config, None, Some(2.0), None);
    let instance = import_instance(&importer, &input).unwrap();
    let builder = LBFBuilder::new(
        instance.clone(),
        Xoshiro256PlusPlus::seed_from_u64(42),
        LBF_SAMPLE_CONFIG,
    )
    .construct().unwrap();
    let solution = export(&instance, &builder.prob.save(), epoch);
    let mut positions: Vec<_> = solution
        .layout
        .placed_items
        .iter()
        .map(|p| p.transformation.translation)
        .collect();
    positions.sort_by(|a, b| a.0.total_cmp(&b.0));
    let gap = positions[1].0 - positions[0].0 - 10.0;
    let edge = positions
        .iter()
        .map(|p| p.1.min(16.0 - p.1 - 10.0))
        .fold(f32::INFINITY, f32::min);
    println!("part gap={gap}, material edge allowance={edge}, positions={positions:?}");
    assert!((2.0 - 1e-4..2.1).contains(&gap));
    assert!((2.0 - 1e-4..2.1).contains(&edge));
}

#[test]
fn fast_preset_matches_imported_search_config_and_respects_worker_limit() {
    let fast = solver_config("fast", 3, None).unwrap();
    assert_eq!(fast.expl_cfg.shrink_step, 0.01);
    assert_eq!(fast.expl_cfg.max_conseq_failed_attempts, Some(10));
    assert_eq!(fast.expl_cfg.separator_config.iter_no_imprv_limit, 50);
    assert_eq!(fast.expl_cfg.separator_config.strike_limit, 2);
    assert_eq!(fast.expl_cfg.separator_config.n_workers, 2);
    assert_eq!(fast.cmpr_cfg.separator_config.n_workers, 3);
    assert_eq!(fast.cmpr_cfg.shrink_range, (0.0005, 0.0001));
    assert!(matches!(
        fast.cmpr_cfg.shrink_decay,
        ShrinkDecayStrategy::FailureBased(0.9)
    ));
    assert_eq!(fast.cmpr_cfg.separator_config.iter_no_imprv_limit, 50);
    assert_eq!(fast.cmpr_cfg.separator_config.strike_limit, 2);
    assert_eq!(fast.cde_config.cd_threshold, 16);
    let serial = solver_config("fast", 1, Some(300)).unwrap();
    assert_eq!(serial.expl_cfg.separator_config.n_workers, 1);
    assert_eq!(serial.cmpr_cfg.separator_config.n_workers, 1);
    assert_eq!(serial.expl_cfg.time_limit, Duration::from_secs(240));
    let standard = solver_config("standard", 3, None).unwrap();
    assert_eq!(
        standard.expl_cfg.shrink_step,
        DEFAULT_SPARROW_CONFIG.expl_cfg.shrink_step
    );
    assert_eq!(
        standard.cmpr_cfg.separator_config.strike_limit,
        DEFAULT_SPARROW_CONFIG
            .cmpr_cfg
            .separator_config
            .strike_limit
    );
    assert!(solver_config("unknown", 3, None).is_err());
}

#[test]
fn exact_material_fit_returns_construction_error() {
    for demand in [1, 2] {
        let input: ExtSPInstance = serde_json::from_value(json!({
            "name":"exact fit", "strip_height":60.0,
            "items":[{"id":0,"demand":demand,"allowed_orientations":[0.0],
                "shape":{"type":"rectangle","data":{"x_min":0.0,"y_min":0.0,"width":100.0,"height":60.0}}}]
        })).unwrap();
        let importer = Importer::new(DEFAULT_SPARROW_CONFIG.cde_config, None, None, None);
        let instance = import_instance(&importer, &input).unwrap();
        let error = LBFBuilder::new(instance, Xoshiro256PlusPlus::seed_from_u64(42), LBF_SAMPLE_CONFIG)
            .construct().err().expect("exact boundary contact must be rejected");
        assert_eq!(error.item_id, 0);
    }
}

#[test]
fn rectangular_boundary_contact_preserves_collision_and_collection_checks() {
    use jagua_rs::collision_detection::hazards::{
        collector::BasicHazardCollector, filter::NoFilter,
    };
    use jagua_rs::geometry::{Transformation, geo_traits::Transformable};
    use jagua_rs::probs::spp::entities::{SPPlacement, SPProblem};
    let input: ExtSPInstance = serde_json::from_value(json!({
        "name":"boundary checks", "strip_height":60.0,
        "items":[{"id":0,"demand":2,"allowed_orientations":[0.0],
            "shape":{"type":"rectangle","data":{"x_min":0.0,"y_min":0.0,"width":100.0,"height":60.0}}}]
    })).unwrap();
    let importer = Importer::new(DEFAULT_SPARROW_CONFIG.cde_config, None, None, None);
    let instance = import_instance(&importer, &input).unwrap();
    let mut prob = SPProblem::new(instance.clone());
    for y in [30.0, 30.001, 29.999] {
        let transform = Transformation::from_translation((50.0, y));
        let shape = instance.item(0).shape_cd.transform_clone(&transform);
        let cde = prob.layout.cde();
        assert!(cde.detect_poly_collision(&shape, &NoFilter));
        let mut collisions = BasicHazardCollector::new();
        cde.collect_poly_collisions(&shape, &mut collisions);
        assert!(!collisions.is_empty());
    }
    let mut interior_input = input;
    interior_input.strip_height = 62.0;
    let instance = import_instance(&importer, &interior_input).unwrap();
    prob = SPProblem::new(instance.clone());
    let interior = instance.item(0).shape_cd.transform_clone(&Transformation::from_translation((51.0, 31.0)));
    assert!(!prob.layout.cde().detect_poly_collision(&interior, &NoFilter));
    assert!(!prob.layout.cde().detect_surrogate_collision(interior.surrogate(), &Transformation::empty(), &NoFilter));
    let mut interior_collisions = BasicHazardCollector::new();
    prob.layout.cde().collect_poly_collisions(&interior, &mut interior_collisions);
    assert!(interior_collisions.is_empty());
    prob.place_item(SPPlacement {
        item_id: 0,
        d_transf: jagua_rs::geometry::DTransformation::new(0.0, (51.0, 31.0)),
    });
    let shape = instance
        .item(0)
        .shape_cd
        .transform_clone(&Transformation::from_translation((51.0, 31.0)));
    assert!(prob.layout.cde().detect_poly_collision(&shape, &NoFilter));
    let mut collisions = BasicHazardCollector::new();
    prob.layout
        .cde()
        .collect_poly_collisions(&shape, &mut collisions);
    assert!(!collisions.is_empty());
}
