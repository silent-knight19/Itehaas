use itehaas_lib::remote::http::validate_http_base;
use std::sync::{Mutex, OnceLock};

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[test]
fn test_private_ip_blocked() {
    let _guard = env_lock().lock().unwrap();
    std::env::remove_var("ALLOW_PRIVATE_REMOTES");
    std::env::remove_var("ALLOW_LOCALHOST_REMOTE");
    // Should be blocked unless ALLOW_PRIVATE_REMOTES=true
    let cases = vec![
        "http://localhost/api/repos/a/b",
        "http://localhost:3001/api/repos/a/b",
        "http://127.0.0.1/api/repos/a/b",
        "http://127.0.0.1:3001/api/repos/a/b",
        "http://10.0.0.1/api/repos/a/b",
        "http://10.255.255.255/api/repos/a/b",
        "http://172.16.0.1/api/repos/a/b",
        "http://172.31.255.255/api/repos/a/b",
        "http://192.168.1.1/api/repos/a/b",
        "http://192.168.0.1:5432/api/repos/a/b",
        "http://169.254.1.1/api/repos/a/b",
        "http://0.0.0.0/api/repos/a/b",
        "http://[::1]/api/repos/a/b",
        "http://[::1]:3001/api/repos/a/b",
        "http://[fc00::1]/api/repos/a/b",
        "http://[fe80::1]/api/repos/a/b",
        // S13: IPv4-mapped IPv6 variants
        "http://[::ffff:127.0.0.1]/api/repos/a/b",
        "http://[::ffff:169.254.169.254]/api/repos/a/b",
        "http://[::ffff:10.0.0.1]/api/repos/a/b",
        "http://[::ffff:192.168.1.1]/api/repos/a/b",
        // S13: Cloud metadata and internal domains
        "http://metadata.google.internal/api/repos/a/b",
        "http://instance-data.internal/api/repos/a/b",
        "http://kubernetes.default.svc.cluster.local/api/repos/a/b",
        // S13: Carrier-grade NAT (100.64.0.0/10)
        "http://100.64.0.1/api/repos/a/b",
        "http://100.127.255.254/api/repos/a/b",
    ];
    for url in cases {
        let res = validate_http_base(url);
        assert!(res.is_err(), "expected {} to be blocked, got {:?}", url, res);
    }
}

#[test]
fn test_public_ip_allowed() {
    let _guard = env_lock().lock().unwrap();
    let cases = vec![
        "http://93.184.216.34/api/repos/a/b",
        "https://example.com/api/repos/a/b",
        "https://itehaas.example.com/api/repos/alice/repo",
        "http://8.8.8.8/api/repos/a/b",
    ];
    for url in cases {
        let res = validate_http_base(url);
        assert!(res.is_ok(), "expected {} to be allowed, got {:?}", url, res);
    }
}

#[test]
fn test_shape_still_required() {
    let _guard = env_lock().lock().unwrap();
    // Even public IP with wrong shape should be blocked
    let res = validate_http_base("http://8.8.8.8/latest/meta-data/");
    assert!(res.is_err());
    let res2 = validate_http_base("http://127.0.0.1/latest/meta-data/");
    assert!(res2.is_err());
}

#[test]
fn test_allow_private_with_env() {
    let _guard = env_lock().lock().unwrap();
    std::env::remove_var("ALLOW_PRIVATE_REMOTES");
    std::env::set_var("ALLOW_PRIVATE_REMOTES", "true");
    let res = validate_http_base("http://127.0.0.1/api/repos/a/b");
    assert!(res.is_ok(), "with ALLOW_PRIVATE_REMOTES=true, private should be allowed");
    std::env::remove_var("ALLOW_PRIVATE_REMOTES");
    let res2 = validate_http_base("http://127.0.0.1/api/repos/a/b");
    assert!(res2.is_err());
}
