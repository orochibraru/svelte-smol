use std::{
    convert::Infallible,
    path::PathBuf,
    rc::Rc,
    sync::{Mutex, OnceLock},
};

use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::{
    body::{Bytes, Frame},
    service::service_fn,
    Request, Response, StatusCode,
};
use hyper_util::rt::TokioIo;
use llrt_core::{
    function::This, prelude::Func, vm::Vm, Ctx, Function, Object, Promise, TypedArray,
};
use rusqlite::Connection;
use serde_json::{json, Value as JsonValue};
use tokio::{
    net::TcpListener,
    sync::{mpsc, oneshot},
};
use tokio_stream::wrappers::ReceiverStream;

// The SvelteKit server bundle, baked into the binary at compile time.
const BUNDLE: &str = include_str!("../bundle.js");

type Body = BoxBody<Bytes, Infallible>;

/// Static asset directory (client/ + prerendered/), served by Rust, not JS.
fn assets_dir() -> PathBuf {
    std::env::var("ASSETS_DIR").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."))
}

async fn serve_static(path: &str) -> Option<(Vec<u8>, &'static str)> {
    // ponytail: prefix check only; hyper already rejects malformed targets, and
    // SvelteKit asset paths are hashed. Swap for a canonicalize() check if this
    // ever serves user-supplied paths.
    if path.contains("..") {
        return None;
    }
    for dir in ["client", "prerendered"] {
        let mut p = assets_dir().join(dir).join(path.trim_start_matches('/'));
        if p.is_dir() {
            p = p.join("index.html");
        }
        if let Ok(bytes) = tokio::fs::read(&p).await {
            let mime = match p.extension().and_then(|e| e.to_str()) {
                Some("html") => "text/html",
                Some("js") => "text/javascript",
                Some("css") => "text/css",
                Some("svg") => "image/svg+xml",
                Some("json") => "application/json",
                Some("png") => "image/png",
                Some("woff2") => "font/woff2",
                _ => "application/octet-stream",
            };
            return Some((bytes, mime));
        }
    }
    None
}

type Head = (u16, Vec<(String, String)>, Option<String>);

/// Hand one request to QuickJS. The JS side returns `{status, headers, reader}`
/// where `reader` is the Response body's ReadableStreamDefaultReader; the head
/// is sent back the moment it exists and the body is pumped chunk by chunk
/// into a hyper stream from a spawned task, so SvelteKit's streamed `load`
/// promises reach the client as they resolve. Every JS value stays inside the
/// context closure; only plain Rust types cross the channels.
async fn ssr(
    vm: Rc<Vm>,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
) -> (u16, Vec<(String, String)>, Body) {
    let (head_tx, head_rx) = oneshot::channel::<Head>();
    let (tx, rx) = mpsc::channel::<Result<Frame<Bytes>, Infallible>>(16);

    tokio::task::spawn_local(async move {
        vm.ctx.async_with(async |ctx| {
            let handle: Function = ctx.globals().get("__handle").expect("__handle missing");
            let hdrs = Object::new(ctx.clone()).unwrap();
            for (k, v) in headers {
                hdrs.set(k, v).ok();
            }
            // Bytes cross as a Uint8Array, a valid BodyInit — no lossy string.
            let body_js = (!body.is_empty()).then(|| TypedArray::<u8>::new(ctx.clone(), body).unwrap());
            let promise: Promise = handle.call((method, url, hdrs, body_js)).expect("__handle threw");
            let res: Object = match promise.into_future().await {
                Ok(v) => v,
                Err(e) => {
                    let _ = head_tx.send((500, Vec::new(), Some(format!("SSR error: {e}"))));
                    return;
                },
            };
            let status: u16 = res.get("status").unwrap_or(500);
            let out = res
                .get::<_, Object>("headers")
                .map(|h| h.props::<String, String>().flatten().collect())
                .unwrap_or_default();
            let reader: Option<Object> = res.get("reader").unwrap_or(None);
            let _ = head_tx.send((status, out, None));

            let Some(reader) = reader else { return };
            let read: Function = reader.get("read").expect("reader.read");
            loop {
                let next: Promise = read.call((This(reader.clone()),)).expect("read()");
                let r: Object = match next.into_future().await {
                    Ok(r) => r,
                    Err(_) => break,
                };
                if r.get::<_, bool>("done").unwrap_or(true) {
                    break;
                }
                let chunk: TypedArray<u8> = r.get("value").expect("chunk");
                let bytes = Bytes::copy_from_slice(chunk.as_bytes().unwrap_or_default());
                if tx.send(Ok(Frame::data(bytes))).await.is_err() {
                    // Client went away: tell the stream so kit stops rendering.
                    if let Ok(cancel) = reader.get::<_, Function>("cancel") {
                        let _: Result<llrt_core::Value, _> = cancel.call((This(reader),));
                    }
                    break;
                }
            }
        })
        .await;
    });

    let (status, headers, err) = head_rx
        .await
        .unwrap_or((500, Vec::new(), Some("SSR task died".into())));
    let body = match err {
        Some(msg) => Full::new(Bytes::from(msg)).boxed(),
        None => StreamBody::new(ReceiverStream::new(rx)).boxed(),
    };
    (status, headers, body)
}

async fn handle(vm: Rc<Vm>, req: Request<hyper::body::Incoming>) -> Result<Response<Body>, Infallible> {
    let path = req.uri().path().to_string();

    if let Some((bytes, mime)) = serve_static(&path).await {
        return Ok(Response::builder()
            .header("content-type", mime)
            .body(Full::new(Bytes::from(bytes)).boxed())
            .unwrap());
    }

    let method = req.method().to_string();
    let url = format!("http://localhost:3000{}", req.uri().path_and_query().map(|p| p.as_str()).unwrap_or("/"));
    let headers: Vec<(String, String)> = req
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
        .collect();
    let body = req.into_body().collect().await.map(|b| b.to_bytes().to_vec()).unwrap_or_default();

    let (status, out_headers, out_body) = ssr(vm, method, url, headers, body).await;

    let mut res = Response::builder().status(StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR));
    for (k, v) in out_headers {
        res = res.header(k, v);
    }
    Ok(res.body(out_body).unwrap())
}

/// One binding, to show what a `bun:sqlite` replacement costs: a Rust crate
/// wired to a JS global. Rows come back as a JSON string — the laziest bridge
/// that preserves types, and JSON.parse in QuickJS is C-speed.
static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

fn sqlite_query(sql: &str) -> String {
    // ponytail: blocking call on the JS thread. Fine — QuickJS is
    // single-threaded anyway and SQLite is local. Move to spawn_blocking with a
    // promise if a slow query ever blocks request handling.
    let db = DB.get().expect("db").lock().unwrap();
    let mut stmt = match db.prepare(sql) {
        Ok(s) => s,
        Err(e) => return json!({ "error": e.to_string() }).to_string(),
    };
    let cols: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let rows = stmt.query_map([], |row| {
        let mut obj = serde_json::Map::new();
        for (i, col) in cols.iter().enumerate() {
            obj.insert(
                col.clone(),
                match row.get::<_, rusqlite::types::Value>(i)? {
                    rusqlite::types::Value::Integer(v) => json!(v),
                    rusqlite::types::Value::Real(v) => json!(v),
                    rusqlite::types::Value::Text(v) => json!(v),
                    _ => JsonValue::Null,
                },
            );
        }
        Ok(JsonValue::Object(obj))
    });
    match rows {
        Ok(rows) => JsonValue::Array(rows.flatten().collect()).to_string(),
        Err(e) => json!({ "error": e.to_string() }).to_string(),
    }
}

fn init_sqlite(ctx: &Ctx<'_>) -> llrt_core::Result<()> {
    let conn = Connection::open_in_memory().expect("sqlite");
    conn.execute_batch(
        "CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT);
         INSERT INTO users(name) VALUES ('Ada'), ('Linus'), ('Grace');",
    )
    .expect("seed");
    DB.set(Mutex::new(conn)).ok();
    ctx.globals().set("__sqlite", Func::from(|sql: String| sqlite_query(&sql)))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // QuickJS is single-threaded: a current-thread runtime + LocalSet keeps the
    // JS context and every future that touches it on one thread.
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let local = tokio::task::LocalSet::new();

    local.block_on(&rt, async {
        let vm = Rc::new(Vm::new().await.expect("vm"));
        vm.run_with(|ctx| init_sqlite(ctx)).await;
        vm.run(BUNDLE, false, false).await;

        let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);
        let listener = TcpListener::bind(("0.0.0.0", port)).await.expect("bind");
        println!("SvelteKit on QuickJS (Rust host) — http://localhost:{port}");

        loop {
            let (stream, _) = listener.accept().await.expect("accept");
            let vm = vm.clone();
            tokio::task::spawn_local(async move {
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service_fn(move |req| handle(vm.clone(), req)))
                    .await;
            });
        }
    })
}
