import AppKit
import WebKit

struct SearchResult {
    let tracker: String
    let title: String
    let url: String
    let date: String
    let size: String
    let seeds: Int
    let peers: Int
}

enum Tracker: String, CaseIterable {
    case rutracker
    case kinozal

    var displayName: String {
        switch self {
        case .rutracker: return "RuTracker"
        case .kinozal: return "Kinozal"
        }
    }

    var loginURL: URL {
        switch self {
        case .rutracker:
            return URL(string: "https://rutracker.org/forum/login.php")!
        case .kinozal:
            return URL(string: "https://kinozal.me/")!
        }
    }

    func searchURL(query: String, topSeeds: Bool) -> URL? {
        guard let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return nil }
        switch self {
        case .rutracker:
            let base = topSeeds ? "https://rutracker.org/forum/tracker.php?o=10&nm=" : "https://rutracker.org/forum/tracker.php?nm="
            return URL(string: base + encoded)
        case .kinozal:
            let base = topSeeds ? "https://kinozal.me/browse.php?t=1&s=" : "https://kinozal.me/browse.php?s="
            return URL(string: base + encoded)
        }
    }

    var extractionScript: String {
        switch self {
        case .rutracker:
            return #"""
            (() => {
              const title = document.title || '';
              if (/Just a moment|Cloudflare/i.test(title)) return { state: 'challenge', results: [] };
              if (document.querySelector('#login-form-quick')) return { state: 'login', results: [] };
              const table = document.querySelector('#tor-tbl');
              const rows = [...document.querySelectorAll('#tor-tbl>tbody>tr')];
              if (!table) return { state: 'wait', results: [] };
              const cleanInt = (v) => {
                const n = parseInt(String(v || '').replace(/[^0-9-]/g, ''), 10);
                return Number.isFinite(n) ? n : 0;
              };
              const results = rows.map((tr) => {
                const a = tr.querySelector('td.row4.med.tLeft.t-title-col div.wbr.t-title a');
                if (!a) return null;
                const dateCell = tr.querySelector('td.row4.small.nowrap:last-child');
                const sizeCell = tr.querySelector('td.row4.small.nowrap.tor-size');
                const seedsCell = tr.querySelector('td.row4.nowrap:nth-last-child(4)');
                const peersCell = tr.querySelector('td.row4.leechmed');
                return {
                  tracker: 'RuTracker',
                  title: (a.textContent || '').trim(),
                  url: a.href,
                  date: (dateCell?.getAttribute('data-ts_text') || dateCell?.textContent || '').trim(),
                  size: (sizeCell?.getAttribute('data-ts_text') || sizeCell?.textContent || '').trim(),
                  seeds: cleanInt(seedsCell?.textContent),
                  peers: cleanInt(peersCell?.textContent)
                };
              }).filter(Boolean);
              return { state: 'ok', results };
            })()
            """#
        case .kinozal:
            return #"""
            (() => {
              const title = document.title || '';
              if (/Just a moment|Cloudflare/i.test(title)) return { state: 'challenge', results: [] };
              if (//login.php/i.test(location.pathname) || document.querySelector('form[action*="takelogin"]')) {
                return { state: 'login', results: [] };
              }
              const table = document.querySelector('table.t_peer');
              const rows = [...document.querySelectorAll('table.t_peer>tbody>tr')].slice(1);
              if (!table) return { state: 'wait', results: [] };
              const cleanInt = (v) => {
                const n = parseInt(String(v || '').replace(/[^0-9-]/g, ''), 10);
                return Number.isFinite(n) ? n : 0;
              };
              const results = rows.map((tr) => {
                const a = tr.querySelector('td.nam>a');
                if (!a) return null;
                const dateCell = tr.querySelector('td.s:nth-child(7)');
                const sizeCell = tr.querySelector('td.s:nth-child(4)');
                const seedsCell = tr.querySelector('td.sl_s');
                const peersCell = tr.querySelector('td.sl_p');
                return {
                  tracker: 'Kinozal',
                  title: (a.textContent || '').trim(),
                  url: a.href,
                  date: (dateCell?.textContent || '').trim(),
                  size: (sizeCell?.textContent || '').trim(),
                  seeds: cleanInt(seedsCell?.textContent),
                  peers: cleanInt(peersCell?.textContent)
                };
              }).filter(Boolean);
              return { state: 'ok', results };
            })()
            """#
        }
    }
}

final class SearchTask: NSObject, WKNavigationDelegate {
    let id = UUID()
    let tracker: Tracker
    private let webView: WKWebView
    private let completion: (UUID, Tracker, Result<[[String: Any]], Error>) -> Void
    private var startedAt = Date()
    private var finished = false
    private var nonChallengeRetries = 0

    init(tracker: Tracker, url: URL, parentView: NSView,
         completion: @escaping (UUID, Tracker, Result<[[String: Any]], Error>) -> Void) {
        self.tracker = tracker
        self.completion = completion
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        self.webView = WKWebView(frame: NSRect(x: -2400, y: -1400, width: 1200, height: 900), configuration: config)
        super.init()
        webView.navigationDelegate = self
        webView.alphaValue = 0.001
        parentView.addSubview(webView, positioned: .below, relativeTo: nil)
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { inspectSoon(delay: 0.5) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }

    private func inspectSoon(delay: TimeInterval) {
        guard !finished else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.inspect() }
    }

    private func inspect() {
        guard !finished else { return }
        if Date().timeIntervalSince(startedAt) > 65 {
            finish(.failure(NSError(domain: "TSE", code: 408, userInfo: [NSLocalizedDescriptionKey: "Тайм-аут загрузки \(tracker.displayName)"])))
            return
        }
        webView.evaluateJavaScript(tracker.extractionScript) { [weak self] value, error in
            guard let self else { return }
            if let error { self.finish(.failure(error)); return }
            guard let payload = value as? [String: Any], let state = payload["state"] as? String else {
                self.inspectSoon(delay: 1.0); return
            }
            switch state {
            case "ok":
                self.finish(.success(payload["results"] as? [[String: Any]] ?? []))
            case "login":
                self.finish(.failure(NSError(domain: "TSE", code: 401, userInfo: [NSLocalizedDescriptionKey: "Требуется вход в \(self.tracker.displayName)"])))
            case "challenge":
                self.inspectSoon(delay: 1.0)
            default:
                self.nonChallengeRetries += 1
                if self.nonChallengeRetries >= 4 { self.finish(.success([])) }
                else { self.inspectSoon(delay: 1.0) }
            }
        }
    }

    private func finish(_ result: Result<[[String: Any]], Error>) {
        guard !finished else { return }
        finished = true
        webView.stopLoading()
        webView.removeFromSuperview()
        completion(id, tracker, result)
    }

    func cancel() {
        guard !finished else { return }
        finished = true
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.removeFromSuperview()
    }

    deinit { webView.stopLoading(); webView.removeFromSuperview() }
}

final class SearchEngine {
    private weak var parentView: NSView?
    private var tasks: [UUID: SearchTask] = [:]
    init(parentView: NSView) { self.parentView = parentView }

    func cancelAll() {
        for task in tasks.values { task.cancel() }
        tasks.removeAll()
    }

    func search(query: String, trackers: [Tracker], topSeeds: Bool,
                completion: @escaping (Tracker, Result<[[String: Any]], Error>) -> Void) {
        guard let parentView else { return }
        cancelAll()
        for tracker in trackers {
            guard let url = tracker.searchURL(query: query, topSeeds: topSeeds) else { continue }
            let task = SearchTask(tracker: tracker, url: url, parentView: parentView) { [weak self] id, tracker, result in
                self?.tasks.removeValue(forKey: id)
                completion(tracker, result)
            }
            tasks[task.id] = task
        }
    }
}

final class SiteWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let webView: WKWebView
    private let onClose: (() -> Void)?

    init(title: String, url: URL, onClose: (() -> Void)? = nil) {
        self.onClose = onClose
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        self.webView = WKWebView(frame: .zero, configuration: config)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1080, height: 760),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = title
        window.center()
        window.contentView = webView
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.load(URLRequest(url: url))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func windowWillClose(_ notification: Notification) { onClose?() }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var window: NSWindow!
    private var mainWebView: WKWebView!
    private var searchEngine: SearchEngine!
    private var siteWindows: [SiteWindowController] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMainMenu()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "native")
        mainWebView = WKWebView(frame: .zero, configuration: config)
        mainWebView.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "TSE macOS"
        window.center()
        window.minSize = NSSize(width: 900, height: 560)
        window.contentView = mainWebView
        window.makeKeyAndOrderFront(nil)
        searchEngine = SearchEngine(parentView: mainWebView)
        guard let resourceURL = Bundle.main.resourceURL?.appendingPathComponent("Web/index.html") else { fatalError("Web/index.html not found") }
        mainWebView.loadFileURL(resourceURL, allowingReadAccessTo: resourceURL.deletingLastPathComponent())
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func buildMainMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem(); mainMenu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit TSE macOS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit"); editItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = mainMenu
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { reportSessionStatus() }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "native", let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "search":
            guard let query = (body["query"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !query.isEmpty else { return }
            let names = body["trackers"] as? [String] ?? []
            let trackers = names.compactMap(Tracker.init(rawValue:))
            startSearch(query: query, trackers: trackers, topSeeds: body["topSeeds"] as? Bool ?? true)
        case "login":
            guard let name = body["tracker"] as? String, let tracker = Tracker(rawValue: name) else { return }
            openSiteWindow(title: "Вход — \(tracker.displayName)", url: tracker.loginURL, refreshStatusOnClose: true)
        case "open":
            guard let raw = body["url"] as? String, let url = URL(string: raw) else { return }
            openSiteWindow(title: url.host ?? "Раздача", url: url, refreshStatusOnClose: false)
        case "clearSession":
            guard let name = body["tracker"] as? String, let tracker = Tracker(rawValue: name) else { return }
            clearSession(for: tracker)
        case "sessionStatus":
            reportSessionStatus()
        default: break
        }
    }

    private func startSearch(query: String, trackers: [Tracker], topSeeds: Bool) {
        let effective = trackers.isEmpty ? Tracker.allCases : trackers
        sendToUI(["type": "searchStarted", "trackers": effective.map(\.rawValue)])
        searchEngine.search(query: query, trackers: effective, topSeeds: topSeeds) { [weak self] tracker, result in
            DispatchQueue.main.async {
                switch result {
                case .success(let rows):
                    self?.sendToUI(["type": "trackerResults", "tracker": tracker.rawValue, "results": rows])
                case .failure(let error):
                    self?.sendToUI(["type": "trackerError", "tracker": tracker.rawValue, "message": error.localizedDescription,
                                    "loginRequired": (error as NSError).code == 401])
                }
            }
        }
    }

    private func openSiteWindow(title: String, url: URL, refreshStatusOnClose: Bool) {
        var controller: SiteWindowController!
        controller = SiteWindowController(title: title, url: url) { [weak self, weak controller] in
            if let controller { self?.siteWindows.removeAll { $0 === controller } }
            if refreshStatusOnClose { self?.reportSessionStatus() }
        }
        siteWindows.append(controller)
        controller.showWindow(nil)
        controller.window?.makeKeyAndOrderFront(nil)
    }

    private func reportSessionStatus() {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { [weak self] cookies in
            let rt = cookies.contains { $0.domain.contains("rutracker.org") && $0.name == "bb_session" }
            let kz = cookies.contains { $0.domain.contains("kinozal") && ($0.name == "uid" || $0.name == "pass") }
            DispatchQueue.main.async {
                self?.sendToUI(["type": "sessionStatus", "rutracker": rt, "kinozal": kz])
            }
        }
    }

    private func clearSession(for tracker: Tracker) {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { [weak self] cookies in
            let store = WKWebsiteDataStore.default().httpCookieStore
            let relevant = cookies.filter {
                switch tracker {
                case .rutracker: return $0.domain.contains("rutracker.org")
                case .kinozal: return $0.domain.contains("kinozal")
                }
            }
            let group = DispatchGroup()
            for cookie in relevant { group.enter(); store.delete(cookie) { group.leave() } }
            group.notify(queue: .main) { self?.reportSessionStatus() }
        }
    }

    private func sendToUI(_ object: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let json = String(data: data, encoding: .utf8) else { return }
        mainWebView.evaluateJavaScript("window.TSE && window.TSE.receiveNative(\(json));", completionHandler: nil)
    }
}

let app = NSApplication.shared
let appDelegate = AppDelegate()
app.delegate = appDelegate
app.run()
