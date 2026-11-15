//! What Claude Code did in the project's folder, as the folder's cards of a reply in Nyra: the files it read, and the
//! changes it made, shown as already made (Nyra keeps no copy of what was there, so they can't be undone from it).

use std::collections::HashMap;
use std::path::{Component, Path};

use serde_json::{json, Value};

/// A tool Claude Code used in a reply and that worked
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
    /// What Claude Code recorded of its result, without the content it read
    pub result: Value,
}

/// The part of a tool's recorded result the cards use. A file's content can be large and is never shown, so only its
/// size stays; the original file only for a rewrite, the one change that needs it.
pub fn recorded_result(result: &Value) -> Value {
    let mut kept = result.clone();
    if let Some(file) = kept.get_mut("file").and_then(Value::as_object_mut) {
        let size = file
            .get("content")
            .and_then(Value::as_str)
            .map_or(0, str::len);
        file.remove("content");
        file.insert("size".into(), json!(size));
    }
    if let Some(fields) = kept.as_object_mut() {
        fields.remove("structuredPatch");
        if result["type"] != "update" {
            fields.remove("originalFile");
        }
    }
    kept
}

/// The path inside the folder, with "/" on every system; None for a file outside it. The folder's path is the real
/// one, so a file named through a link (/tmp on macOS) is compared by its real path too, while it still exists.
fn relative(root: &Path, file: &str) -> Option<String> {
    let file = Path::new(file);
    let real = crate::util::real_path(file).ok();
    let inside = file
        .strip_prefix(root)
        .ok()
        .or_else(|| real.as_deref()?.strip_prefix(root).ok())?;
    let parts: Vec<String> = inside
        .components()
        .map(|part| match part {
            Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Option<_>>()?;
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn read_entry(tool: &ToolUse, path: String) -> Value {
    let file = &tool.result["file"];
    let number = |field: &str| file[field].as_u64().unwrap_or(0);
    let (start, lines, total) = (
        number("startLine"),
        number("numLines"),
        number("totalLines"),
    );
    let mut read = json!({ "path": path, "size": number("size"), "modified": 0 });
    let whole = start <= 1 && lines >= total;
    if !whole && lines > 0 {
        read["lines"] = json!({ "from": start, "to": start + lines - 1, "total": total });
    }
    read
}

fn block(search: &Value, replace: &Value) -> Value {
    json!({ "search": search.as_str().unwrap_or_default(), "replace": replace.as_str().unwrap_or_default() })
}

fn change(tool: &ToolUse, root: &str, path: String) -> Option<Value> {
    let input = &tool.input;
    let (kind, blocks, content) = match tool.name.as_str() {
        "Edit" => (
            "edit",
            vec![block(&input["old_string"], &input["new_string"])],
            None,
        ),
        "MultiEdit" => (
            "edit",
            input["edits"]
                .as_array()?
                .iter()
                .map(|edit| block(&edit["old_string"], &edit["new_string"]))
                .collect(),
            None,
        ),
        // A rewrite of a file that existed shows as the whole file changed
        "Write" if tool.result["type"] == "update" && tool.result["originalFile"].is_string() => (
            "edit",
            vec![block(&tool.result["originalFile"], &input["content"])],
            None,
        ),
        "Write" => ("create", Vec::new(), input["content"].as_str()),
        _ => return None,
    };
    let mut change = json!({
        "id": tool.id,
        "root": root,
        "path": path,
        "kind": kind,
        "blocks": blocks,
        "status": "applied",
        "importedFrom": "claudeCode",
    });
    if let Some(content) = content {
        change["content"] = json!(content);
    }
    Some(change)
}

/// Adds to a reply the cards of what its tools did in the folder at `root` (named `folder`). Files outside it are
/// left out: Nyra only works inside the project's folder.
pub fn add_folder_cards(reply: &mut Value, tools: &[ToolUse], root: &str, folder: &str) {
    let mut reads: Vec<Value> = Vec::new();
    let mut changes = Vec::new();
    for tool in tools {
        let Some(path) = tool.input["file_path"]
            .as_str()
            .and_then(|file| relative(Path::new(root), file))
        else {
            continue;
        };
        if tool.name == "Read" {
            // Read again later: the latest read is the one that counts
            reads.retain(|read| read["path"] != path.as_str());
            reads.push(read_entry(tool, path));
        } else if let Some(change) = change(tool, root, path) {
            changes.push(change);
        }
    }
    if !reads.is_empty() {
        reply["workspaceConsult"] = json!({
            "folder": folder,
            "root": root,
            "read": reads,
            "searches": [],
            "listed": [],
            "skipped": [],
            "tokens": 0,
            "budget": 0,
        });
    }
    if !changes.is_empty() {
        reply["workspaceChanges"] = Value::Array(changes);
    }
}

/// Of the tools a session used, those that worked, by id: a failed or refused one changed nothing
pub fn worked(
    uses: Vec<(String, String, Value)>,
    results: &HashMap<String, Value>,
) -> Vec<ToolUse> {
    uses.into_iter()
        .filter_map(|(id, name, input)| {
            let result = results.get(&id)?.clone();
            Some(ToolUse {
                id,
                name,
                input,
                result,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &str, input: Value, result: Value) -> ToolUse {
        ToolUse {
            id: format!("t-{name}"),
            name: name.to_string(),
            input,
            result: recorded_result(&result),
        }
    }

    #[test]
    fn reads_and_changes_inside_the_folder_become_its_cards() {
        let tools = [
            tool(
                "Read",
                json!({ "file_path": "/proyectos/tienda/src/app.ts" }),
                json!({ "type": "text", "file": { "content": "hola", "startLine": 1, "numLines": 10, "totalLines": 10 } }),
            ),
            tool(
                "Read",
                json!({ "file_path": "/proyectos/tienda/README.md" }),
                json!({ "type": "text", "file": { "content": "x", "startLine": 5, "numLines": 3, "totalLines": 40 } }),
            ),
            tool(
                "Read",
                json!({ "file_path": "/otra/carpeta/notas.txt" }),
                json!({ "type": "text", "file": { "content": "x", "startLine": 1, "numLines": 1, "totalLines": 1 } }),
            ),
            tool(
                "Edit",
                json!({ "file_path": "/proyectos/tienda/src/app.ts", "old_string": "a", "new_string": "b" }),
                json!({ "originalFile": "todo el archivo" }),
            ),
            tool(
                "Write",
                json!({ "file_path": "/proyectos/tienda/nuevo.ts", "content": "export {}" }),
                json!({ "type": "create" }),
            ),
            tool(
                "Write",
                json!({ "file_path": "/proyectos/tienda/viejo.ts", "content": "nuevo" }),
                json!({ "type": "update", "originalFile": "antes" }),
            ),
        ];
        let mut reply = json!({ "role": "assistant", "content": "Hecho" });
        add_folder_cards(&mut reply, &tools, "/proyectos/tienda", "tienda");

        let read = &reply["workspaceConsult"]["read"];
        assert_eq!(read.as_array().unwrap().len(), 2);
        assert_eq!(read[0]["path"], "src/app.ts");
        assert_eq!(read[0]["size"], 4);
        assert!(read[0].get("lines").is_none());
        assert_eq!(read[1]["lines"], json!({ "from": 5, "to": 7, "total": 40 }));

        let changes = reply["workspaceChanges"].as_array().unwrap();
        assert_eq!(changes.len(), 3);
        assert_eq!(
            changes[0]["blocks"][0],
            json!({ "search": "a", "replace": "b" })
        );
        assert_eq!(changes[0]["status"], "applied");
        assert_eq!(changes[0]["importedFrom"], "claudeCode");
        assert_eq!(changes[1]["kind"], "create");
        assert_eq!(changes[1]["content"], "export {}");
        assert_eq!(changes[2]["blocks"][0]["search"], "antes");
    }

    #[test]
    fn keeps_no_file_content_from_the_results() {
        let kept = recorded_result(&json!({
            "type": "text",
            "file": { "content": "secreto", "numLines": 1 },
            "originalFile": "todo",
            "structuredPatch": []
        }));
        assert!(kept["file"].get("content").is_none());
        assert_eq!(kept["file"]["size"], 7);
        assert!(kept.get("originalFile").is_none());
        assert!(kept.get("structuredPatch").is_none());
    }
}
