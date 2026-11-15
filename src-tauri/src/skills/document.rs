//! The SKILL.md format: its frontmatter, the standard's rules and how it is written back.

use super::*;

/// The frontmatter as a map (unknown fields included, so editing never drops them) and the instructions.
pub(super) struct Document {
    pub(super) fields: Hash,
    pub(super) body: String,
}

#[derive(Clone)]
pub(super) struct Meta {
    pub(super) name: String,
    pub(super) description: String,
    pub(super) license: Option<String>,
    pub(super) compatibility: Option<String>,
    pub(super) metadata: BTreeMap<String, String>,
}

pub(super) fn key(name: &str) -> Yaml {
    Yaml::String(name.to_string())
}

pub(super) fn split_frontmatter(text: &str) -> Result<(String, String), String> {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let mut lines = text.split_inclusive('\n');
    let first = lines.next().unwrap_or_default();
    if first.trim_end() != "---" {
        return Err(t("native.skills.frontmatterMissing"));
    }
    let mut yaml = String::new();
    // The opening line as it is, spaces after "---" included: counting 4 would cut the body inside the YAML
    let mut consumed = first.len();
    for line in lines {
        consumed += line.len();
        if matches!(line.trim_end(), "---" | "...") {
            return Ok((yaml, text[consumed.min(text.len())..].to_string()));
        }
        yaml.push_str(line);
    }
    Err(t("native.skills.frontmatterNotClosed"))
}

pub(super) fn parse_document(text: &str) -> Result<Document, String> {
    let (yaml, body) = split_frontmatter(text)?;
    let docs = YamlLoader::load_from_str(&yaml)
        .map_err(|e| t_with("native.skills.yamlInvalid", &[("error", &e.to_string())]))?;
    let fields = match docs.into_iter().next() {
        Some(Yaml::Hash(fields)) => fields,
        Some(Yaml::Null) | None => Hash::new(),
        Some(_) => return Err(t("native.skills.yamlNotFields")),
    };
    Ok(Document {
        fields,
        body: body.trim_start_matches('\n').to_string(),
    })
}

pub(super) fn scalar(value: &Yaml) -> Option<String> {
    match value {
        Yaml::String(s) | Yaml::Real(s) => Some(s.clone()),
        Yaml::Integer(n) => Some(n.to_string()),
        Yaml::Boolean(b) => Some(b.to_string()),
        _ => None,
    }
}

pub(super) fn text_field(fields: &Hash, name: &str) -> Option<String> {
    fields
        .get(&key(name))
        .and_then(scalar)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Grouped as the interface's language writes numbers: 1.310 or 1,310
pub(super) fn thousands(n: usize) -> String {
    let separator = t("native.skills.thousandsSeparator");
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push_str(&separator);
        }
        out.push(c);
    }
    out
}

/// The standard's naming rules; also what keeps a name from ever being a path like "../x".
pub(super) fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.chars().count() > NAME_MAX {
        return Err(t("native.skills.nameLength"));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(t("native.skills.nameCharacters"));
    }
    if name.starts_with('-') || name.ends_with('-') {
        return Err(t("native.skills.nameEdges"));
    }
    if name.contains("--") {
        return Err(t("native.skills.nameDoubleHyphen"));
    }
    Ok(())
}

pub(super) fn validate_description(description: &str) -> Result<(), String> {
    let length = description.chars().count();
    if length == 0 {
        return Err(t("native.skills.descriptionMissing"));
    }
    if length > DESCRIPTION_MAX {
        return Err(t_with(
            "native.skills.descriptionTooLong",
            &[("length", &thousands(length))],
        ));
    }
    Ok(())
}

pub(super) fn meta_of(document: &Document) -> Result<Meta, String> {
    let fields = &document.fields;
    let name = text_field(fields, "name").ok_or_else(|| t("native.skills.nameFieldMissing"))?;
    validate_name(&name)?;
    let description = text_field(fields, "description").unwrap_or_default();
    validate_description(&description)?;
    let compatibility = text_field(fields, "compatibility");
    if compatibility
        .as_ref()
        .is_some_and(|c| c.chars().count() > COMPATIBILITY_MAX)
    {
        return Err(t("native.skills.compatibilityTooLong"));
    }
    let metadata = match fields.get(&key("metadata")) {
        Some(Yaml::Hash(map)) => map
            .iter()
            .filter_map(|(k, v)| Some((scalar(k)?, scalar(v)?)))
            .collect(),
        _ => BTreeMap::new(),
    };
    Ok(Meta {
        name,
        description,
        license: text_field(fields, "license"),
        compatibility,
        metadata,
    })
}

pub(super) fn render(document: &Document) -> Result<String, String> {
    let mut yaml = String::new();
    YamlEmitter::new(&mut yaml)
        .dump(&Yaml::Hash(document.fields.clone()))
        .map_err(to_message)?;
    // The emitter starts with its own "---"; the closing one and the body follow
    Ok(format!(
        "{yaml}\n---\n\n{}",
        document.body.trim_start_matches('\n')
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_front_matter_whose_opening_line_has_spaces_after_it() {
        let text = "---      \nname: x\ndescription: Café\n---\nCuerpo\n";
        let (yaml, body) = split_frontmatter(text).unwrap();
        assert_eq!(yaml, "name: x\ndescription: Café\n");
        assert_eq!(body, "Cuerpo\n");
    }
}
