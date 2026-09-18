import AppKit
import Foundation

final class PiUsagePanel: NSView {
    private let summary: UsageSummary

    override var isFlipped: Bool { true }

    init(summary: UsageSummary) {
        self.summary = summary
        let height: CGFloat = summary.todayProviders.isEmpty ? 610 : 820
        super.init(frame: NSRect(x: 0, y: 0, width: 400, height: height))
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
        text("Pi 使用情况", 52, 15, 180, size: 17, bold: true)
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
        let rowStartY = providerSectionY + 42
        for (i, provider) in summary.providers.prefix(5).enumerated() {
            let y = rowStartY + CGFloat(i * 26)
            text(provider.id, 20, y, 169, size: 11)
            text(formatTokens(provider.tokens), 193, y, 83, size: 11, color: .secondaryLabelColor, right: true)
            text(formatCost(provider.cost), 280, y, 100, size: 11, right: true)
        }
        if summary.providers.isEmpty {
            text("暂无使用记录", 20, rowStartY, 360, color: .secondaryLabelColor)
        }

        let providerRowCount = max(1, min(summary.providers.count, 5))
        let sectionY = providerSectionY + 42 + CGFloat(providerRowCount * 26) + 20
        line(sectionY)
        text("今日提供商排名", 20, sectionY + 15, 180, size: 11, bold: true)
        text("按 token 量降序", 210, sectionY + 15, 170, size: 10, color: .secondaryLabelColor, right: true)
        let todayProviderStartY = sectionY + 42
        for (i, provider) in summary.todayProviders.enumerated() {
            let y = todayProviderStartY + CGFloat(i * 24)
            text("\(i + 1). \(provider.id)", 20, y, 140, size: 11)
            text(formatTokens(provider.tokens), 163, y, 60, size: 11, color: .secondaryLabelColor, right: true)
            text("\(provider.requests) 次", 227, y, 53, size: 11, right: true)
            text(formatCost(provider.cost), 284, y, 96, size: 11, right: true)
        }
        if summary.todayProviders.isEmpty {
            text("暂无今日使用记录", 20, todayProviderStartY, 360, color: .secondaryLabelColor)
        }

        let todayProviderRowCount = max(1, summary.todayProviders.count)
        let quotaSectionY = todayProviderStartY + CGFloat(todayProviderRowCount * 24) + 20
        line(quotaSectionY)
        text("ChatGPT / Codex 额度", 20, quotaSectionY + 15, 230, size: 11, bold: true)
        if let status = summary.codex, status.loggedIn, status.error == nil {
            quota("5 小时窗口", window: status.primary, y: quotaSectionY + 41)
            quota("7 天窗口", window: status.secondary, y: quotaSectionY + 100)
        } else if let status = summary.codex, !status.loggedIn {
            text("未登录 openai-codex，无官方额度", 20, quotaSectionY + 50, 360, color: .secondaryLabelColor)
        } else if let status = summary.codex, status.error != nil {
            text("额度查询失败：" + (status.error ?? "错误"), 20, quotaSectionY + 50, 360, color: .systemRed)
        } else {
            text("正在查询 ChatGPT / Codex 官方额度…", 20, quotaSectionY + 50, 360, color: .secondaryLabelColor)
        }
    }
}

final class PiUsageAppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let reader = UsageReader()
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let refreshQueue = DispatchQueue(label: "com.raingor.pi-usage-menubar.refresh", qos: .utility)
    private var cachedSummary: UsageSummary?
    private var nativeEnabled = false
    private var isRefreshing = false
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

    @objc private func noOpAction() {}

    private func syncNativeVisibility() {
        refreshQueue.async { [weak self] in
            guard let self else { return }
            let enabled = self.reader.readShowNative("showPiNative")
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
            var summary = self.reader.read(scope: .pi)
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
        menu.addItem(informationItem("正在读取 Pi 近 7 日使用量…"))
        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "退出 Pi 用量", action: #selector(quitAction), keyEquivalent: "q")
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
        panel.view = PiUsagePanel(summary: summary)
        menu.addItem(panel)

        menu.addItem(.separator())
        let refreshItem = NSMenuItem(title: "刷新 Pi 使用量", action: #selector(refreshAction), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)
        let quitItem = NSMenuItem(title: "退出 Pi 用量", action: #selector(quitAction), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
    }
}

@main
struct PiUsageMenuBarMain {
    static func main() {
        let application = NSApplication.shared
        let delegate = PiUsageAppDelegate()
        application.delegate = delegate
        application.run()
    }
}
