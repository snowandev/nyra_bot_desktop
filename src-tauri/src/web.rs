//! Searching the web and reading pages, with nothing to set up: DuckDuckGo (its HTML and lite pages, which need no
//! key) with Wikipedia's official API as the fallback. Pages are only read from public addresses, so a page or a
//! model can't make Nyra reach the user's router, Ollama or anything else on the local network.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

use crate::i18n::{accept_language, t, t_with};
use crate::util::to_message;
use scraper::{ElementRef, Html, Node, Selector};
use serde::Serialize;
use tauri_plugin_http::reqwest::{self, header, redirect, Client, StatusCode, Url};

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RESULTS: usize = 8;
const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;
// About 5,000 tokens: enough for the gist of a page without filling a small model's context
const MAX_PAGE_CHARS: usize = 20_000;
const MAX_REDIRECTS: usize = 5;

#[derive(Serialize, Debug, PartialEq)]
pub struct SearchResult {
    title: String,
    url: String,
    snippet: String,
    source: &'static str,
}

#[derive(Serialize, Debug)]
pub struct WebPage {
    /// Where the page really is, after redirects
    url: String,
    title: String,
    text: String,
    truncated: bool,
}

fn selector(css: &str) -> Selector {
    // The selectors are constants written here; a typo would show up in the tests
    Selector::parse(css).unwrap_or_else(|_| Selector::parse("*").expect("valid selector"))
}

fn text_of(element: ElementRef) -> String {
    element
        .text()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT)
        .build()
        .map_err(to_message)
}

// ---------- Searching ----------

/// DuckDuckGo links straight to the page, or through its redirect with the target in `uddg`; ads go through y.js
fn result_url(href: &str) -> Option<String> {
    let absolute = if href.starts_with("//") {
        format!("https:{href}")
    } else {
        href.to_string()
    };
    let url = Url::parse(&absolute).ok()?;
    if url
        .host_str()
        .is_some_and(|host| host.ends_with("duckduckgo.com"))
    {
        if url.path() == "/l/" {
            return url
                .query_pairs()
                .find(|(key, _)| key == "uddg")
                .map(|(_, value)| value.into_owned());
        }
        return None;
    }
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}

fn parse_duckduckgo_html(html: &str) -> Vec<SearchResult> {
    let document = Html::parse_document(html);
    let (link, snippet) = (selector("a.result__a"), selector(".result__snippet"));
    document
        .select(&selector("div.result"))
        .filter(|result| {
            !result
                .value()
                .classes()
                .any(|class| class.starts_with("result--ad"))
        })
        .filter_map(|result| {
            let anchor = result.select(&link).next()?;
            Some(SearchResult {
                title: text_of(anchor),
                url: result_url(anchor.value().attr("href")?)?,
                snippet: result
                    .select(&snippet)
                    .next()
                    .map(text_of)
                    .unwrap_or_default(),
                source: "duckduckgo",
            })
        })
        .take(MAX_RESULTS)
        .collect()
}

/// The lite page lists links and their snippets in separate table rows, in the same order
fn parse_duckduckgo_lite(html: &str) -> Vec<SearchResult> {
    let document = Html::parse_document(html);
    let snippets: Vec<String> = document
        .select(&selector("td.result-snippet"))
        .map(text_of)
        .collect();
    document
        .select(&selector("a.result-link"))
        .enumerate()
        .filter_map(|(i, anchor)| {
            Some(SearchResult {
                title: text_of(anchor),
                url: result_url(anchor.value().attr("href")?)?,
                snippet: snippets.get(i).cloned().unwrap_or_default(),
                source: "duckduckgo",
            })
        })
        .take(MAX_RESULTS)
        .collect()
}

fn strip_tags(html: &str) -> String {
    text_of(Html::parse_fragment(html).root_element())
}

fn parse_wikipedia(json: &str, language: &str) -> Vec<SearchResult> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    value["query"]["search"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let title = item["title"].as_str()?;
            let mut url = Url::parse(&format!("https://{language}.wikipedia.org/wiki")).ok()?;
            url.path_segments_mut().ok()?.push(&title.replace(' ', "_"));
            Some(SearchResult {
                title: title.to_string(),
                url: url.to_string(),
                snippet: strip_tags(item["snippet"].as_str().unwrap_or_default()),
                source: "wikipedia",
            })
        })
        .take(MAX_RESULTS)
        .collect()
}

async fn get_text(client: &Client, url: Url) -> Result<String, String> {
    let response = client
        .get(url)
        .header(header::ACCEPT_LANGUAGE, accept_language())
        .send()
        .await
        .map_err(to_message)?;
    // DuckDuckGo answers 202 with a challenge page when it suspects a robot
    if response.status() != StatusCode::OK {
        return Err(format!("Respuesta {}", response.status()));
    }
    response.text().await.map_err(to_message)
}

fn search_url(base: &str, query: &str) -> Result<Url, String> {
    Url::parse_with_params(base, &[("q", query)]).map_err(to_message)
}

/// Each source is tried in turn; the first with results wins
#[tauri::command]
pub async fn web_search(query: String) -> Result<Vec<SearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let client = client()?;

    if let Ok(html) = get_text(
        &client,
        search_url("https://html.duckduckgo.com/html/", query)?,
    )
    .await
    {
        let results = parse_duckduckgo_html(&html);
        if !results.is_empty() {
            return Ok(results);
        }
    }
    if let Ok(html) = get_text(
        &client,
        search_url("https://lite.duckduckgo.com/lite/", query)?,
    )
    .await
    {
        let results = parse_duckduckgo_lite(&html);
        if !results.is_empty() {
            return Ok(results);
        }
    }
    for language in ["es", "en"] {
        let url = Url::parse_with_params(
            &format!("https://{language}.wikipedia.org/w/api.php"),
            &[
                ("action", "query"),
                ("list", "search"),
                ("format", "json"),
                ("utf8", "1"),
                ("srlimit", "8"),
                ("srsearch", query),
            ],
        )
        .map_err(to_message)?;
        if let Ok(json) = get_text(&client, url).await {
            let results = parse_wikipedia(&json, language);
            if !results.is_empty() {
                return Ok(results);
            }
        }
    }
    Err(t("native.web.searchFailed"))
}

// ---------- Reading a page ----------

/// Addresses that reach this computer or its network, never the public web
pub(crate) fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || a == 0
                // Carrier-grade NAT, benchmarking, multicast and reserved
                || (a == 100 && (64..128).contains(&b))
                || (a == 198 && (b == 18 || b == 19))
                || a >= 224)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped().or_else(|| embedded_ipv4(v6)) {
                return is_public(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // Unique local (fc00::/7) and link-local (fe80::/10)
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80)
        }
    }
}

/// An IPv6 address that carries an IPv4 one and reaches it: the deprecated IPv4-compatible form (::a.b.c.d), NAT64
/// (64:ff9b::/96 and the local 64:ff9b:1::/48), 6to4 (2002::/16) and Teredo (2001::/32), whose client address is
/// stored inverted. A name pointing to one of these could otherwise reach this computer or its network.
fn embedded_ipv4(v6: Ipv6Addr) -> Option<Ipv4Addr> {
    let s = v6.segments();
    let from = |high: u16, low: u16| {
        let [a, b] = high.to_be_bytes();
        let [c, d] = low.to_be_bytes();
        Ipv4Addr::new(a, b, c, d)
    };
    match s {
        [0, 0, 0, 0, 0, 0, high, low] if high != 0 => Some(from(high, low)),
        [0x64, 0xff9b, 0, 0, 0, 0, high, low] | [0x64, 0xff9b, 1, _, _, _, high, low] => {
            Some(from(high, low))
        }
        [0x2002, high, low, ..] => Some(from(high, low)),
        [0x2001, 0, ..] => Some(from(!s[6], !s[7])),
        _ => None,
    }
}

/// Resolves the host and checks every address it points to. The request then goes to that exact address, so the
/// name can't be pointed somewhere else between the check and the connection (DNS rebinding).
async fn public_address(url: &Url) -> Result<SocketAddr, String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(t("native.web.onlyWebPages"));
    }
    let host = url
        .host_str()
        .ok_or_else(|| t("native.web.invalidAddress"))?
        .to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses: Vec<SocketAddr> = tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), port)
            .to_socket_addrs()
            .map(|found| found.collect())
    })
    .await
    .map_err(to_message)?
    .map_err(|_| t("native.web.addressNotFound"))?;
    if addresses.is_empty() || !addresses.iter().all(|a| is_public(a.ip())) {
        return Err(t("native.web.notPublic"));
    }
    Ok(addresses[0])
}

/// Its body up to max bytes, and whether there was more
pub async fn read_limited(
    mut response: reqwest::Response,
    max: usize,
) -> Result<(Vec<u8>, bool), String> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(to_message)? {
        let room = max - body.len();
        if chunk.len() >= room {
            body.extend_from_slice(&chunk[..room]);
            return Ok((body, true));
        }
        body.extend_from_slice(&chunk);
    }
    Ok((body, false))
}

const SKIPPED: &[&str] = &[
    "script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside", "form",
    "button", "iframe",
];
const BLOCKS: &[&str] = &[
    "p",
    "div",
    "section",
    "article",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "pre",
    "blockquote",
    "tr",
    "br",
    "dt",
    "dd",
    "figcaption",
    "table",
];

enum Visit<'a> {
    Text(&'a str),
    Open(ElementRef<'a>),
    BlockEnd,
}

/// The readable text, without menus, scripts or footers, with a line break between blocks. With a stack rather than
/// recursion: a page nested hundreds of thousands of levels deep would overflow the thread's stack and close Nyra.
fn collect_text(element: ElementRef, out: &mut String) {
    let mut pending = vec![Visit::Open(element)];
    while let Some(visit) = pending.pop() {
        let element = match visit {
            Visit::Text(text) => {
                out.push_str(text);
                continue;
            }
            Visit::BlockEnd => {
                out.push('\n');
                continue;
            }
            Visit::Open(element) => element,
        };
        // Children go on the stack last first, so they come out in order
        for child in element.children().rev() {
            match child.value() {
                Node::Text(text) => pending.push(Visit::Text(text)),
                Node::Element(tag) if !SKIPPED.contains(&tag.name()) => {
                    let Some(child) = ElementRef::wrap(child) else {
                        continue;
                    };
                    if BLOCKS.contains(&tag.name()) {
                        pending.push(Visit::BlockEnd);
                        pending.push(Visit::Open(child));
                        pending.push(Visit::BlockEnd);
                    } else {
                        pending.push(Visit::Open(child));
                    }
                }
                _ => {}
            }
        }
    }
}

fn tidy(text: &str) -> String {
    text.lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// The page's main text: its <article> or <main> when it has one, so menus and sidebars stay out
fn readable_text(html: &str) -> (String, String) {
    let document = Html::parse_document(html);
    let title = document
        .select(&selector("title"))
        .next()
        .map(text_of)
        .unwrap_or_default();
    let root = ["article", "main", "body"]
        .iter()
        .find_map(|css| document.select(&selector(css)).next())
        .unwrap_or_else(|| document.root_element());
    let mut text = String::new();
    collect_text(root, &mut text);
    (title, tidy(&text))
}

fn cut(text: String, max_chars: usize) -> (String, bool) {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => (text[..end].to_string(), true),
        None => (text, false),
    }
}

/// What a public web address answers, never one on this computer or its network. Only a successful answer comes back.
pub async fn get_public(url: Url) -> Result<reqwest::Response, String> {
    let mut url = url;
    for _ in 0..=MAX_REDIRECTS {
        let address = public_address(&url).await?;
        let host = url.host_str().unwrap_or_default().to_string();
        // Redirects are followed by hand, so each new address is checked like the first
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(TIMEOUT)
            .redirect(redirect::Policy::none())
            .resolve(&host, address)
            .build()
            .map_err(to_message)?;
        let response = client
            .get(url.clone())
            .header(header::ACCEPT_LANGUAGE, accept_language())
            .send()
            .await
            .map_err(|_| t("native.web.couldNotOpen"))?;

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| t("native.web.badRedirect"))?;
            url = url.join(location).map_err(to_message)?;
            continue;
        }
        if !response.status().is_success() {
            let status = response.status().to_string();
            return Err(t_with("native.web.answered", &[("status", &status)]));
        }
        return Ok(response);
    }
    Err(t("native.web.tooManyRedirects"))
}

#[tauri::command]
pub async fn fetch_page(url: String) -> Result<WebPage, String> {
    let url = Url::parse(url.trim()).map_err(|_| t("native.web.invalidAddress"))?;
    let response = get_public(url).await?;
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("text/html")
        .to_ascii_lowercase();
    let is_html = content_type.contains("html");
    if !is_html && !content_type.starts_with("text/") {
        return Err(t("native.web.notText"));
    }
    let final_url = response.url().to_string();
    let (body, body_cut) = read_limited(response, MAX_PAGE_BYTES).await?;
    let raw = String::from_utf8_lossy(&body);
    let (title, text) = if is_html {
        readable_text(&raw)
    } else {
        (String::new(), tidy(&raw))
    };
    let (text, text_cut) = cut(text, MAX_PAGE_CHARS);
    Ok(WebPage {
        url: final_url,
        title,
        text,
        truncated: body_cut || text_cut,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    const DDG_HTML: &str = r#"
        <div class="result results_links result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Anuncio</a></div>
        <div class="result results_links web-result">
          <h2><a class="result__a" href="https://www.python.org/about/">Acerca de <b>Python</b></a></h2>
          <a class="result__snippet" href="https://www.python.org/about/">Python es un lenguaje   de programación</a>
        </div>
        <div class="result results_links web-result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fes.wikipedia.org%2Fwiki%2FPython&rut=x">Python - Wikipedia</a>
        </div>"#;

    #[test]
    fn reads_duckduckgo_results_without_ads() {
        let results = parse_duckduckgo_html(DDG_HTML);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Acerca de Python");
        assert_eq!(results[0].url, "https://www.python.org/about/");
        assert_eq!(results[0].snippet, "Python es un lenguaje de programación");
        assert_eq!(results[1].url, "https://es.wikipedia.org/wiki/Python");
    }

    #[test]
    fn reads_the_lite_page() {
        let html = r#"<table>
            <tr><td><a rel="nofollow" href="https://www.python.org/" class='result-link'>Python.org</a></td></tr>
            <tr><td class='result-snippet'>Sitio <b>oficial</b></td></tr>
            <tr><td><a href="https://duckduckgo.com/y.js?ad=2" class='result-link'>Anuncio</a></td></tr>
        </table>"#;
        let results = parse_duckduckgo_lite(html);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].snippet, "Sitio oficial");
    }

    #[test]
    fn reads_wikipedia_search() {
        let json = r#"{"query":{"search":[{"title":"Python (lenguaje)","snippet":"<span class=\"searchmatch\">Python</span> es un lenguaje"}]}}"#;
        let results = parse_wikipedia(json, "es");
        assert_eq!(
            results[0].url,
            "https://es.wikipedia.org/wiki/Python_(lenguaje)"
        );
        assert_eq!(results[0].snippet, "Python es un lenguaje");
        assert!(parse_wikipedia("no es json", "es").is_empty());
    }

    #[test]
    fn only_public_addresses_are_read() {
        for private in [
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20)),
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254)),
            IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1)),
            IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
            "fd00::1".parse().unwrap(),
            "fe80::1".parse().unwrap(),
            "::ffff:127.0.0.1".parse().unwrap(),
        ] {
            assert!(!is_public(private), "{private}");
        }
        assert!(is_public(IpAddr::V4(Ipv4Addr::new(151, 101, 1, 69))));
        assert!(is_public("2606:4700::6810:84e5".parse().unwrap()));
        // IPv4 inside IPv6: the address it carries decides
        for local in [
            "::192.168.1.1",
            "64:ff9b::7f00:1",
            "64:ff9b:1::a00:1",
            "2002:c0a8:101::1",
            "2001:0:4136:e378:8000:63bf:3f57:fefe",
        ] {
            assert!(!is_public(local.parse().unwrap()), "{local}");
        }
        assert!(is_public("64:ff9b::9765:145".parse().unwrap()));
    }

    #[test]
    fn rejects_addresses_that_are_not_web_pages() {
        let file = Url::parse("file:///etc/passwd").unwrap();
        let result = tauri::async_runtime::block_on(public_address(&file));
        assert!(result.is_err());
        let local = Url::parse("http://127.0.0.1:11434/api/tags").unwrap();
        assert!(tauri::async_runtime::block_on(public_address(&local)).is_err());
    }

    #[test]
    fn a_deeply_nested_page_does_not_overflow_the_stack() {
        let depth = 200_000;
        let html = format!(
            "<body><p>Inicio</p>{}hondo{}</body>",
            "<span>".repeat(depth),
            "</span>".repeat(depth)
        );
        // A small stack, like a worker thread's: recursion would overflow it long before this depth
        let text = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || readable_text(&html).1)
            .unwrap()
            .join()
            .unwrap();
        assert_eq!(text, "Inicio\nhondo");
    }

    #[test]
    fn keeps_the_main_text_and_drops_menus_and_scripts() {
        let html = r#"<html><head><title>Guía</title><script>alert(1)</script></head><body>
            <nav>Inicio | Blog</nav>
            <article><h1>Instalar Python</h1><p>Primero   descarga</p><ul><li>Paso uno</li></ul></article>
            <footer>© 2026</footer></body></html>"#;
        let (title, text) = readable_text(html);
        assert_eq!(title, "Guía");
        assert_eq!(text, "Instalar Python\nPrimero descarga\nPaso uno");
    }

    #[test]
    fn cuts_long_text_on_a_character_boundary() {
        let (text, truncated) = cut("ñandú".repeat(10), 7);
        assert_eq!(text, "ñandúña");
        assert!(truncated);
    }
}
