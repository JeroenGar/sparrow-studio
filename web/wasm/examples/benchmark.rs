fn main() {
    let args: Vec<_> = std::env::args().collect();
    let input = std::fs::read_to_string(&args[1]).unwrap();
    println!(
        "{}",
        sparrow_web::benchmark::benchmark(
            &input,
            args[2].parse().unwrap(),
            args[3].parse().unwrap()
        )
    );
}
