import Foundation

enum MoyasarConfig {
    static let publishableKey = "pk_live_546wcmNssGn2CZyxxoqicoET3QQnXkRtcjQm2SXs"
    static let merchantIdentifier = "merchant.com.meshalalanazi.citymarkets"
    static let currency = "SAR"
    static let countryCode = "SA"

    static func halalas(from amount: Double) -> Int {
        Int((amount * 100).rounded())
    }
}
