import Foundation

final class APIClient {
    static let shared = APIClient()

    private let baseURL = URL(string: "https://citymarkets.sa/api/v1")!
    private let tokenKey = "customer_session"
    private let authCookieNameKey = "customer_session_cookie_name"
    private let csrfKey = "__Host-authjs.csrf-token"
    private let guestKey = "guest_session_id"
    private let session: URLSession
    private var authToken: String?
    private var csrfToken: String?
    private var guestSessionId: String
    private var lastNominatimRequestDate = Date.distantPast
    private let authCookieNames = [
        "customer_session",
        "__Secure-authjs.session-token",
        "authjs.session-token",
        "__Secure-next-auth.session-token",
        "next-auth.session-token"
    ]

    var hasAuthToken: Bool {
        storedAuthToken() != nil
    }

    private var addressesPath: String {
        storedAuthToken() == nil ? "/delivery-addresses" : "/addresses"
    }

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 20
        config.waitsForConnectivity = false
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        config.httpCookieStorage = .shared
        session = URLSession(configuration: config)
        authToken = KeychainHelper.read(tokenKey)
        guestSessionId = UserDefaults.standard.string(forKey: guestKey) ?? UUID().uuidString
        UserDefaults.standard.set(guestSessionId, forKey: guestKey)
    }

    func getMobileConfig() async throws -> MobileConfig {
        let response: APIDataResponse<MobileConfig> = try await request("/mobile-config")
        return response.data
    }

    func getCategories() async throws -> [Category] {
        let response: APIDataResponse<[Category]> = try await request("/categories")
        return response.data
    }


    func getOffers() async throws -> [Offer] {
        let response: APIDataResponse<[Offer]> = try await request("/offers")
        return response.data
    }

    func getVendors() async throws -> [Vendor] {
        let response: VendorsResponse = try await request("/vendors")
        return response.vendors ?? response.data ?? []
    }

    func getVendor(slug: String) async throws -> Vendor {
        let response: VendorResponse = try await request("/vendors/\(slug)")
        guard let vendor = response.vendor ?? response.data else {
            throw APIError.decoding(NSError(domain: "citymarkets", code: 0, userInfo: [NSLocalizedDescriptionKey: "لا يوجد متجر في الاستجابة"]))
        }
        return vendor
    }

    func getAddresses() async throws -> [Address] {
        let response: AddressListResponse = try await request(addressesPath)
        return response.addresses ?? response.data ?? []
    }

    func createAddress(label: String, title: String, lat: Double, lng: Double, notes: String?, addressText: String?, placeImages: [String] = []) async throws -> Address {
        let existingAddressIds: Set<String>
        if storedAuthToken() != nil {
            existingAddressIds = Set((try? await getAddresses().map(\.id)) ?? [])
        } else {
            existingAddressIds = []
        }

        let body = CreateAddressRequest(label: label, title: title, lat: lat, lng: lng, notes: notes, addressText: addressText, placeImages: placeImages)
        let resp: AddressSingleResponse = try await request(addressesPath, method: "POST", body: body)
        if let address = resp.address ?? resp.data {
            return address
        }
        if let createdId = resp.createdId {
            return Address(
                id: createdId,
                label: label,
                title: title,
                lat: lat,
                lng: lng,
                notes: notes,
                addressText: addressText,
                placeImages: placeImages,
                isDefault: false
            )
        }
        guard storedAuthToken() == nil else {
            if let createdAddress = try await confirmedCreatedAddress(
                excluding: existingAddressIds,
                label: label,
                title: title,
                lat: lat,
                lng: lng,
                addressText: addressText
            ) {
                return createdAddress
            }
            throw APIError.status(409, "تعذر تأكيد حفظ العنوان من الخادم. حاول حفظه مرة أخرى")
        }
        return Address(
            id: UUID().uuidString,
            label: label,
            title: title,
            lat: lat,
            lng: lng,
            notes: notes,
            addressText: addressText,
            placeImages: placeImages,
            isDefault: false
        )
    }

    func uploadPlaceImages(_ images: [Data]) async throws -> [String] {
        guard !images.isEmpty else { return [] }
        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: baseURL.appendingPathComponent("upload/place-images"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(guestSessionId, forHTTPHeaderField: "x-session-id")
        request.setValue(guestSessionId, forHTTPHeaderField: "x-guest-key")
        if let authToken = storedAuthToken() {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        request.setValue(requestCookieParts().joined(separator: "; "), forHTTPHeaderField: "Cookie")
        request.httpBody = multipartBody(images: Array(images.prefix(5)), boundary: boundary)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        captureSessionCookie(from: http)
        guard (200...299).contains(http.statusCode) else {
            let apiError = try? JSONDecoder.api.decode(ErrorResponse.self, from: data)
            throw APIError.status(http.statusCode, apiError?.error ?? apiError?.message ?? String(data: data, encoding: .utf8) ?? "تعذر رفع صور المكان")
        }
        return try JSONDecoder.api.decode(PlaceImagesUploadResponse.self, from: data).uploadedURLs
    }

    func updateAddress(id: String, label: String, title: String, lat: Double, lng: Double, notes: String?, addressText: String?, placeImages: [String] = []) async throws -> Address {
        let body = CreateAddressRequest(label: label, title: title, lat: lat, lng: lng, notes: notes, addressText: addressText, placeImages: placeImages)
        let response: AddressSingleResponse = try await request("\(addressesPath)/\(id)", method: "PUT", body: body)
        if let address = response.address ?? response.data {
            return address
        }
        return Address(id: id, label: label, title: title, lat: lat, lng: lng, notes: notes, addressText: addressText, placeImages: placeImages, isDefault: false)
    }

    func deleteAddress(id: String) async throws -> SuccessResponse {
        try await request("\(addressesPath)/\(id)", method: "DELETE", body: EmptyBody())
    }

    func getProducts(category: String? = nil, search: String? = nil, featured: Bool = false, vendor: String? = nil, limit: Int = 50) async throws -> ProductsResponse {
        var query: [URLQueryItem] = [URLQueryItem(name: "limit", value: String(limit))]
        if let category { query.append(URLQueryItem(name: "category", value: category)) }
        if let search { query.append(URLQueryItem(name: "search", value: search)) }
        if featured { query.append(URLQueryItem(name: "featured", value: "true")) }
        if let vendor { query.append(URLQueryItem(name: "vendor", value: vendor)) }
        return try await request("/products", query: query)
    }

    func getProduct(id: String) async throws -> ProductDetailResponse {
        try await request("/products/\(id)")
    }

    func getReviews(productId: String) async throws -> [Review] {
        let response: APIDataResponse<[Review]> = try await request("/reviews", query: [URLQueryItem(name: "product", value: productId)])
        return response.data
    }

    func createReview(orderId: String, storeRating: Int, driverRating: Int?, comment: String?) async throws -> SuccessResponse {
        try await request("/reviews", method: "POST", body: ReviewRequest(orderId: orderId, driverRating: driverRating, storeRating: storeRating, comment: comment))
    }

    func getCart() async throws -> CartResponse {
        try await request("/cart")
    }

    func addToCart(productId: String, vendorId: String?, quantity: Int) async throws -> SuccessResponse {
        let body = AddCartRequest(productId: productId, vendorId: vendorId, quantity: quantity)
        return try await request("/cart", method: "POST", body: body)
    }

    func updateCartItem(productId: String, quantity: Int) async throws -> SuccessResponse {
        try await request("/cart", method: "PUT", body: UpdateCartRequest(productId: productId, quantity: quantity))
    }

    func clearCart() async throws -> SuccessResponse {
        try await request("/cart", method: "DELETE", body: EmptyBody())
    }

    func getCoupons() async throws -> [Coupon] {
        let response: APIDataResponse<[Coupon]> = try await request("/coupons")
        return response.data
    }

    // MARK: – Home layout (the sections managed in admin/home-design)

    /// The `mobile` layout is the one the admin edits under «جوال + التطبيق».
    func getHomeLayout(device: String = "mobile") async throws -> HomeLayout? {
        let response: HomeLayoutResponse = try await request("/home-layout", query: [URLQueryItem(name: "device", value: device)])
        return response.data
    }

    func getProducts(queryItems: [URLQueryItem]) async throws -> [Product] {
        let response: ProductsResponse = try await request("/products", query: queryItems)
        return response.data
    }

    func getOffers(queryItems: [URLQueryItem]) async throws -> [Offer] {
        let response: APIDataResponse<[Offer]> = try await request("/offers", query: queryItems)
        return response.data
    }

    func getVendors(queryItems: [URLQueryItem]) async throws -> [Vendor] {
        let response: VendorsResponse = try await request("/vendors", query: queryItems)
        return response.vendors ?? response.data ?? []
    }

    func getHomeCoupons(queryItems: [URLQueryItem]) async throws -> [HomeCoupon] {
        let response: APIDataResponse<[HomeCoupon]> = try await request("/coupons", query: queryItems)
        return response.data
    }

    func getDeliverySlots(date: String, zoneId: String?) async throws -> DeliverySlotsResponse {
        var query = [URLQueryItem(name: "date", value: date)]
        if let zoneId { query.append(URLQueryItem(name: "zone", value: zoneId)) }
        return try await request("/delivery/slots", query: query)
    }

    func getDeliveryQuote(latitude: Double, longitude: Double, subtotal: Double) async throws -> DeliveryQuoteResponse {
        let body = DeliveryQuoteRequest(latitude: latitude, longitude: longitude, subtotal: subtotal)
        return try await publicPost("/delivery/quote", body: body)
    }

    func reverseGeocode(latitude: Double, longitude: Double) async throws -> ResolvedLocationAddress {
        try await throttleNominatimRequest()
        var components = URLComponents(string: "https://nominatim.openstreetmap.org/reverse")
        components?.queryItems = [
            URLQueryItem(name: "lat", value: String(latitude)),
            URLQueryItem(name: "lon", value: String(longitude)),
            URLQueryItem(name: "format", value: "json"),
            URLQueryItem(name: "accept-language", value: "ar"),
            URLQueryItem(name: "zoom", value: "18"),
            URLQueryItem(name: "addressdetails", value: "1")
        ]
        guard let url = components?.url else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.setValue("CityMarketsSA/1.0 (delivery-address)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200...299).contains(http.statusCode) else {
            throw APIError.status(http.statusCode, "تعذر قراءة تفاصيل الموقع")
        }
        return try JSONDecoder.api.decode(NominatimReverseGeocodeResponse.self, from: data).resolvedAddress(
            latitude: latitude,
            longitude: longitude
        )
    }

    func validateCoupon(code: String, subtotal: Double, vendorId: String?) async throws -> CouponValidationResponse {
        try await request("/coupons/validate", method: "POST", body: CouponValidationRequest(code: code, subtotal: subtotal, vendorId: vendorId))
    }

    func getLoyalty() async throws -> LoyaltySummary {
        try await request("/loyalty")
    }

    func previewLoyaltyRedemption(subtotal: Double, maxPoints: Int?) async throws -> LoyaltyPreview {
        try await request("/loyalty", method: "POST", body: LoyaltyPreviewRequest(subtotal: subtotal, maxPointsToUse: maxPoints))
    }

    func sendOTP(phone: String) async throws -> SuccessResponse {
        return try await otpRequest(
            "/auth/twilio/send",
            body: PhoneRequest(phone: otpPhone(phone)),
            unavailableMessage: "تعذر إرسال رمز التحقق الآن. خدمة الرسائل غير متاحة مؤقتاً، حاول مرة أخرى بعد قليل"
        )
    }

    func verifyOTP(phone: String, code: String) async throws -> User {
        let response: AuthResponse = try await otpRequest(
            "/auth/twilio/verify",
            body: VerifyRequest(phone: otpPhone(phone), code: normalizedOTPCode(code)),
            unavailableMessage: "تعذر التحقق من الرمز الآن. خدمة الرسائل غير متاحة مؤقتاً، حاول مرة أخرى بعد قليل"
        )
        if let token = response.token ?? extractStoredCookieToken() {
            authToken = token
            KeychainHelper.save(tokenKey, token)
        } else {
            print("CityMarkets OTP verify succeeded without a readable customer_session cookie. Later authenticated requests may fail.")
        }
        return response.user
    }

    func currentUser() async throws -> User? {
        let response: CurrentUserResponse = try await request("/auth/me")
        return response.user
    }

    func logout() async throws -> SuccessResponse {
        try await request("/auth/logout", method: "POST", body: EmptyBody())
    }

    func deleteAccount() async throws -> DeleteAccountResponse {
        guard let authToken = storedAuthToken() else {
            throw APIError.status(401, "يجب تسجيل الدخول أولاً")
        }

        var request = URLRequest(url: baseURL.appendingPathComponent("profile/delete"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder.request.encode(DeleteAccountRequest(confirmation: "DELETE"))

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        captureSessionCookie(from: http)
        guard (200...299).contains(http.statusCode) else {
            let apiError = try? JSONDecoder.api.decode(DeleteAccountResponse.self, from: data)
            throw APIError.status(http.statusCode, apiError?.error ?? apiError?.message ?? "تعذر حذف الحساب")
        }
        return try JSONDecoder.api.decode(DeleteAccountResponse.self, from: data)
    }

    func getOrders() async throws -> [Order] {
        let response: OrdersResponse = try await request("/orders")
        return response.orders ?? response.data ?? []
    }

    func getOrderTimeline(orderId: String) async throws -> [TimelineEvent] {
        let response: TimelineResponse = try await request("/orders/\(orderId)/timeline")
        return response.timeline ?? []
    }

    func downloadOrderPDF(orderId: String) async throws -> Data {
        let url = baseURL.appendingPathComponent("orders/\(orderId)/invoice-pdf")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.network(NSError(domain: "citymarkets", code: 0))
        }

        guard 200...299 ~= httpResponse.statusCode else {
            throw APIError.http(httpResponse.statusCode)
        }

        return data
    }

    func getMyReviews() async throws -> [UserReview] {
        let response: MyReviewsResponse = try await request("/reviews", query: [URLQueryItem(name: "mine", value: "1")])
        return response.reviews ?? []
    }

    func updateProfile(name: String?, email: String?, avatarUrl: String?) async throws -> SuccessResponse {
        let body = ProfileUpdateRequest(name: name, email: email, avatar_url: avatarUrl)
        return try await request("/profile", method: "PUT", body: body)
    }

    func sendChefMessage(_ message: String, history: [ChefChatMessage], sensitiveValues: [String]) async throws -> AIChatResponse {
        let sanitizedMessage = sanitizedAIText(message, sensitiveValues: sensitiveValues)
        let sanitizedHistory = history.map {
            AIChatTurn(role: $0.role.rawValue, content: sanitizedAIText($0.content, sensitiveValues: sensitiveValues))
        }
        let body = AIChatRequest(
            message: sanitizedMessage,
            history: sanitizedHistory
        )
        return try await request("/ai-chat", method: "POST", body: body)
    }

    func checkout(items: [CheckoutItem], name: String?, phone: String?, notes: String?, paymentMethod: String, moyasarMethod: String? = nil, scheduled: Bool = false, scheduledFor: String? = nil, slotId: String? = nil, slotWindow: String? = nil, deliveryZoneId: String? = nil, scheduledAt: String? = nil, address: Address?, couponCode: String? = nil, pointsRedeemed: Int? = nil) async throws -> CheckoutResponse {
        if storedAuthToken() == nil {
            try await refreshCSRFToken()
        }
        let idempotencyKey = "ios-\(UUID().uuidString)"
        let guestInfo: GuestCheckoutInfo?
        if storedAuthToken() == nil, let address, let name, let phone {
            guestInfo = GuestCheckoutInfo(name: name, phone: phone, address: address)
        } else {
            guestInfo = nil
        }
        let addressId = storedAuthToken() == nil ? nil : address?.id.nilIfBlank
        let body = CheckoutRequest(
            items: items,
            paymentMethod: paymentMethod,
            moyasarMethod: moyasarMethod,
            deliveryType: "delivery",
            notes: notes,
            customerName: name,
            customerPhone: phone,
            addressId: addressId,
            address: address.map(CheckoutAddressInfo.init(address:)),
            guestInfo: guestInfo,
            couponCode: couponCode,
            pointsRedeemed: pointsRedeemed,
            scheduled: scheduled,
            scheduledFor: scheduledFor,
            slotId: slotId,
            slotWindow: slotWindow,
            deliveryZoneId: deliveryZoneId,
            scheduledAt: scheduledAt,
            idempotencyKey: idempotencyKey
        )
        var response: CheckoutResponse = try await request("/checkout", method: "POST", body: body, idempotencyKey: idempotencyKey)
        if response.idempotencyKey == nil {
            response.idempotencyKey = idempotencyKey
        }
        return response
    }

    func initiatePayment(orderId: String) async throws -> PaymentInitiateResponse {
        let idempotencyKey = "ios-payment-\(UUID().uuidString)"
        return try await request("/payments/initiate", method: "POST", body: PaymentOrderRequest(orderId: orderId), idempotencyKey: idempotencyKey)
    }

    func retryPayment(orderId: String) async throws -> PaymentInitiateResponse {
        let idempotencyKey = "ios-payment-\(UUID().uuidString)"
        return try await request("/payments/retry", method: "POST", body: PaymentOrderRequest(orderId: orderId), idempotencyKey: idempotencyKey)
    }

    func updateOrderPaymentMethod(orderId: String, paymentMethod: String, moyasarMethod: String? = nil, idempotencyKey: String) async throws -> SuccessResponse {
        let body = UpdatePaymentMethodRequest(
            paymentMethod: paymentMethod,
            moyasarMethod: moyasarMethod,
            idempotencyKey: idempotencyKey
        )
        return try await request("/orders/\(orderId)/payment-method", method: "PATCH", body: body, idempotencyKey: idempotencyKey)
    }

    func trackGuestOrder(code: String, phone: String) async throws -> TrackedOrder {
        try await request("/orders/track", query: [
            URLQueryItem(name: "order", value: code),
            URLQueryItem(name: "phone", value: phone)
        ])
    }

    func acknowledgeEvent(id: String) async throws -> SuccessResponse {
        try await request("/events/ack", method: "POST", body: EventAckRequest(eventId: id))
    }

    func streamOrderEvents(onEvent: @escaping @Sendable (OrderEvent) -> Void) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("events/stream"))
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue(guestSessionId, forHTTPHeaderField: "x-guest-key")
        if let authToken = storedAuthToken() {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        request.setValue(requestCookieParts().joined(separator: "; "), forHTTPHeaderField: "Cookie")

        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw APIError.invalidResponse
        }

        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespacesAndNewlines)
            guard let data = payload.data(using: .utf8),
                  let event = try? JSONDecoder.api.decode(OrderEvent.self, from: data) else { continue }
            onEvent(event)
        }
    }

    func clearAuth() {
        authToken = nil
        KeychainHelper.delete(tokenKey)
        UserDefaults.standard.removeObject(forKey: authCookieNameKey)
    }

    private func refreshCSRFToken() async throws {
        guard csrfToken == nil else { return }
        let url = baseURL.appendingPathComponent("auth/csrf")
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(guestSessionId, forHTTPHeaderField: "x-session-id")
        request.setValue(guestSessionId, forHTTPHeaderField: "x-guest-key")
        request.setValue(requestCookieParts().joined(separator: "; "), forHTTPHeaderField: "Cookie")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw APIError.status(403, "تعذر تجهيز رمز أمان الطلب")
        }
        captureSessionCookie(from: http)
        if csrfToken == nil,
           let response = try? JSONDecoder.api.decode(CSRFResponse.self, from: data) {
            csrfToken = response.csrfToken
        }
        if csrfToken == nil {
            try await refreshCSRFTokenFromSiteRoot()
        }
    }

    private func refreshCSRFTokenFromSiteRoot() async throws {
        let url = URL(string: "https://citymarkets.sa/")!
        let (_, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200...399).contains(http.statusCode) else { return }
        captureSessionCookie(from: http)
    }

    private func request<T: Decodable, Body: Encodable>(_ path: String, method: String = "GET", query: [URLQueryItem] = [], body: Body? = Optional<EmptyBody>.none, idempotencyKey: String? = nil, allowsSecurityTokenRetry: Bool = true) async throws -> T {
        if isOTPPath(path) {
            print("CityMarkets OTP preparing \(method) \(path)")
        }
        if method != "GET" && csrfToken == nil {
            try await refreshCSRFToken()
        }

        var components = URLComponents(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))), resolvingAgainstBaseURL: false)
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw APIError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(guestSessionId, forHTTPHeaderField: "x-session-id")
        request.setValue(guestSessionId, forHTTPHeaderField: "x-guest-key")
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        if let authToken = storedAuthToken() {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        var cookieParts = requestCookieParts()
        if let csrfToken {
            cookieParts.append("\(csrfKey)=\(csrfToken)")
        }
        request.setValue(cookieParts.joined(separator: "; "), forHTTPHeaderField: "Cookie")
        if method != "GET" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let csrfToken {
                request.setValue(csrfHeaderToken(from: csrfToken), forHTTPHeaderField: "x-csrf-token")
            }
            if let body { request.httpBody = try JSONEncoder.request.encode(body) }
        }

        logOTPRequestIfNeeded(request, path: path)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        captureSessionCookie(from: http)
        logOTPResponseIfNeeded(http, data: data, path: path)
        guard (200...299).contains(http.statusCode) else {
            let apiError = try? JSONDecoder.api.decode(ErrorResponse.self, from: data)
            let message = apiError?.error ?? apiError?.message ?? String(data: data, encoding: .utf8) ?? "حدث خطأ"
            if method != "GET", allowsSecurityTokenRetry, isSecurityTokenError(statusCode: http.statusCode, message: message) {
                csrfToken = nil
                try await refreshCSRFToken()
                return try await self.request(path, method: method, query: query, body: body, idempotencyKey: idempotencyKey, allowsSecurityTokenRetry: false)
            }
            throw APIError.status(http.statusCode, message)
        }
        do {
            return try JSONDecoder.api.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func normalizedSaudiPhone(_ phone: String) -> String {
        let digits = phone.filter(\.isNumber)
        if digits.hasPrefix("966") { return "+\(digits)" }
        if digits.hasPrefix("05") { return "+966\(digits.dropFirst())" }
        if digits.hasPrefix("5") { return "+966\(digits)" }
        return phone.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func otpPhone(_ phone: String) -> String {
        phone.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func normalizedOTPCode(_ code: String) -> String {
        code.filter(\.isNumber)
    }

    private func storedAuthToken() -> String? {
        if let authToken {
            return authToken
        }
        if let keychainToken = KeychainHelper.read(tokenKey) {
            authToken = keychainToken
            return keychainToken
        }
        if let cookieToken = extractStoredCookieToken() {
            authToken = cookieToken
            KeychainHelper.save(tokenKey, cookieToken)
            return cookieToken
        }
        return nil
    }

    private func requestCookieParts() -> [String] {
        var cookies: [String: String] = ["cart-session-id": guestSessionId]

        for cookie in authCookies() {
            cookies[cookie.name] = cookie.value
        }

        if let authToken = authToken ?? KeychainHelper.read(tokenKey) {
            let cookieName = UserDefaults.standard.string(forKey: authCookieNameKey) ?? tokenKey
            cookies[cookieName] = authToken
        }

        return cookies.map { "\($0.key)=\($0.value)" }
    }

    private func authCookies() -> [HTTPCookie] {
        (HTTPCookieStorage.shared.cookies ?? []).filter { cookie in
            authCookieNames.contains(cookie.name)
        }
    }

    private func csrfHeaderToken(from token: String) -> String {
        let decoded = token.removingPercentEncoding ?? token
        return decoded.split(separator: "|").first.map(String.init) ?? decoded
    }

    private func logOTPRequestIfNeeded(_ request: URLRequest, path: String) {
        guard isOTPPath(path) else { return }
        let body = request.httpBody.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        print("""
        CityMarkets OTP request
        \(request.httpMethod ?? "GET") \(request.url?.absoluteString ?? path)
        headers: \(sanitizedHeaders(request.allHTTPHeaderFields ?? [:]))
        body: \(body)
        """)
    }

    private func logOTPResponseIfNeeded(_ response: HTTPURLResponse, data: Data, path: String) {
        guard isOTPPath(path) else { return }
        let body = String(data: data, encoding: .utf8) ?? "<non-utf8 body>"
        print("""
        CityMarkets OTP response
        \(response.statusCode) \(response.url?.absoluteString ?? path)
        headers: \(sanitizedHeaders(response.allHeaderFields.reduce(into: [String: String]()) { result, pair in
            result[String(describing: pair.key)] = String(describing: pair.value)
        }))
        body: \(body)
        storedAuthCookies: \(authCookies().map { $0.name })
        hasAuthToken: \(authToken != nil)
        """)
    }

    private func isOTPPath(_ path: String) -> Bool {
        path == "/auth/twilio/send" || path == "/auth/twilio/verify"
    }

    private func sanitizedHeaders(_ headers: [String: String]) -> [String: String] {
        headers.reduce(into: [String: String]()) { result, item in
            let key = item.key
            let lowercasedKey = key.lowercased()
            if lowercasedKey == "authorization" || lowercasedKey == "cookie" || lowercasedKey == "set-cookie" {
                result[key] = sanitizedHeaderValue(item.value)
            } else {
                result[key] = item.value
            }
        }
    }

    private func sanitizedHeaderValue(_ value: String) -> String {
        var sanitized = value
        for cookieName in authCookieNames + [csrfKey, "csrf_token"] {
            sanitized = sanitized.replacingMatches(of: "(\(NSRegularExpression.escapedPattern(for: cookieName))=)[^;,\"]+", with: "$1[redacted]")
        }
        sanitized = sanitized.replacingMatches(of: #"Bearer\s+[A-Za-z0-9._~+/=-]+"#, with: "Bearer [redacted]")
        return sanitized
    }

    private func isSecurityTokenError(statusCode: Int, message: String) -> Bool {
        guard statusCode == 400 || statusCode == 401 || statusCode == 403 || statusCode == 419 else { return false }
        let normalized = message.lowercased()
        return normalized.contains("csrf")
            || normalized.contains("security")
            || normalized.contains("verification token")
            || normalized.contains("رمز التحقق")
            || normalized.contains("رمز أمان")
            || normalized.contains("انتهاك أمان")
    }

    private func sanitizedAIText(_ text: String, sensitiveValues: [String]) -> String {
        var sanitized = text

        for value in sensitiveValues {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.count >= 3 else { continue }
            sanitized = sanitized.replacingOccurrences(of: trimmed, with: "[محذوف]", options: [.caseInsensitive, .diacriticInsensitive])
        }

        let patterns = [
            #"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#,
            #"(?<!\d)(?:\+?966|00966|0)?5\d{8}(?!\d)"#,
            #"(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)"#,
            #"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"#,
            #"(?<!\d)-?\d{1,2}\.\d{4,}\s*[,،]\s*-?\d{1,3}\.\d{4,}(?!\d)"#,
            #"(?i)\b(?:sk|pk|tok|cus|usr|user|acct|order|pay)_[A-Za-z0-9_-]{8,}\b"#
        ]

        for pattern in patterns {
            sanitized = sanitized.replacingMatches(of: pattern, with: "[محذوف]")
        }

        return sanitized
    }

    private func otpRequest<T: Decodable, Body: Encodable>(_ path: String, body: Body, unavailableMessage: String) async throws -> T {
        do {
            return try await request(path, method: "POST", body: body)
        } catch {
            guard isTransientServerError(error) else { throw error }
            try? await Task.sleep(for: .milliseconds(650))
        }

        do {
            return try await request(path, method: "POST", body: body)
        } catch {
            guard isTransientServerError(error) else { throw error }
            throw APIError.status(statusCode(from: error) ?? 503, unavailableMessage)
        }
    }

    private func isTransientServerError(_ error: Error) -> Bool {
        guard let code = statusCode(from: error) else { return false }
        return code == 502 || code == 503 || code == 504
    }

    private func statusCode(from error: Error) -> Int? {
        if case APIError.status(let code, _) = error { return code }
        return nil
    }

    private func publicPost<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(guestSessionId, forHTTPHeaderField: "x-session-id")
        request.setValue(guestSessionId, forHTTPHeaderField: "x-guest-key")
        request.setValue(requestCookieParts().joined(separator: "; "), forHTTPHeaderField: "Cookie")
        request.httpBody = try JSONEncoder.request.encode(body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        captureSessionCookie(from: http)
        guard (200...299).contains(http.statusCode) else {
            let apiError = try? JSONDecoder.api.decode(ErrorResponse.self, from: data)
            throw APIError.status(http.statusCode, apiError?.error ?? apiError?.message ?? String(data: data, encoding: .utf8) ?? "تعذر إكمال الطلب")
        }
        return try JSONDecoder.api.decode(T.self, from: data)
    }

    private func throttleNominatimRequest() async throws {
        let elapsed = Date().timeIntervalSince(lastNominatimRequestDate)
        if elapsed < 1 {
            try await Task.sleep(for: .milliseconds(Int((1 - elapsed) * 1000)))
        }
        lastNominatimRequestDate = Date()
    }

    private func confirmedCreatedAddress(excluding existingAddressIds: Set<String>, label: String, title: String, lat: Double, lng: Double, addressText: String?) async throws -> Address? {
        let delays: [UInt64] = [0, 350_000_000, 900_000_000]
        for delay in delays {
            if delay > 0 { try await Task.sleep(nanoseconds: delay) }
            let addresses = try await getAddresses()
            if let createdAddress = addresses.first(where: { !existingAddressIds.contains($0.id) })
                ?? matchingCreatedAddress(in: addresses, label: label, title: title, lat: lat, lng: lng, addressText: addressText) {
                return createdAddress
            }
        }
        return nil
    }

    private func matchingCreatedAddress(in addresses: [Address], label: String, title: String, lat: Double, lng: Double, addressText: String?) -> Address? {
        let normalizedTitle = title.nilIfBlank
        let normalizedAddressText = addressText?.nilIfBlank
        return addresses.first { address in
            let hasSameCoordinates: Bool
            if let addressLat = address.lat, let addressLng = address.lng {
                hasSameCoordinates = abs(addressLat - lat) < 0.0002 && abs(addressLng - lng) < 0.0002
            } else {
                hasSameCoordinates = false
            }

            let hasSameText = address.title?.nilIfBlank == normalizedTitle
                || address.addressText?.nilIfBlank == normalizedAddressText
                || address.label == label

            return hasSameCoordinates && hasSameText
        }
    }

    // MARK: – Push Notifications (APNs)

    /// Register device token for push notifications
    func registerAPNsToken(deviceToken: String) async throws -> SuccessResponse {
        guard storedAuthToken() != nil else { throw APIError.status(401, "يجب تسجيل الدخول") }

        let body: [String: Any] = [
            "platform": "apns",
            "deviceToken": deviceToken,
            "environment": "production", // Use sandbox for development
            "bundleId": Bundle.main.bundleIdentifier ?? "com.citymarkets.app",
            "locale": "ar"
        ]

        return try await request("/push/apns-register", method: "POST", body: body)
    }

    /// Unregister device token
    func unregisterAPNsToken(deviceToken: String) async throws -> SuccessResponse {
        guard storedAuthToken() != nil else { throw APIError.status(401, "يجب تسجيل الدخول") }

        let body: [String: String] = [
            "platform": "apns",
            "deviceToken": deviceToken
        ]

        return try await request("/push/apns-register", method: "DELETE", body: body)
    }

    // MARK: – Wishlist (favorites sync with server)

    /// Get the list of favorite product IDs from the server (registered users only).
    func getWishlist() async throws -> [String] {
        guard storedAuthToken() != nil else {
            // Guests don't sync favorites to the server
            return []
        }
        let response: APIDataResponse<[String]> = try await request("/wishlist")
        return response.data
    }

    /// Check if a specific product is in the user's wishlist.
    func checkWishlist(productId: String) async throws -> Bool {
        guard storedAuthToken() != nil else {
            // Guests check their local UserDefaults instead
            return false
        }
        let response: APIDataResponse<Bool> = try await request("/wishlist/check", query: [URLQueryItem(name: "product", value: productId)])
        return response.data
    }

    /// Add a product to the wishlist (registered users only).
    func addToWishlist(productId: String) async throws -> SuccessResponse {
        guard storedAuthToken() != nil else { throw APIError.status(401, "يجب تسجيل الدخول لحفظ المفضلة") }
        return try await request("/wishlist", method: "POST", body: ["product_id": productId])
    }

    /// Remove a product from the wishlist.
    func removeFromWishlist(productId: String) async throws -> SuccessResponse {
        guard storedAuthToken() != nil else { throw APIError.status(401, "يجب تسجيل الدخول لإدارة المفضلة") }
        return try await request("/wishlist", method: "DELETE", body: ["product_id": productId])
    }

    // MARK: - Direct Order

    /// Create a direct order (voice notes + free-text items + custom address)
    func createDirectOrder(
        paymentMethod: String,
        notes: String?,
        voiceNoteUrl: String?,
        voiceNoteDuration: Int?,
        customerPhone: String?,
        deliveryAddress: DirectOrderAddress,
        items: [DirectOrderItem]?
    ) async throws -> DirectOrderResponse {
        guard storedAuthToken() != nil else {
            throw APIError.status(401, "يجب تسجيل الدخول لإنشاء طلب مباشر")
        }

        let request = DirectOrderRequest(
            payment_method: paymentMethod,
            notes: notes,
            voice_note_url: voiceNoteUrl,
            voice_note_duration: voiceNoteDuration,
            customer_phone: customerPhone,
            fee_acknowledged: true,
            delivery_address: deliveryAddress,
            items: items,
            idempotency_key: UUID().uuidString
        )

        let response: DirectOrderResponse = try await self.request(
            "/orders/direct",
            method: "POST",
            body: request,
            idempotencyKey: request.idempotency_key
        )
        return response
    }

    private func multipartBody(images: [Data], boundary: String) -> Data {
        var body = Data()
        for (index, image) in images.enumerated() {
            body.append(Data("--\(boundary)\r\n".utf8))
            body.append(Data("Content-Disposition: form-data; name=\"images\"; filename=\"place-\(index + 1).jpg\"\r\n".utf8))
            body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
            body.append(image)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))
        return body
    }

    private func captureSessionCookie(from response: HTTPURLResponse) {
        guard let fields = response.allHeaderFields as? [String: String], let url = response.url else { return }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
        if let cookie = cookies.first(where: { authCookieNames.contains($0.name) }) {
            authToken = cookie.value
            KeychainHelper.save(tokenKey, cookie.value)
            UserDefaults.standard.set(cookie.name, forKey: authCookieNameKey)
        }
        if let token = cookies.first(where: { $0.name == csrfKey || $0.name == "csrf_token" })?.value {
            csrfToken = token
        }
        cookies.forEach { HTTPCookieStorage.shared.setCookie($0) }
    }

    private func extractStoredCookieToken() -> String? {
        guard let cookie = authCookies().first else { return nil }
        UserDefaults.standard.set(cookie.name, forKey: authCookieNameKey)
        return cookie.value
    }
}
