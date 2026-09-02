use std::fs;
use std::path::Path;

use crate::error::{ItehaasError, Result};
use crate::hash::Hash;
use crate::object::Object;

/// Get file content at commit hash, if exists
fn get_file_at_commit(repo: &Path, commit_hash: &Hash, file_path: &str) -> Result<Option<Vec<String>>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let obj = crate::object::store::read_object(repo, commit_hash, hasher.as_ref())?;
    let commit = match obj {
        Object::Commit(c) => c,
        _ => return Err(ItehaasError::Other("not a commit".into())),
    };
    let map = crate::tree_builder::flatten_tree_root(repo, &commit.tree, hasher.as_ref())?;
    if let Some((hash, _mode)) = map.get(file_path) {
        let content = crate::diff::get_blob_content(repo, hash, hasher.as_ref())?;
        let text = String::from_utf8_lossy(&content);
        Ok(Some(text.lines().map(|s| s.to_string()).collect()))
    } else {
        Ok(None)
    }
}

/// Blame file: returns Vec<(line_no, line_content, commit_hash, author)>
pub fn blame_file(repo: &Path, file_path: &str) -> Result<Vec<(usize, String, String, String)>> {
    let current_abs = repo.join(file_path);
    if !current_abs.exists() {
        return Err(ItehaasError::Other(format!("file '{}' not found", file_path)));
    }
    let current_content = fs::read_to_string(&current_abs)?;
    let current_lines: Vec<String> = current_content.lines().map(|s| s.to_string()).collect();
    if current_lines.is_empty() {
        return Ok(vec![]);
    }

    // Get log for file (follow)
    let opts = crate::revwalk::LogOptions {
        follow: Some(file_path.to_string()),
        ..Default::default()
    };
    let log = crate::revwalk::walk_log(repo, &opts)?;
    // If file never committed, blame to working tree? Just return current with HEAD
    if log.is_empty() {
        let head = crate::refs::resolve_head(repo)?.map(|h| h.hex()).unwrap_or_else(|| "0000000".to_string());
        return Ok(current_lines
            .into_iter()
            .enumerate()
            .map(|(i, l)| (i + 1, l, head.clone(), "Not Committed Yet".to_string()))
            .collect());
    }

    // For each line, find newest commit where line was added
    let mut blamed: Vec<Option<(String, String)>> = vec![None; current_lines.len()];

    // Iterate log from newest to oldest
    for entry in log.iter() {
        let parent_content = if entry.commit.parents.is_empty() {
            None
        } else {
            get_file_at_commit(repo, &entry.commit.parents[0], file_path).unwrap_or(None)
        };
        let commit_content = get_file_at_commit(repo, &entry.hash, file_path).unwrap_or(None);

        // If commit doesn't have file, skip
        let commit_lines = match commit_content {
            Some(c) => c,
            None => continue,
        };
        let parent_lines = parent_content.unwrap_or_default();

        // Compute diff parent -> commit, find added lines
        let parent_text = parent_lines.join("\n");
        let commit_text = commit_lines.join("\n");
        let diff = similar::TextDiff::from_lines(&parent_text, &commit_text);
        let mut added_lines: Vec<String> = Vec::new();
        for op in diff.ops() {
            for change in diff.iter_changes(op) {
                if change.tag() == similar::ChangeTag::Insert {
                    added_lines.push(change.value().trim_end_matches('\n').to_string());
                }
            }
        }
        // For each current line not yet blamed, if it appears in added_lines, blame it
        for (i, cur_line) in current_lines.iter().enumerate() {
            if blamed[i].is_some() {
                continue;
            }
            if added_lines.contains(cur_line) {
                // Check if this commit actually contains the line at some position?
                // For simplicity, if added_lines contains it, attribute
                blamed[i] = Some((entry.hash.hex(), format!("{} <{}>", entry.commit.author.name, entry.commit.author.email)));
            }
        }
        // If all blamed, break
        if blamed.iter().all(|x| x.is_some()) {
            break;
        }
    }

    // For lines not blamed (e.g., initial commit), attribute to oldest commit that has file
    for (i, b) in blamed.iter_mut().enumerate() {
        if b.is_none() {
            // Find oldest commit that has file
            if let Some(entry) = log.last() {
                *b = Some((entry.hash.hex(), format!("{} <{}>", entry.commit.author.name, entry.commit.author.email)));
            } else {
                *b = Some(("0000000".to_string(), "Unknown".to_string()));
            }
        }
    }

    let mut out = Vec::new();
    for (i, line) in current_lines.into_iter().enumerate() {
        let (hash, author) = blamed[i].clone().unwrap();
        out.push((i + 1, line, hash, author));
    }
    Ok(out)
}
