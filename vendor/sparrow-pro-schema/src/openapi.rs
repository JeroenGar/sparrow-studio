//! Corrections to the derived JSON Schemas where they would not match the JSON: enumerations that
//! clients must keep open, which the derives describe as closed.

use schemars::Schema;
use serde_json::{Value, json};

/// For an enumeration of strings with an `unknown` fallback: the known values, or any string.
pub fn open_enum(schema: &mut Schema) {
    let object = schema.ensure_object();
    let Some(Value::Array(values)) = object.remove("enum") else {
        panic!("open_enum applies to enumerations of strings")
    };
    let known: Vec<Value> = values
        .into_iter()
        .filter(|value| value != "unknown")
        .collect();
    object.remove("type");
    object.insert(
        "anyOf".into(),
        json!([{ "type": "string", "enum": known }, { "type": "string" }]),
    );
}

/// For a union tagged by a field, with an `unknown` fallback: the known variants, or an object with
/// any tag, whose other fields are not described.
pub fn open_tagged(schema: &mut Schema) {
    let object = schema.ensure_object();
    let Some(Value::Array(mut variants)) = object.remove("oneOf") else {
        panic!("open_tagged applies to tagged unions")
    };
    let unknown = variants
        .iter_mut()
        .find(|variant| {
            let properties = variant["properties"].as_object();
            properties.is_some_and(|properties| {
                properties.len() == 1
                    && properties
                        .values()
                        .next()
                        .is_some_and(|tag| tag["const"] == "unknown")
            })
        })
        .expect("the union has an unknown variant");
    let tag = unknown["properties"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    *unknown = json!({ "type": "object", "properties": { tag.clone(): { "type": "string" } }, "required": [tag] });
    // The fallback overlaps the known variants, so a value may match more than one.
    object.insert("anyOf".into(), Value::Array(variants));
}
