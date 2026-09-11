import AppKit
import Foundation

struct UsageTotals {
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

struct ProviderTotals {
    var id: String
    var tokens: Int64 = 0
    var cost: Double = 0
    var requests: Int = 0
}

struct CodexUsageWindow {
    var windowSeconds: Int
    var usedPercent: Double
    var remainingPercent: Double
    var resetAfterSeconds: Int?
    var resetAt: Date?
}

struct CodexUsageStatus {
    var loggedIn: Bool
    var planType: String?
    var primary: CodexUsageWindow?
    var secondary: CodexUsageWindow?
    var error: String?
}

struct UsageSummary {
    var today = UsageTotals()
    var sevenDays = UsageTotals()
    var chatgptToday = UsageTotals()
    var chatgptSevenDays = UsageTotals()
    var providers: [ProviderTotals] = []
    var codex: CodexUsageStatus?
    var updatedAt = Date()
    var error: String?
}

enum UsageScope {
    case pi
    case chatgpt
}

func number(_ dictionary: [String: Any], _ key: String) -> Double {
    (dictionary[key] as? NSNumber)?.doubleValue ?? 0
}

func integer(_ dictionary: [String: Any], _ key: String) -> Int64 {
    Int64(number(dictionary, key))
}

func formatTokens(_ tokens: Int64) -> String {
    if tokens >= 100_000_000 { return String(format: "%.1f亿", Double(tokens) / 100_000_000) }
    if tokens >= 10_000 { return String(format: "%.1f万", Double(tokens) / 10_000) }
    if tokens >= 1_000 { return String(format: "%.1fk", Double(tokens) / 1_000) }
    return NumberFormatter.localizedString(from: NSNumber(value: tokens), number: .decimal)
}

func formatCost(_ cost: Double) -> String {
    if cost == 0 { return "$0.00" }
    if cost < 0.01 { return String(format: "$%.4f", cost) }
    return String(format: "$%.2f", cost)
}

func formatCacheHitRate(_ totals: UsageTotals) -> String {
    guard totals.tokens > 0 else { return "0.0%" }
    let cached = totals.cacheRead + totals.cacheWrite
    return String(format: "%.1f%%", Double(cached) / Double(totals.tokens) * 100)
}

func formatDuration(_ seconds: Int?) -> String? {
    guard let seconds, seconds >= 0 else { return nil }
    let hours = seconds / 3600
    let minutes = (seconds % 3600) / 60
    return hours > 0 ? "\(hours)小时\(minutes)分" : "\(minutes)分"
}

func formatResetAt(_ date: Date?) -> String? {
    guard let date else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
    formatter.dateFormat = "MM-dd HH:mm"
    return formatter.string(from: date)
}

final class UsageReader {
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

    func readShowNative(_ settingKey: String) -> Bool {
        let settingsURL = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent/settings.json")
        guard let data = try? Data(contentsOf: settingsURL),
              let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            // Keep the native app visible when the setting is unavailable so a
            // first launch or an older Pi installation remains discoverable.
            return true
        }
        let legacyValue = settings["showNative"] as? Bool ?? true
        return settings[settingKey] as? Bool ?? legacyValue
    }

    func read(scope: UsageScope) -> UsageSummary {
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

        let directories = (try? fileManager.contentsOfDirectory(
            at: sessionsDirectory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ))?.filter { url in
            url.lastPathComponent.hasPrefix("--") && (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        } ?? []

        if scope == .pi {
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
        }

        if scope == .chatgpt {
            for directory in chatgptDirectories {
                for file in jsonlFiles(in: directory) {
                    autoreleasepool {
                        parseChatGPT(file: file, todayKey: todayKey, sevenDaysKey: sevenDaysKey,
                                     today: &chatgptToday, sevenDays: &chatgptSevenDays)
                    }
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
    }

    func parse(
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

    func jsonlFiles(in directory: URL) -> [URL] {
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

    func parseChatGPT(
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
