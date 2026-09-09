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
    var chatgptToday = UsageTotals()
    var chatgptSevenDays = UsageTotals()
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

    private var chatgptDirectories: [URL] {
        let codexRoot = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".codex", isDirectory: true)
        return [
            codexRoot.appendingPathComponent("sessions", isDirectory: true),
            codexRoot.appendingPathComponent("archived_sessions", isDirectory: true),
        ]
    }

    func readShowNative() -> Bool {
        let settingsURL = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent/settings.json")
        guard let data = try? Data(contentsOf: settingsURL),
              let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            // Keep the native app visible when the setting is unavailable so a
            // first launch or an older Pi installation remains discoverable.
            return true
        }
        return settings["showNative"] as? Bool ?? true
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
            var chatgptToday = UsageTotals()
            var chatgptSevenDays = UsageTotals()
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

            for directory in chatgptDirectories {
                for file in jsonlFiles(in: directory) {
                    autoreleasepool {
                        parseChatGPT(file: file, todayKey: todayKey, sevenDaysKey: sevenDaysKey,
                                     today: &chatgptToday, sevenDays: &chatgptSevenDays)
                    }
                }
            }

            return UsageSummary(
                today: today,
                sevenDays: sevenDays,
                chatgptToday: chatgptToday,
                chatgptSevenDays: chatgptSevenDays,
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

    private func jsonlFiles(in directory: URL) -> [URL] {
        guard let items = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        return items.flatMap { url -> [URL] in
            let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            if isDirectory { return jsonlFiles(in: url) }
            return url.pathExtension == "jsonl" ? [url] : []
        }
    }

    private func parseChatGPT(
        file: URL,
        todayKey: String,
        sevenDaysKey: String,
        today: inout UsageTotals,
        sevenDays: inout UsageTotals
    ) {
        guard let handle = try? FileHandle(forReadingFrom: file) else { return }
        defer { try? handle.close() }
        var pending = Data()

        func consume(_ data: Data) {
            guard let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let payload = envelope["payload"] as? [String: Any],
                  payload["type"] as? String == "token_count",
                  let info = payload["info"] as? [String: Any],
                  let usage = info["last_token_usage"] as? [String: Any],
                  let timestamp = envelope["timestamp"] as? String,
                  let date = isoFormatter.date(from: timestamp) ?? ISO8601DateFormatter().date(from: timestamp) else { return }

            let dateKey = dateFormatter.string(from: date)
            guard dateKey >= sevenDaysKey else { return }
            let rawInput = integer(usage, "input_tokens")
            let cacheRead = integer(usage, "cached_input_tokens")
            let cacheWrite = integer(usage, "cache_write_input_tokens")
            let input = max(rawInput - cacheRead - cacheWrite, 0)
            let output = integer(usage, "output_tokens")
            sevenDays.add(input: input, output: output, cacheRead: cacheRead, cacheWrite: cacheWrite, cost: 0, requests: 1)
            if dateKey == todayKey {
                today.add(input: input, output: output, cacheRead: cacheRead, cacheWrite: cacheWrite, cost: 0, requests: 1)
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

// A single native view keeps information non-interactive and avoids disabled
// menu-item contrast. Fixed columns prevent long provider names moving numbers.
private final class UsagePanel: NSView {
    private let summary: UsageSummary
    override var isFlipped: Bool { true }
    init(summary: UsageSummary) {
        self.summary = summary
        super.init(frame: NSRect(x: 0, y: 0, width: 400, height: 820))
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Pi 使用情况")
    }
    required init?(coder: NSCoder) { nil }

    private func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ width: CGFloat,
                      size: CGFloat = 12, color: NSColor = .labelColor, right: Bool = false, bold: Bool = false) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = right ? .right : .left
        paragraph.lineBreakMode = .byTruncatingTail
        let font = NSFont(name: right ? "Menlo" : "Helvetica Neue", size: size) ?? NSFont.systemFont(ofSize: size)
        let selected = bold ? NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) : font
        (value as NSString).draw(in: NSRect(x: x, y: y, width: width, height: size + 7), withAttributes: [
            .font: selected, .foregroundColor: color, .paragraphStyle: paragraph
        ])
    }
    private func line(_ y: CGFloat) {
        NSColor.separatorColor.setFill()
        NSRect(x: 20, y: y, width: 360, height: 0.5).fill()
    }
    private func bar(_ percent: Double, x: CGFloat, y: CGFloat, width: CGFloat, color: NSColor) {
        NSColor.quaternaryLabelColor.setFill()
        NSBezierPath(roundedRect: NSRect(x: x, y: y, width: width, height: 4), xRadius: 2, yRadius: 2).fill()
        let fill = width * CGFloat(min(100, max(0, percent))) / 100
        if fill > 0 {
            color.setFill()
            NSBezierPath(roundedRect: NSRect(x: x, y: y, width: fill, height: 4), xRadius: 2, yRadius: 2).fill()
        }
    }
    private func period(_ title: String, totals: UsageTotals, x: CGFloat, y: CGFloat = 65) {
        text(title, x, y, 170, color: .secondaryLabelColor, bold: true)
        text(formatTokens(totals.tokens), x, y + 22, 170, size: 26, bold: true)
        text("TOKENS", x, y + 54, 170, size: 9, color: .secondaryLabelColor)
        text(formatCost(totals.cost), x, y + 78, 90, size: 14, bold: true)
        text("\(totals.requests) 次", x + 88, y + 80, 82, size: 11, right: true)
        text("缓存命中", x, y + 111, 80, size: 11, color: .secondaryLabelColor)
        text(formatCacheHitRate(totals), x + 80, y + 109, 90, size: 14, color: .systemTeal, right: true, bold: true)
        let rate = totals.tokens > 0 ? Double(totals.cacheRead + totals.cacheWrite) / Double(totals.tokens) * 100 : 0
        bar(rate, x: x, y: y + 133, width: 170, color: .systemTeal)
        text("读 \(formatTokens(totals.cacheRead)) · 写 \(formatTokens(totals.cacheWrite))", x, y + 146, 170, size: 10, color: .secondaryLabelColor)
    }
    private func quota(_ title: String, window: CodexUsageWindow?, y: CGFloat) {
        text(title, 20, y, 160, bold: true)
        guard let window else {
            text("暂无额度信息", 120, y, 260, color: .secondaryLabelColor, right: true)
            return
        }
        let accent: NSColor = window.remainingPercent <= 10 ? .systemRed : .systemTeal
        text(String(format: "已用 %.0f%% · 剩余 %.0f%%", window.usedPercent, window.remainingPercent), 160, y, 220, color: accent, right: true)
        bar(window.remainingPercent, x: 20, y: y + 23, width: 360, color: accent)
        let seconds = window.resetAt.map { max(0, Int($0.timeIntervalSinceNow)) } ?? window.resetAfterSeconds
        text(formatDuration(seconds).map { "\($0)后重置" } ?? "重置时间未知", 20, y + 32, 170, size: 10, color: .secondaryLabelColor)
        text(formatResetAt(window.resetAt).map { "\($0) UTC+8" } ?? "", 180, y + 32, 200, size: 10, color: .secondaryLabelColor, right: true)
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        text("π", 20, 12, 26, size: 24, color: .systemTeal)
        text("使用情况", 52, 15, 180, size: 17, bold: true)
        let clock = DateFormatter()
        clock.dateFormat = "HH:mm"
        text("更新 " + clock.string(from: summary.updatedAt), 260, 20, 120, size: 10, color: .secondaryLabelColor, right: true)
        line(49)
        if let error = summary.error {
            text("读取失败：" + error, 20, 65, 360, color: .systemRed)
            return
        }
        period("今日", totals: summary.today, x: 20)
        period("近 7 日", totals: summary.sevenDays, x: 210)
        let providerSectionY: CGFloat = 240
        line(providerSectionY)
        text("提供商", 20, providerSectionY + 15, 180, size: 11, bold: true)
        text("近 7 日 · 按成本", 230, providerSectionY + 15, 150, size: 10, color: .secondaryLabelColor, right: true)
        let providerRowStartY = providerSectionY + 42
        for (i, provider) in summary.providers.prefix(5).enumerated() {
            let y = providerRowStartY + CGFloat(i * 26)
            text(provider.id, 20, y, 169, size: 11)
            text(formatTokens(provider.tokens), 193, y, 83, size: 11, color: .secondaryLabelColor, right: true)
            text(formatCost(provider.cost), 280, y, 100, size: 11, right: true)
        }

        let providerRowCount = max(1, min(summary.providers.count, 5))
        if summary.providers.isEmpty { text("暂无使用记录", 20, providerRowStartY, 360, color: .secondaryLabelColor) }

        let chatgptSectionY = providerSectionY + 42 + CGFloat(providerRowCount * 26) + 20
        line(chatgptSectionY)
        text("GPT / CHATGPT 使用", 20, chatgptSectionY + 15, 230, size: 11, bold: true)
        text("来自本地会话记录", 230, chatgptSectionY + 15, 150, size: 10, color: .secondaryLabelColor, right: true)
        period("今日", totals: summary.chatgptToday, x: 20, y: chatgptSectionY + 27)
        period("近 7 日", totals: summary.chatgptSevenDays, x: 210, y: chatgptSectionY + 27)

        let codexLineY = chatgptSectionY + 190
        line(codexLineY)
        text("CODEX / 官方额度", 20, codexLineY + 15, 230, size: 11, bold: true)
        text(summary.codex?.planType?.uppercased() ?? "", 280, codexLineY + 15, 100, size: 10, color: .secondaryLabelColor, right: true)
        if let status = summary.codex, status.loggedIn, status.error == nil {
            quota("5 小时", window: status.primary, y: codexLineY + 41)
            quota("7 天", window: status.secondary, y: codexLineY + 100)
        } else {
            let message = summary.codex.map { $0.loggedIn ? ($0.error ?? "暂无额度信息") : "未登录 openai-codex" } ?? "正在查询官方额度…"
            text(message, 20, codexLineY + 55, 360, color: .secondaryLabelColor)
        }
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let reader = UsageReader()
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let refreshQueue = DispatchQueue(label: "com.raingor.pi-usage-menubar.refresh", qos: .utility)
    private var cachedSummary: UsageSummary?
    // This is intentionally kept on the main thread with the status item.
    private var nativeEnabled = false
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
        syncNativeVisibility()
        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.syncNativeVisibility()
        }
        Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            guard let self, self.nativeEnabled else { return }
            self.requestRefresh(force: true)
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

    private func syncNativeVisibility() {
        refreshQueue.async { [weak self] in
            guard let self else { return }
            let enabled = self.reader.readShowNative()
            DispatchQueue.main.async {
                let wasEnabled = self.nativeEnabled
                self.nativeEnabled = enabled
                self.statusItem.isVisible = enabled
                if enabled && !wasEnabled {
                    self.rebuildLoadingMenu()
                    self.requestRefresh(force: true)
                }
            }
        }
    }

    private func requestRefresh(force: Bool) {
        guard nativeEnabled else { return }
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

    private func runShellCommand(_ command: String) -> String {
        let task = Process()
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", command]
        do {
            try task.run()
            task.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8) ?? ""
        } catch {
            return ""
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
        let panel = NSMenuItem()
        panel.view = UsagePanel(summary: summary)
        menu.addItem(panel)

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
