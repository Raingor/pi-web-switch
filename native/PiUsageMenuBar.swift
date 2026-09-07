import AppKit
import Foundation

private struct UsageTotals {
    var tokens: Int64 = 0
    var input: Int64 = 0
    var output: Int64 = 0
    var cacheRead: Int64 = 0
    var cacheWrite: Int64 = 0
    var cost: Double = 0
    var requests: Int = 0

    mutating func add(input: Int64, output: Int64, cacheRead: Int64, cacheWrite: Int64, cost: Double, requests: Int) {
        self.input += input
        self.output += output
        self.cacheRead += cacheRead
        self.cacheWrite += cacheWrite
        self.cost += cost
        self.requests += requests
        tokens = self.input + self.output + self.cacheRead + self.cacheWrite
    }
}

private struct ProviderTotals {
    var id: String
    var tokens: Int64 = 0
    var cost: Double = 0
    var requests: Int = 0
}

private struct CodexUsageWindow {
    var windowSeconds: Int
    var usedPercent: Double
    var remainingPercent: Double
    var resetAfterSeconds: Int?
    var resetAt: Date?
}

private struct CodexUsageStatus {
    var loggedIn: Bool
    var planType: String?
    var primary: CodexUsageWindow?
    var secondary: CodexUsageWindow?
    var error: String?
}

private struct UsageSummary {
    var today = UsageTotals()
    var sevenDays = UsageTotals()
    var providers: [ProviderTotals] = []
    var codex: CodexUsageStatus?
    var updatedAt = Date()
    var error: String?
}

private func number(_ dictionary: [String: Any], _ key: String) -> Double {
    (dictionary[key] as? NSNumber)?.doubleValue ?? 0
}

private func integer(_ dictionary: [String: Any], _ key: String) -> Int64 {
    Int64(number(dictionary, key))
}

private func formatTokens(_ tokens: Int64) -> String {
    if tokens >= 100_000_000 { return String(format: "%.1f亿", Double(tokens) / 100_000_000) }
    if tokens >= 10_000 { return String(format: "%.1f万", Double(tokens) / 10_000) }
    if tokens >= 1_000 { return String(format: "%.1fk", Double(tokens) / 1_000) }
    return NumberFormatter.localizedString(from: NSNumber(value: tokens), number: .decimal)
}

private func formatCost(_ cost: Double) -> String {
    if cost == 0 { return "$0.00" }
    if cost < 0.01 { return String(format: "$%.4f", cost) }
    return String(format: "$%.2f", cost)
}

private func formatCacheHitRate(_ totals: UsageTotals) -> String {
    guard totals.tokens > 0 else { return "0.0%" }
    let cached = totals.cacheRead + totals.cacheWrite
    return String(format: "%.1f%%", Double(cached) / Double(totals.tokens) * 100)
}

private func formatDuration(_ seconds: Int?) -> String? {
    guard let seconds, seconds >= 0 else { return nil }
    let hours = seconds / 3600
    let minutes = (seconds % 3600) / 60
    return hours > 0 ? "\(hours)小时\(minutes)分" : "\(minutes)分"
}

private func formatResetAt(_ date: Date?) -> String? {
    guard let date else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
    formatter.dateFormat = "MM-dd HH:mm"
    return formatter.string(from: date)
}

private final class UsageReader {
    private let fileManager = FileManager.default
    private let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private var sessionsDirectory: URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent/sessions", isDirectory: true)
    }

    func read() -> UsageSummary {
        do {
            let now = Date()
            let todayKey = dateFormatter.string(from: now)
            let sevenDaysAgo = Calendar(identifier: .gregorian).date(byAdding: .day, value: -6, to: now) ?? now
            // File mtime is only a pre-filter; parseSession still checks each
            // message timestamp. Keep a one-day margin for sessions written
            // slightly after midnight in China time.
            let fileCutoff = Calendar(identifier: .gregorian).date(byAdding: .day, value: -8, to: now) ?? now
            let sevenDaysKey = dateFormatter.string(from: sevenDaysAgo)
            var today = UsageTotals()
            var sevenDays = UsageTotals()
            var providers: [String: ProviderTotals] = [:]

            let directories = try fileManager.contentsOfDirectory(
                at: sessionsDirectory,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ).filter { url in
                url.lastPathComponent.hasPrefix("--") && (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            }

            for directory in directories {
                let files = (try? fileManager.contentsOfDirectory(
                    at: directory,
                    includingPropertiesForKeys: [.isRegularFileKey],
                    options: [.skipsHiddenFiles]
                )) ?? []
                for file in files where file.pathExtension == "jsonl" {
                    let modifiedAt = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? nil
                    guard modifiedAt == nil || modifiedAt! >= fileCutoff else { continue }
                    autoreleasepool {
                        parse(file: file, todayKey: todayKey, sevenDaysKey: sevenDaysKey, today: &today, sevenDays: &sevenDays, providers: &providers)
                    }
                }
            }

            return UsageSummary(
                today: today,
                sevenDays: sevenDays,
                providers: providers.values.sorted { $0.cost > $1.cost }.prefix(5).map { $0 },
                updatedAt: now
            )
        } catch {
            var summary = UsageSummary()
            summary.error = error.localizedDescription
            return summary
        }
    }

    private func parse(
        file: URL,
        todayKey: String,
        sevenDaysKey: String,
        today: inout UsageTotals,
        sevenDays: inout UsageTotals,
        providers: inout [String: ProviderTotals]
    ) {
        guard let handle = try? FileHandle(forReadingFrom: file) else { return }
        defer { try? handle.close() }
        var currentProvider = "unknown"
        var pending = Data()

        func consume(_ data: Data) {
            guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = object["type"] as? String else { return }
            if type == "model_change" {
                if let provider = object["provider"] as? String, !provider.isEmpty { currentProvider = provider }
                return
            }
            guard type == "message",
                  let message = object["message"] as? [String: Any],
                  (message["role"] as? String) == "assistant",
                  let usage = message["usage"] as? [String: Any],
                  usage["input"] != nil else { return }

            let timestamp: Date?
            if let value = object["timestamp"] as? String {
                timestamp = isoFormatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
            } else if let value = object["timestamp"] as? NSNumber {
                timestamp = Date(timeIntervalSince1970: value.doubleValue)
            } else {
                timestamp = nil
            }
            guard let date = timestamp else { return }
            let dateKey = dateFormatter.string(from: date)
            guard dateKey >= sevenDaysKey else { return }

            let input = integer(usage, "input")
            let output = integer(usage, "output")
            let cacheRead = integer(usage, "cacheRead")
            let cacheWrite = integer(usage, "cacheWrite")
            let cost = (usage["cost"] as? [String: Any]).map { number($0, "total") } ?? 0
            let provider = (message["provider"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? currentProvider
            sevenDays.add(input: input, output: output, cacheRead: cacheRead, cacheWrite: cacheWrite, cost: cost, requests: 1)
            var providerTotal = providers[provider] ?? ProviderTotals(id: provider)
            providerTotal.tokens += input + output + cacheRead + cacheWrite
            providerTotal.cost += cost
            providerTotal.requests += 1
            providers[provider] = providerTotal
            if dateKey == todayKey {
                today.add(input: input, output: output, cacheRead: cacheRead, cacheWrite: cacheWrite, cost: cost, requests: 1)
            }
        }

        while true {
            guard let chunk = try? handle.read(upToCount: 64 * 1024), !chunk.isEmpty else { break }
            pending.append(chunk)
            while let newline = pending.firstIndex(of: 10) {
                consume(Data(pending[..<newline]))
                pending.removeSubrange(...newline)
            }
        }
        if !pending.isEmpty { consume(pending) }
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let reader = UsageReader()
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let refreshQueue = DispatchQueue(label: "com.raingor.pi-usage-menubar.refresh", qos: .utility)
    private var cachedSummary: UsageSummary?
    private var isRefreshing = false
    // Accessed only from refreshQueue.
    private var codexCache: (value: CodexUsageStatus, at: Date)?
    private let codexCacheTTL: TimeInterval = 30

    func applicationDidFinishLaunching(_ notification: Notification) {
        _ = notification
        NSApp.setActivationPolicy(.accessory)
        menu.delegate = self
        statusItem.menu = menu
        statusItem.button?.font = NSFont.menuBarFont(ofSize: 0)
        rebuildLoadingMenu()
        requestRefresh(force: true)
        Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.requestRefresh(force: true)
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        _ = menu
        // Do not scan JSONL on the main thread: the menu must open immediately.
        if let cachedSummary {
            rebuildMenu(cachedSummary)
        } else {
            rebuildLoadingMenu()
        }
        requestRefresh(force: false)
    }

    @objc private func refreshAction() {
        requestRefresh(force: true)
    }

    @objc private func quitAction() {
        NSApp.terminate(nil)
    }

    @objc private func noOpAction() {
        // Information rows need to remain enabled; disabled NSMenuItems are
        // rendered in low-contrast gray by macOS.
    }

    private func requestRefresh(force: Bool) {
        if !force, let cachedSummary, Date().timeIntervalSince(cachedSummary.updatedAt) < 30 {
            return
        }
        guard !isRefreshing else { return }
        isRefreshing = true
        refreshQueue.async { [weak self] in
            guard let self else { return }
            var summary = self.reader.read()
            summary.codex = self.readCodexUsage(force: force)
            DispatchQueue.main.async {
                self.cachedSummary = summary
                self.isRefreshing = false
                self.rebuildMenu(summary)
            }
        }
    }

    private func readCodexUsage(force: Bool) -> CodexUsageStatus {
        if !force, let codexCache, Date().timeIntervalSince(codexCache.at) < codexCacheTTL {
            return codexCache.value
        }

        let authURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".pi/agent/auth.json")
        guard let data = try? Data(contentsOf: authURL),
              let auth = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let codex = auth["openai-codex"] as? [String: Any],
              (codex["type"] as? String) == "oauth",
              let access = codex["access"] as? String, !access.isEmpty,
              let accountID = codex["accountId"] as? String, !accountID.isEmpty else {
            return CodexUsageStatus(loggedIn: false, planType: nil, primary: nil, secondary: nil, error: nil)
        }

        var request = URLRequest(url: URL(string: "https://chatgpt.com/backend-api/wham/usage")!)
        request.timeoutInterval = 15
        request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
        request.setValue(accountID, forHTTPHeaderField: "chatgpt-account-id")
        let semaphore = DispatchSemaphore(value: 0)
        var result = CodexUsageStatus(loggedIn: true, planType: nil, primary: nil, secondary: nil, error: "无法查询 OpenAI 使用量")
        URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse else { return }
            guard (200..<300).contains(http.statusCode) else {
                result.error = "OpenAI 返回 \(http.statusCode)"
                return
            }
            guard let data,
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return
            }
            let rateLimit = payload["rate_limit"] as? [String: Any]
            result = CodexUsageStatus(
                loggedIn: true,
                planType: payload["plan_type"] as? String,
                primary: self.codexWindow(rateLimit?["primary_window"]),
                secondary: self.codexWindow(rateLimit?["secondary_window"]),
                error: nil
            )
        }.resume()
        _ = semaphore.wait(timeout: .now() + 16)
        codexCache = (result, Date())
        return result
    }

    private func codexWindow(_ raw: Any?) -> CodexUsageWindow? {
        guard let value = raw as? [String: Any], let window = value["limit_window_seconds"] as? NSNumber else { return nil }
        let used = min(100, max(0, (value["used_percent"] as? NSNumber)?.doubleValue ?? 0))
        let resetAfter = (value["reset_after_seconds"] as? NSNumber).map { $0.intValue }
        let resetAt = (value["reset_at"] as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue) }
        return CodexUsageWindow(
            windowSeconds: window.intValue,
            usedPercent: used,
            remainingPercent: max(0, 100 - used),
            resetAfterSeconds: resetAfter,
            resetAt: resetAt
        )
    }

    private func informationItem(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(noOpAction), keyEquivalent: "")
        item.target = self
        return item
    }

    private func rebuildLoadingMenu() {
        statusItem.button?.title = "π …"
        statusItem.button?.toolTip = "正在读取 Pi 使用量"
        menu.removeAllItems()
        let item = informationItem("正在读取近 7 日使用量…")
        menu.addItem(item)
        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "退出 Pi 使用量", action: #selector(quitAction), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
    }

    private func rebuildMenu(_ summary: UsageSummary) {
        if let error = summary.error {
            statusItem.button?.title = "π ⚠"
            statusItem.button?.toolTip = error
        } else {
            statusItem.button?.title = "π \(formatTokens(summary.today.tokens))"
            statusItem.button?.toolTip = "今日 \(summary.today.tokens) tokens"
        }

        menu.removeAllItems()
        menu.addItem(informationItem("Pi 使用情况"))
        menu.addItem(.separator())

        if let error = summary.error {
            menu.addItem(informationItem("读取失败：\(error)"))
        } else {
            addSection("今日", totals: summary.today)
            menu.addItem(.separator())
            addSection("近 7 日", totals: summary.sevenDays)
            if !summary.providers.isEmpty {
                menu.addItem(.separator())
                menu.addItem(informationItem("Top 提供商（近 7 日）"))
                for provider in summary.providers {
                    let text = "  \(provider.id)：\(formatTokens(provider.tokens)) · \(formatCost(provider.cost))"
                    menu.addItem(informationItem(text))
                }
            }
            menu.addItem(.separator())
            addCodexUsage(summary.codex)
        }

        menu.addItem(.separator())
        let refreshItem = NSMenuItem(title: "刷新使用量", action: #selector(refreshAction), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)
        let quitItem = NSMenuItem(title: "退出 Pi 使用量", action: #selector(quitAction), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
    }

    private func addSection(_ title: String, totals: UsageTotals) {
        menu.addItem(informationItem(title))
        menu.addItem(informationItem("  Tokens：\(formatTokens(totals.tokens))"))
        menu.addItem(informationItem("  缓存命中率：\(formatCacheHitRate(totals))（读 \(formatTokens(totals.cacheRead)) · 写 \(formatTokens(totals.cacheWrite))）"))
        menu.addItem(informationItem("  成本：\(formatCost(totals.cost)) · 请求：\(totals.requests)"))
    }

    private func addCodexUsage(_ status: CodexUsageStatus?) {
        menu.addItem(informationItem("Codex 官方额度"))
        guard let status else {
            menu.addItem(informationItem("  正在查询官方使用量…"))
            return
        }
        guard status.loggedIn else {
            menu.addItem(informationItem("  未登录 openai-codex"))
            return
        }
        if let plan = status.planType, !plan.isEmpty {
            menu.addItem(informationItem("  套餐：\(plan)"))
        }
        if let error = status.error {
            menu.addItem(informationItem("  \(error)"))
            return
        }
        addCodexWindow("5 小时", window: status.primary)
        addCodexWindow("7 天", window: status.secondary)
    }

    private func addCodexWindow(_ label: String, window: CodexUsageWindow?) {
        guard let window else {
            menu.addItem(informationItem("  \(label)：暂无额度信息"))
            return
        }
        menu.addItem(informationItem("  \(label)：已用 \(String(format: "%.0f", window.usedPercent))% · 剩余 \(String(format: "%.0f", window.remainingPercent))%"))
        let reset = formatDuration(window.resetAfterSeconds).map { "\($0)后重置" }
            ?? formatResetAt(window.resetAt).map { "\($0) 重置" }
        if let reset { menu.addItem(informationItem("    \(reset)")) }
    }
}

let application = NSApplication.shared
private let delegate = AppDelegate()
application.delegate = delegate
application.run()
