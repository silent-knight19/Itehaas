use itehaas_lib::remote::http::{fetch_refs_http, validate_http_base};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Mutex, OnceLock};

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Spawn a one-shot local HTTP server. Returns (port, seen_paths).
/// The responder answers every request with `status_line` + fixed body.
fn one_shot_server(status_line: &'static str, body: &'static str, hits: usize) -> (u16, std::sync::Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
    let seen_clone = seen.clone();
    std::thread::spawn(move || {
        for _ in 0..hits {
            let Ok((mut stream, _)) = listener.accept() else { break };
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let path = req.lines().next().unwrap_or("").to_string();
            seen_clone.lock().unwrap().push(path);
            let resp = format!(
                "{}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                status_line,
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes());
        }
    });
    (port, seen)
}

fn allow_local() {
    std::env::set_var("ALLOW_PRIVATE_REMOTES", "true");
}

fn deny_local() {
    std::env::remove_var("ALLOW_PRIVATE_REMOTES");
    std::env::remove_var("ALLOW_LOCALHOST_REMOTE");
}

#[test]
fn test_redirect_is_never_followed_to_private_target() {
    // S19: an evil host answers 302 → http://127.0.0.1:<rebind>/api/repos/a/b.
    // redirects(0) must hold: the client errors instead of following, and the
    // private target never sees a request.
    let _guard = env_lock().lock().unwrap();
    allow_local();

    // Deterministic setup: learn the target port first, then serve the redirect.
    let (target_port, target_seen) = one_shot_server("HTTP/1.1 200 OK\r\n", "REFS", 4);
    let location = format!("http://127.0.0.1:{}/api/repos/a/b", target_port);
    let status = format!("HTTP/1.1 302 Found\r\nLocation: {}\r\n", location);
    let status_static: &'static str = Box::leak(status.into_boxed_str());
    let (evil_port, _) = one_shot_server(status_static, "", 2);

    let base = format!("http://127.0.0.1:{}/api/repos/a/b", evil_port);
    assert!(validate_http_base(&base).is_ok());
    let res = fetch_refs_http(&base);
    // Must NOT succeed via the redirect target (no refs parsing of "REFS" either).
    assert!(res.is_err(), "redirect must not be followed, got {:?}", res);
    assert!(
        target_seen.lock().unwrap().is_empty(),
        "private redirect target must see zero requests"
    );
    deny_local();
}

#[test]
fn test_localhost_roundtrip_when_explicitly_allowed() {
    // S19: with the escape hatch set, loopback transport actually works end to end
    // (proves the gate is a policy switch, not a broken transport).
    let _guard = env_lock().lock().unwrap();
    allow_local();
    let body = "{\"refs\":[],\"head\":\"main\",\"hasher\":\"sha256\"}";
    let (port, seen) = one_shot_server("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n", body, 2);
    let base = format!("http://127.0.0.1:{}/api/repos/a/b", port);
    assert!(validate_http_base(&base).is_ok());
    // refs endpoint shape is server-defined; here we only prove TCP+HTTP reach the
    // local server through the pinned resolver (parse may fail on the stub body).
    let _ = fetch_refs_http(&base);
    assert!(!seen.lock().unwrap().is_empty(), "allowed loopback must connect");
    deny_local();
}

#[test]
fn test_loopback_blocked_by_default_offline() {
    // S19: without the escape hatch, loopback never connects — no request sent.
    let _guard = env_lock().lock().unwrap();
    deny_local();
    let (port, seen) = one_shot_server("HTTP/1.1 200 OK\r\n", "REFS", 2);
    let base = format!("http://127.0.0.1:{}/api/repos/a/b", port);
    assert!(validate_http_base(&base).is_err());
    let res = fetch_refs_http(&base);
    assert!(res.is_err());
    assert!(seen.lock().unwrap().is_empty());
}
