use itehaas_lib::remote::http::validate_http_base;
use std::sync::{Mutex, OnceLock};

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn clear_allow_vars() {
    std::env::remove_var("ALLOW_PRIVATE_REMOTES");
    std::env::remove_var("ALLOW_LOCALHOST_REMOTE");
}

// S13-fresh: IPv6 transition mechanisms that embed IPv4 must be decoded before
// the private-range check — otherwise link-local/loopback smuggle through.

#[test]
fn test_6to4_embedded_private_blocked() {
    let _guard = env_lock().lock().unwrap();
    clear_allow_vars();
    // 2002:7f00:0001::/48 embeds 127.0.0.1 (loopback).
    for url in [
        "http://[2002:7f00:1::1]/api/repos/a/b",
        "http://[2002:0a00:0001::1]/api/repos/a/b", // embeds 10.0.0.1
        "http://[2002:c0a8:0101::1]/api/repos/a/b", // embeds 192.168.1.1
    ] {
        let res = validate_http_base(url);
        assert!(res.is_err(), "expected {} to be blocked, got {:?}", url, res);
    }
}

#[test]
fn test_6to4_embedded_public_allowed() {
    let _guard = env_lock().lock().unwrap();
    clear_allow_vars();
    // 2002:0808:0808::/48 embeds 8.8.8.8 (public) — must stay usable.
    let res = validate_http_base("http://[2002:0808:0808::1]/api/repos/a/b");
    assert!(res.is_ok(), "public 6to4 should be allowed, got {:?}", res);
}

#[test]
fn test_teredo_embedded_private_blocked() {
    let _guard = env_lock().lock().unwrap();
    clear_allow_vars();
    // Teredo 2001::/32 with obfuscated client 127.0.0.1 (!0x7F000001 = 0x80FFFFFE).
    let res = validate_http_base("http://[2001:0000:4136:e378:8000:63bf:80ff:fffe]/api/repos/a/b");
    assert!(res.is_err(), "teredo-masked loopback must be blocked, got {:?}", res);
}

#[test]
fn test_teredo_embedded_public_allowed() {
    let _guard = env_lock().lock().unwrap();
    clear_allow_vars();
    // Teredo client 93.184.216.34 (0x5DB8D822, obfuscated 0xA24727DD).
    let res = validate_http_base("http://[2001:0000:4136:e378:8000:63bf:a247:27dd]/api/repos/a/b");
    assert!(res.is_ok(), "public teredo client should be allowed, got {:?}", res);
}

#[test]
fn test_zone_id_rejected() {
    let _guard = env_lock().lock().unwrap();
    clear_allow_vars();
    // IPv6 zone IDs break literal parsing and can smuggle link-local targets.
    for url in [
        "http://[fe80::1%eth0]/api/repos/a/b",
        "http://[fe80::1%25eth0]/api/repos/a/b",
    ] {
        let res = validate_http_base(url);
        assert!(res.is_err(), "expected {} to be blocked, got {:?}", url, res);
    }
}

#[test]
fn test_allow_private_env_forms_consistent() {
    let _guard = env_lock().lock().unwrap();
    // S13: "1" must behave like "true" everywhere (resolver and validator agreed).
    for val in ["true", "1"] {
        clear_allow_vars();
        std::env::set_var("ALLOW_PRIVATE_REMOTES", val);
        let res = validate_http_base("http://127.0.0.1/api/repos/a/b");
        assert!(res.is_ok(), "ALLOW_PRIVATE_REMOTES={} should allow, got {:?}", val, res);
        clear_allow_vars();
    }
    clear_allow_vars();
    std::env::set_var("ALLOW_LOCALHOST_REMOTE", "1");
    let res = validate_http_base("http://127.0.0.1/api/repos/a/b");
    assert!(res.is_ok(), "ALLOW_LOCALHOST_REMOTE=1 should allow, got {:?}", res);
    clear_allow_vars();
}
