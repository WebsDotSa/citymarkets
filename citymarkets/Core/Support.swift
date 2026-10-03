import Foundation
import Security
import SwiftUI

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case missingToken
    case status(Int, String)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: "رابط API غير صالح"
        case .invalidResponse: "استجابة غير صالحة من الخادم"
        case .missingToken: "تم التحقق لكن لم يصل رمز الجلسة"
        case .status(let code, let message): "\(Self.userFacingStatusMessage(code: code, message: message)) (\(code))"
        case .decoding(let error): "تعذر قراءة بيانات الخادم: \(error.localizedDescription)"
        }
    }

    private static func userFacingStatusMessage(code: Int, message: String) -> String {
        if (500...599).contains(code) {
            return "الخادم غير متاح حالياً. حاول مرة أخرى بعد قليل"
        }

        let sanitized = sanitizedStatusMessage(message)
        return sanitized.isEmpty ? "تعذر إكمال الطلب" : sanitized
    }

    private static func sanitizedStatusMessage(_ message: String) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }

        if trimmed.first == "{" || trimmed.first == "[" || trimmed.first == "<" {
            return "تعذر إكمال الطلب"
        }

        let singleLine = trimmed.replacingOccurrences(of: "\n", with: " ")
        if singleLine.count <= 180 { return singleLine }
        return String(singleLine.prefix(177)) + "..."
    }
}

final class KeychainHelper {
    private static let service = "sa.citymarkets.app"

    static func save(_ key: String, _ value: String) {
        guard let data = value.data(using: .utf8) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    static func read(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        SecItemCopyMatching(query as CFDictionary, &result)
        guard let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}

extension JSONDecoder {
    static let api: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()
}

extension JSONEncoder {
    static let request: JSONEncoder = {
        JSONEncoder()
    }()
}

extension KeyedDecodingContainer {
    func decodeFlexibleDouble(forKey key: Key) throws -> Double? {
        if let value = try decodeIfPresent(Double.self, forKey: key) { return value }
        if let value = try decodeIfPresent(Int.self, forKey: key) { return Double(value) }
        if let value = try decodeIfPresent(String.self, forKey: key) { return Double(value) }
        return nil
    }
}

extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var absoluteCityURL: URL? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
            return URL(string: trimmed)
        }
        if trimmed.hasPrefix("/") {
            return URL(string: "https://citymarkets.sa\(trimmed)")
        }
        return URL(string: "https://citymarkets.sa/\(trimmed)")
    }
}

extension Optional where Wrapped == String {
    var absoluteCityURL: URL? { self?.absoluteCityURL }
}

extension Double {
    var currencyText: String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "ar_SA")
        formatter.numberStyle = .currency
        formatter.currencyCode = "SAR"
        formatter.maximumFractionDigits = 2
        return formatter.string(from: NSNumber(value: self)) ?? "\(self) ر.س"
    }
}

extension Color {
    static let cmPrimary = Color(hex: "009345")
    static let cmPrimaryDark = Color(hex: "007A38")
    static let cmPrimaryLight = Color(hex: "E6F5EC")
    static let cmSale = Color(hex: "E53935")
    static let cmText = Color(hex: "1A1A1A")
    static let cmTextMuted = Color(hex: "6B7280")
    static let cmBorder = Color(hex: "EEEEEE")
    static let cmCartBar = Color(hex: "1E2A32")
    static let cmBg = Color(hex: "F8F9FA")

    init(hex: String) {
        var value: UInt64 = 0
        let normalized = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        Scanner(string: normalized).scanHexInt64(&value)
        self.init(
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }
}
