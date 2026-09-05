use super::*;
use sparrow::consts::LBF_SAMPLE_CONFIG;
use sparrow::optimizer::lbf::LBFBuilder;

#[test]
fn clearance_is_a_full_gap_and_a_full_edge_allowance() {
    let input: ExtSPInstance = serde_json::from_value(json!({
        "name":"two rectangles", "strip_height":16,
        "items":[{"id":0,"demand":2,"allowed_orientations":[0],
            "shape":{"type":"rectangle","data":{"x_min":0,"y_min":0,"width":10,"height":10}}}]
    })).unwrap();
    let epoch = Instant::now();
    let importer = Importer::new(DEFAULT_SPARROW_CONFIG.cde_config, None, Some(2.0), None);
    let instance = import_instance(&importer, &input).unwrap();
    let builder = LBFBuilder::new(instance.clone(), Xoshiro256PlusPlus::seed_from_u64(42), LBF_SAMPLE_CONFIG).construct();
    let solution = export(&instance, &builder.prob.save(), epoch);
    let mut positions: Vec<_> = solution.layout.placed_items.iter().map(|p| p.transformation.translation).collect();
    positions.sort_by(|a,b| a.0.total_cmp(&b.0));
    let gap = positions[1].0 - positions[0].0 - 10.0;
    let edge = positions.iter().map(|p| p.1.min(16.0-p.1-10.0)).fold(f32::INFINITY, f32::min);
    println!("part gap={gap}, material edge allowance={edge}, positions={positions:?}");
    assert!((2.0-1e-4..2.1).contains(&gap));
    assert!((2.0-1e-4..2.1).contains(&edge));
}
