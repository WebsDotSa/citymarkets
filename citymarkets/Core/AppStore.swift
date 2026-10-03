import CoreLocation
import Foundation
import Combine
import UserNotifications

@MainActor
final class AppStore: ObservableObject {
    /// Visible sections of the `mobile` home layout (admin/home-design).
    /// Empty → HomeView falls back to the built-in composition.
    @Published var homeSections: [HomeSection] = []
    @Published var offers: [Offer] = []
    @Published var categories: [Category] = []
    @Published var products: [Product] = []
    @Published var featuredProducts: [Product] = []
    @Published var cartItems: [CartItem] = []
    @Published var orders: [Order] = []
    @Published var user: User? = AppStore.cachedUser()
    @Published var isLoading = false
    @Published var message: String?
    @Published var selectedCategorySlug: String?
    @Published var searchText = ""
    @Published var deliveryLocationTitle = UserDefaults.standard.string(forKey: "delivery_location_title") ?? "تحديد الموقع"
    @Published var chefMessages: [ChefChatMessage] = []
    @Published var vendors: [Vendor] = []
    @Published var savedAddresses: [Address] = []
    @Published var selectedAddressId: String? = UserDefaults.standard.string(forKey: "selected_address_id")
    @Published var favoriteProductIds: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "favorite_product_ids") ?? [])
    @Published var availableCoupons: [Coupon] = []
    @Published var appliedCoupon: Coupon?
    @Published var loyaltySummary: LoyaltySummary?
    @Published var loyaltyPreview: LoyaltyPreview?
    @Published var loyaltyPointsToRedeem: Int?
    @Published var deliverySlots: DeliverySlotsResponse?
    @Published var selectedDeliverySlot: DeliverySlot?
    @Published var deliveryQuote: DeliveryQuoteResponse?
    @Published var trackedGuestOrder: TrackedOrder?
    @Published var liveOrderEvent: OrderEvent?
    @Published var chefOpenAIConsentGranted = UserDefaults.standard.bool(forKey: "chef_openai_data_sharing_consent")
    @Published var mobileConfig: MobileConfig?
    @Published var forceUpdateRequired = false
    @Published var notificationsEnabled = false
    @Published var notificationPermissionDenied = false
    @Published var selectedOrderId: String?
    @Published private var favoriteProductCache: [Product] = []

    private let api = APIClient.shared
    private var orderEventsTask: Task<Void, Never>?
    private static let cachedUserKey = "cached_user"
    private let automaticAddressIdKey = "automatic_location_address_id"
    private let profileNameKey = "profile_name_override"
    private let profileEmailKey = "profile_email_override"
    private let authenticatedPhoneKey = "authenticated_phone"
    private let localCartKey = "local_guest_cart_items"
    private let apnsTokenKey = "apns_device_token"

    var isAuthenticated: Bool {
        api.hasAuthToken && user != nil
    }

    var hasSignedInUser: Bool {
        user != nil
    }

    var needsProfileName: Bool {
        user?.name?.nilIfBlank == nil
    }

    var needsCheckoutProfileDetails: Bool {
        guard let user else { return false }
        return user.phone.nilIfBlank == nil
    }

    var canUseAuthenticatedFeatures: Bool {
        isAuthenticated && !needsProfileName
    }

    private var hasServerAuthSession: Bool {
        api.hasAuthToken
    }

    var cartSubtotal: Double {
        cartItems.reduce(0) { $0 + $1.total }
    }

    var couponDiscount: Double {
        guard let coupon = appliedCoupon else { return 0 }
        let discount: Double
        switch coupon.type {
        case "percent": discount = cartSubtotal * ((coupon.value ?? 0) / 100)
        case "fixed": discount = coupon.value ?? 0
        default: discount = 0
        }
        return min(discount, coupon.maxDiscount ?? discount, cartSubtotal)
    }

    var loyaltyDiscount: Double {
        min(loyaltyPreview?.discountSar ?? 0, max(cartSubtotal - couponDiscount, 0))
    }

    var checkoutDiscount: Double {
        couponDiscount + loyaltyDiscount
    }

    var deliveryFee: Double {
        deliveryQuote?.inDeliveryArea == true ? deliveryQuote?.deliveryFee ?? 0 : 0
    }

    var checkoutTotal: Double {
        max(cartSubtotal + deliveryFee - checkoutDiscount, 0)
    }

    var cartCount: Int {
        cartItems.reduce(0) { $0 + $1.quantity }
    }

    var selectedAddress: Address? {
        if let selectedAddressId,
           let address = savedAddresses.first(where: { $0.id == selectedAddressId && $0.hasValidDeliveryCoordinates }) {
            return address
        }
        return savedAddresses.first(where: { $0.isDefault == true && $0.hasValidDeliveryCoordinates })
            ?? savedAddresses.first(where: \.hasValidDeliveryCoordinates)
    }

    var favoriteProducts: [Product] {
        let candidates = favoriteProductCache + featuredProducts + products
        var seen = Set<String>()
        return candidates.filter { product in
            guard favoriteProductIds.contains(product.id), !seen.contains(product.id) else { return false }
            seen.insert(product.id)
            return true
        }
    }

    func isFavorite(_ product: Product) -> Bool {
        favoriteProductIds.contains(product.id)
    }

    func toggleFavorite(_ product: Product) {
        let isCurrentlyFavorite = favoriteProductIds.contains(product.id)

        if isCurrentlyFavorite {
            favoriteProductIds.remove(product.id)
            favoriteProductCache.removeAll { $0.id == product.id }
            message = "تمت إزالة المنتج من المفضلة"
        } else {
            favoriteProductIds.insert(product.id)
            if !favoriteProductCache.contains(where: { $0.id == product.id }) {
                favoriteProductCache.insert(product, at: 0)
            }
            message = "تمت إضافة المنتج للمفضلة"
        }

        // Always save to local storage (for guests and offline)
        UserDefaults.standard.set(Array(favoriteProductIds), forKey: "favorite_product_ids")

        // Sync with server if authenticated
        if isAuthenticated {
            Task {
                do {
                    if isCurrentlyFavorite {
                        _ = try await api.removeFromWishlist(productId: product.id)
                    } else {
                        _ = try await api.addToWishlist(productId: product.id)
                    }
                } catch {
                    // If sync fails, the local change is still persisted
                    // so we don't show an error — the user still has their local state
                }
            }
        }
    }

    /// Load favorites from server for authenticated users, or from local storage for guests.
    func loadFavorites() async {
        if isAuthenticated {
            do {
                let serverFavorites = try await api.getWishlist()
                favoriteProductIds = Set(serverFavorites)
                UserDefaults.standard.set(serverFavorites, forKey: "favorite_product_ids")
            } catch {
                // If sync fails, fall back to local storage
                let localFavorites = UserDefaults.standard.stringArray(forKey: "favorite_product_ids") ?? []
                favoriteProductIds = Set(localFavorites)
            }
        } else {
            // Guests use local storage only
            let localFavorites = UserDefaults.standard.stringArray(forKey: "favorite_product_ids") ?? []
            favoriteProductIds = Set(localFavorites)
        }
    }

    /// Load mobile configuration from server (API version, minimum app version, features, etc.)
    func loadMobileConfig() async {
        do {
            let config = try await api.getMobileConfig()
            mobileConfig = config
            checkForceUpdate(minVersion: config.minAppVersion)
        } catch {
            // Mobile config is optional — app can run without it
            // but loss of this data means no version enforcement
        }
    }

    /// Request user permission for push notifications
    func requestNotificationPermission() async {
        let center = UNUserNotificationCenter.current()

        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            if granted {
                await MainActor.run {
                    notificationsEnabled = true
                    notificationPermissionDenied = false
                    message = "تم تفعيل الإشعارات"
                }
                // Request device token after permission granted
                await DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            } else {
                await MainActor.run {
                    notificationsEnabled = false
                    notificationPermissionDenied = true
                    message = "تم رفض الإشعارات"
                }
            }
        } catch {
            await MainActor.run {
                notificationPermissionDenied = true
                show(error)
            }
        }
    }

    /// Register device token with server (called from AppDelegate when token is received)
    func registerDeviceToken(_ token: Data) async {
        let deviceToken = token.map { String(format: "%02.2hhx", $0) }.joined()

        // Save locally
        UserDefaults.standard.set(deviceToken, forKey: apnsTokenKey)

        // Register with server if authenticated
        if isAuthenticated {
            do {
                _ = try await api.registerAPNsToken(deviceToken: deviceToken)
                message = "تم تسجيل الإشعارات"
            } catch {
                // Token registration failure is not critical
                logError("Failed to register APNs token", error)
            }
        }
    }

    /// Unregister device token (called when user logs out)
    func unregisterDeviceToken() async {
        guard let token = UserDefaults.standard.string(forKey: apnsTokenKey) else { return }

        do {
            _ = try await api.unregisterAPNsToken(deviceToken: token)
            UserDefaults.standard.removeObject(forKey: apnsTokenKey)
        } catch {
            // Unregister failure is not critical
            logError("Failed to unregister APNs token", error)
        }
    }

    private func logError(_ message: String, _ error: Error) {
        print("[\(Self.self)] \(message): \(error)")
    }

    /// Check if the current app version meets the minimum required version
    private func checkForceUpdate(minVersion: String) {
        let currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        forceUpdateRequired = isVersionLessThan(currentVersion, minVersion)
    }

    /// Compare semantic versions: returns true if version1 < version2
    private func isVersionLessThan(_ version1: String, _ version2: String) -> Bool {
        let v1 = version1.split(separator: ".").compactMap { Int($0) }
        let v2 = version2.split(separator: ".").compactMap { Int($0) }

        let maxLength = max(v1.count, v2.count)
        for i in 0..<maxLength {
            let comp1 = i < v1.count ? v1[i] : 0
            let comp2 = i < v2.count ? v2[i] : 0
            if comp1 < comp2 { return true }
            if comp1 > comp2 { return false }
        }
        return false
    }

    func bootstrap() async {
        guard categories.isEmpty && products.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }

        // Load mobile config first (needed for feature flags)
        await loadMobileConfig()

        // Check for force-update requirement
        if forceUpdateRequired {
            // App is outdated, don't proceed with other data
            return
        }

        async let homeLayoutTask = loadHomeLayout()
        async let offersTask = loadOffers()
        async let categoriesTask = loadCategories()
        async let featuredTask = loadFeaturedProducts()
        async let productsTask = loadProducts(resetCategory: false)
        async let userTask = loadCurrentUser()
        async let vendorsTask = loadVendors()
        async let favoritesTask = loadFavorites()
        _ = await (homeLayoutTask, offersTask, categoriesTask, featuredTask, productsTask, userTask, vendorsTask, favoritesTask)
        await loadCart()
    }


    /// Loads the sections configured in admin/home-design. On failure the
    /// previous sections are kept so a flaky network doesn't blank the home.
    func loadHomeLayout() async {
        do {
            if let layout = try await api.getHomeLayout() {
                homeSections = layout.sections.filter { $0.visible }
            }
        } catch {
            // Optional surface: HomeView falls back to the built-in layout.
        }
    }

    func loadOffers() async {
        do {
            offers = try await api.getOffers()
        } catch {
            // Offers are optional on the home surface.
        }
    }

    func loadCategories() async {
        do {
            categories = try await api.getCategories()
        } catch {
            show(error)
        }
    }

    func loadFeaturedProducts() async {
        do {
            featuredProducts = try await api.getProducts(featured: true, limit: 20).data
        } catch {
            show(error)
        }
    }

    func loadProducts(resetCategory: Bool = false) async {
        if resetCategory { selectedCategorySlug = nil }
        do {
            products = try await api.getProducts(category: selectedCategorySlug, search: searchText.nilIfBlank, limit: 50).data
        } catch {
            show(error)
        }
    }

    func selectCategory(_ category: Category?) async {
        selectedCategorySlug = category?.slug
        await loadProducts()
    }

    func addToCart(_ product: Product, quantity: Int = 1) async {
        guard let productId = product.id.nilIfBlank else { return }
        let normalizedQuantity = max(quantity, 1)

        guard hasServerAuthSession else {
            addLocalCartItem(product, quantity: normalizedQuantity)
            message = "تمت إضافة المنتج للسلة"
            return
        }

        do {
            _ = try await api.addToCart(productId: productId, vendorId: product.vendorId, quantity: normalizedQuantity)
            await loadCart()
            message = "تمت إضافة المنتج للسلة"
        } catch {
            show(error)
        }
    }

    func loadCart() async {
        guard hasServerAuthSession else {
            cartItems = loadLocalCartItems()
            return
        }

        do {
            let cart = try await api.getCart()
            cartItems = cart.items
        } catch {
            if case APIError.status(400, _) = error {
                cartItems = []
            } else {
                show(error)
            }
        }
    }

    func updateCartItem(_ item: CartItem, quantity: Int) async {
        guard hasServerAuthSession else {
            updateLocalCartItem(item, quantity: quantity)
            return
        }

        do {
            _ = try await api.updateCartItem(productId: item.productId, quantity: quantity)
            await loadCart()
        } catch {
            show(error)
        }
    }

    func clearCart() async {
        guard hasServerAuthSession else {
            cartItems = []
            persistLocalCartItems([])
            appliedCoupon = nil
            loyaltyPreview = nil
            loyaltyPointsToRedeem = nil
            return
        }

        do {
            _ = try await api.clearCart()
            cartItems = []
            appliedCoupon = nil
            loyaltyPreview = nil
            loyaltyPointsToRedeem = nil
        } catch {
            show(error)
        }
    }

    func loadCoupons() async {
        do {
            availableCoupons = try await api.getCoupons()
        } catch {
            // Coupons can still be entered manually if the public list fails.
        }
    }

    func applyCoupon(code: String) async {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            let vendorId = cartItems.compactMap(\.vendorId).first
            let response = try await api.validateCoupon(code: trimmed, subtotal: cartSubtotal, vendorId: vendorId)
            if response.success, let coupon = response.coupon {
                appliedCoupon = coupon
                message = "تم تطبيق القسيمة"
            } else {
                appliedCoupon = nil
                message = response.error ?? "كود الخصم غير صالح"
            }
        } catch {
            show(error)
        }
    }

    func removeCoupon() {
        appliedCoupon = nil
        message = "تمت إزالة القسيمة"
    }

    func loadLoyalty() async {
        guard hasServerAuthSession else {
            loyaltySummary = nil
            return
        }
        do {
            loyaltySummary = try await api.getLoyalty()
        } catch {
            show(error)
        }
    }

    func previewLoyaltyRedemption(maxPoints: Int? = nil) async {
        guard hasServerAuthSession else {
            message = "سجل دخولك لاستخدام نقاط الولاء"
            return
        }
        do {
            let preview = try await api.previewLoyaltyRedemption(subtotal: cartSubtotal, maxPoints: maxPoints)
            loyaltyPreview = preview
            loyaltyPointsToRedeem = preview.redeemablePoints
            message = "سيتم استخدام \(preview.redeemablePoints) نقطة"
        } catch {
            show(error)
        }
    }

    func clearLoyaltyRedemption() {
        loyaltyPreview = nil
        loyaltyPointsToRedeem = nil
    }

    func loadDeliverySlots(date: Date, zoneId: String?) async {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Riyadh")
        formatter.dateFormat = "yyyy-MM-dd"

        do {
            guard let zoneId else {
                deliverySlots = nil
                selectedDeliverySlot = nil
                return
            }
            let response = try await api.getDeliverySlots(date: formatter.string(from: date), zoneId: zoneId)
            deliverySlots = response
            let availableSlots = response.enabled ? response.windows.filter(\.available) : []
            if let selectedDeliverySlot,
               availableSlots.contains(where: { $0.id == selectedDeliverySlot.id }) {
                return
            }
            selectedDeliverySlot = availableSlots.first
        } catch {
            deliverySlots = nil
            selectedDeliverySlot = nil
            show(error)
        }
    }

    func clearDeliverySlot() {
        deliverySlots = nil
        selectedDeliverySlot = nil
    }

    @discardableResult
    func loadDeliveryQuote(for address: Address? = nil) async -> DeliveryQuoteResponse? {
        let deliveryAddress = address ?? selectedAddress
        guard let deliveryAddress,
              deliveryAddress.hasValidDeliveryCoordinates,
              let lat = deliveryAddress.lat,
              let lng = deliveryAddress.lng else {
            deliveryQuote = nil
            return nil
        }

        do {
            let quote = try await api.getDeliveryQuote(latitude: lat, longitude: lng, subtotal: cartSubtotal)
            deliveryQuote = quote
            if !quote.inDeliveryArea {
                message = quote.error ?? "عذراً، لا نوصل إلى هذا الموقع حالياً"
            }
            return quote
        } catch {
            deliveryQuote = nil
            show(error)
            return nil
        }
    }

    func refreshSelectedAddressDetails() async {
        guard let selectedAddress, let lat = selectedAddress.lat, let lng = selectedAddress.lng else { return }
        do {
            let resolved = try await api.reverseGeocode(latitude: lat, longitude: lng)
            deliveryLocationTitle = resolved.shortTitle
            UserDefaults.standard.set(deliveryLocationTitle, forKey: "delivery_location_title")
        } catch {
            // Local reverse geocoding fallback remains acceptable if Nominatim is unavailable.
        }
    }

    func sendOTP(phone: String) async -> Bool {
        do {
            _ = try await api.sendOTP(phone: phone)
            message = "تم إرسال رمز التحقق"
            return true
        } catch {
            show(error)
            return false
        }
    }

    func verifyOTP(phone: String, code: String) async {
        do {
            let verifiedUser = try await api.verifyOTP(phone: phone, code: code)
            if let authenticatedPhone = phone.nilIfBlank {
                UserDefaults.standard.set(authenticatedPhone, forKey: authenticatedPhoneKey)
            }
            user = applyLocalProfileOverrides(to: verifiedUser)
            cacheCurrentUser()
            guard hasServerAuthSession else {
                await loadCart()
                message = "تم تسجيل الدخول"
                return
            }

            await syncLocalAddressesToAccount()
            await syncLocalCartToAccount()
            await loadCart()
            await loadOrders()
            await loadAddresses()
            message = "تم تسجيل الدخول"
        } catch {
            show(error)
        }
    }

    func loadCurrentUser() async {
        guard api.hasAuthToken else { return }
        do {
            if let currentUser = try await api.currentUser() {
                user = applyLocalProfileOverrides(to: currentUser)
                cacheCurrentUser()
            } else {
                api.clearAuth()
                user = nil
                Self.clearCachedUser()
            }
        } catch {
            if case APIError.status(let code, _) = error, code == 401 || code == 403 {
                api.clearAuth()
                user = nil
                Self.clearCachedUser()
            }
        }
    }

    @discardableResult
    func prepareCheckoutIdentity() async -> Bool {
        if api.hasAuthToken {
            await loadCurrentUser()
        }

        guard isAuthenticated else {
            message = "سجل دخولك قبل إتمام الطلب"
            return false
        }

        guard !needsCheckoutProfileDetails else {
            message = "أكمل رقم الجوال في حسابك قبل الدفع"
            return false
        }

        return true
    }

    func updateProfile(name: String, email: String) {
        guard let current = user else { return }
        let cleanedName = name.nilIfBlank
        let cleanedEmail = email.nilIfBlank
        UserDefaults.standard.set(cleanedName, forKey: profileNameKey)
        UserDefaults.standard.set(cleanedEmail, forKey: profileEmailKey)
        user = User(
            id: current.id,
            phone: current.phone,
            name: cleanedName,
            email: cleanedEmail,
            avatarUrl: current.avatarUrl,
            loyaltyPoints: current.loyaltyPoints,
            loyaltyTier: current.loyaltyTier
        )
        cacheCurrentUser()
        message = "تم تحديث بيانات الحساب"
    }

    func logout() async {
        do {
            _ = try await api.logout()
        } catch {
            // Local logout still proceeds if the server session is already gone.
        }
        clearAuthenticatedState()
        await loadCart()
    }

    func deleteAccount() async -> Bool {
        do {
            let response = try await api.deleteAccount()
            clearAuthenticatedState()
            favoriteProductIds = []
            favoriteProductCache = []
            UserDefaults.standard.removeObject(forKey: "favorite_product_ids")
            loyaltySummary = nil
            loyaltyPreview = nil
            loyaltyPointsToRedeem = nil
            message = response.message ?? "تم حذف حسابك"
            await loadCart()
            return true
        } catch {
            show(error)
            return false
        }
    }

    func loadOrders() async {
        guard hasServerAuthSession else {
            orders = []
            return
        }
        do {
            orders = try await api.getOrders()
        } catch {
            show(error)
        }
    }

    func updateDeliveryLocation(city: String, district: String, street: String) {
        let parts = [district.nilIfBlank, street.nilIfBlank, city.nilIfBlank].compactMap { $0 }
        deliveryLocationTitle = parts.isEmpty ? "تحديد الموقع" : parts.joined(separator: "، ")
        UserDefaults.standard.set(deliveryLocationTitle, forKey: "delivery_location_title")
        message = "تم حفظ موقع التوصيل"
    }

    func saveAutomaticLocation(coordinate: CLLocationCoordinate2D, address: ResolvedLocationAddress) async {
        guard coordinate.isValidDeliveryCoordinate else {
            message = "تعذر تحديد موقع صالح. اختر العنوان من الخريطة يدوياً"
            return
        }

        let title = address.shortTitle.nilIfBlank ?? "موقعي الحالي"
        let details = address.fullAddress.nilIfBlank ?? String(format: "%.5f، %.5f", coordinate.longitude, coordinate.latitude)

        if user != nil {
            // Skip if the user already has a "home" address saved — don't override it.
            let hasHomeAddress = savedAddresses.contains { $0.label == "home" || $0.label == "المنزل" }
            guard !hasHomeAddress else { return }
            _ = await saveAddress(
                label: "home",
                title: title,
                lat: coordinate.latitude,
                lng: coordinate.longitude,
                notes: nil,
                addressText: details
            )
            return
        }

        let id = UserDefaults.standard.string(forKey: automaticAddressIdKey) ?? "current-location"
        UserDefaults.standard.set(id, forKey: automaticAddressIdKey)

        let automaticAddress = Address(
            id: id,
            label: "home",
            title: title,
            lat: coordinate.latitude,
            lng: coordinate.longitude,
            notes: nil,
            addressText: details,
            placeImages: [],
            isDefault: savedAddresses.isEmpty,
            zoneId: nil
        )

        upsertAddress(automaticAddress)
        persistLocalAddresses()
        selectAddress(automaticAddress)
    }

    func sendChefMessage(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard canUseAuthenticatedFeatures else {
            message = "سجل دخولك لاستخدام شيف سيتي"
            return
        }
        guard chefOpenAIConsentGranted else {
            message = "يلزم الموافقة على مشاركة البيانات مع OpenAI قبل استخدام شيف سيتي"
            return
        }

        let userMessage = ChefChatMessage(role: .user, content: trimmed, matches: [], suggestions: [])
        chefMessages.append(userMessage)
        do {
            let response = try await api.sendChefMessage(trimmed, history: chefMessages, sensitiveValues: chefSensitiveValues)
            if let error = response.error, response.success == false {
                message = error
                return
            }
            chefMessages.append(
                ChefChatMessage(
                    role: .assistant,
                    content: response.reply ?? "تم البحث في المتجر.",
                    matches: response.matched ?? [],
                    suggestions: response.mealSuggestions ?? []
                )
            )
        } catch {
            show(error)
        }
    }

    func grantChefOpenAIConsent() {
        chefOpenAIConsentGranted = true
        UserDefaults.standard.set(true, forKey: "chef_openai_data_sharing_consent")
    }

    func revokeChefOpenAIConsent() {
        chefOpenAIConsentGranted = false
        UserDefaults.standard.set(false, forKey: "chef_openai_data_sharing_consent")
        message = "تم إلغاء موافقة مشاركة بيانات شيف سيتي مع OpenAI"
    }

    private var chefSensitiveValues: [String] {
        var values = [
            user?.id,
            user?.name,
            user?.phone,
            user?.email,
            selectedAddress?.title,
            selectedAddress?.addressText,
            selectedAddress?.notes
        ]

        if let lat = selectedAddress?.lat, let lng = selectedAddress?.lng {
            values.append(String(lat))
            values.append(String(lng))
            values.append(String(format: "%.5f", lat))
            values.append(String(format: "%.5f", lng))
        }

        return values.compactMap { $0?.nilIfBlank }
    }

    @discardableResult
    func createCheckout(
        name: String,
        phone: String,
        notes: String,
        paymentMethod: String,
        moyasarMethod: String? = nil,
        scheduled: Bool = false,
        scheduledFor: String? = nil,
        slotId: String? = nil,
        slotWindow: String? = nil,
        deliveryZoneId: String? = nil,
        scheduledAt: String? = nil,
        reloadCartAfterCreate: Bool = true
    ) async -> CheckoutResponse? {
        guard !cartItems.isEmpty else { return nil }
        guard let deliveryAddress = selectedAddress else {
            message = "اختر عنوان التوصيل قبل إتمام الطلب"
            return nil
        }
        guard deliveryAddress.hasValidDeliveryCoordinates else {
            message = "إحداثيات عنوان التوصيل غير صالحة. اختر موقعك من الخريطة مرة أخرى"
            return nil
        }
        guard isAuthenticated, let currentUser = user else {
            message = "سجل دخولك قبل إتمام الطلب"
            return nil
        }
        guard currentUser.phone.nilIfBlank != nil else {
            message = "أكمل رقم الجوال في حسابك قبل الدفع"
            return nil
        }
        do {
            let checkoutAddress = try await preparedCheckoutAddress(deliveryAddress)
            let checkoutName = currentUser.name?.nilIfBlank ?? "مستخدم"
            let checkoutPhone = currentUser.phone.nilIfBlank
            let response = try await api.checkout(
                items: cartItems.map { CheckoutItem(productId: $0.productId, quantity: $0.quantity) },
                name: checkoutName,
                phone: checkoutPhone,
                notes: notes.nilIfBlank,
                paymentMethod: paymentMethod,
                moyasarMethod: moyasarMethod,
                scheduled: scheduled,
                scheduledFor: scheduledFor,
                slotId: slotId,
                slotWindow: slotWindow,
                deliveryZoneId: deliveryZoneId,
                scheduledAt: scheduledAt,
                address: checkoutAddress,
                couponCode: appliedCoupon?.code,
                pointsRedeemed: loyaltyPointsToRedeem
            )
            message = response.message ?? "تم إنشاء الطلب"
            if reloadCartAfterCreate {
                await loadCart()
            }
            await loadOrders()
            return response
        } catch {
            show(error)
            return nil
        }
    }

    private func preparedCheckoutAddress(_ address: Address) async throws -> Address {
        guard hasServerAuthSession, loadLocalAddresses().contains(where: { $0.id == address.id }) else {
            return address
        }

        guard let lat = address.lat,
              let lng = address.lng else {
            return address
        }
        let title = address.title?.nilIfBlank ?? address.typeName

        let remoteAddress = try await api.createAddress(
            label: address.label,
            title: title,
            lat: lat,
            lng: lng,
            notes: address.notes,
            addressText: address.addressText,
            placeImages: address.placeImages
        )
        let addressWithZone = Address(
            id: remoteAddress.id,
            label: remoteAddress.label,
            title: remoteAddress.title,
            lat: remoteAddress.lat ?? address.lat,
            lng: remoteAddress.lng ?? address.lng,
            notes: remoteAddress.notes ?? address.notes,
            addressText: remoteAddress.addressText ?? address.addressText,
            placeImages: remoteAddress.placeImages.isEmpty ? address.placeImages : remoteAddress.placeImages,
            isDefault: remoteAddress.isDefault ?? address.isDefault,
            zoneId: remoteAddress.zoneId ?? address.zoneId
        )

        savedAddresses.removeAll { $0.id == address.id }
        upsertAddress(addressWithZone)
        persistLocalAddresses(loadLocalAddresses().filter { $0.id != address.id })
        selectAddress(addressWithZone)
        return addressWithZone
    }

    func createCashCheckout(name: String, phone: String, notes: String, scheduled: Bool = false, scheduledFor: String? = nil, slotId: String? = nil, slotWindow: String? = nil, deliveryZoneId: String? = nil, scheduledAt: String? = nil) async {
        await createCheckout(name: name, phone: phone, notes: notes, paymentMethod: "cash", scheduled: scheduled, scheduledFor: scheduledFor, slotId: slotId, slotWindow: slotWindow, deliveryZoneId: deliveryZoneId, scheduledAt: scheduledAt)
    }

    func loadVendors() async {
        do {
            vendors = try await api.getVendors()
        } catch {
            // Vendors are optional - silently ignore errors
        }
    }

    func vendor(slug: String) async -> Vendor? {
        if let cached = vendors.first(where: { $0.slug == slug }) { return cached }
        do {
            let vendor = try await api.getVendor(slug: slug)
            if !vendors.contains(where: { $0.id == vendor.id }) {
                vendors.append(vendor)
            }
            return vendor
        } catch {
            show(error)
            return nil
        }
    }

    func vendorProducts(slug: String) async -> [Product] {
        do {
            return try await api.getProducts(vendor: slug, limit: 100).data
        } catch {
            show(error)
            return []
        }
    }

    func loadAddresses() async {
        let localAddresses = loadLocalAddresses().filter(\.hasValidDeliveryCoordinates)
        do {
            let remoteAddresses = try await api.getAddresses()
            savedAddresses = mergedAddresses(primary: localAddresses, secondary: remoteAddresses.filter(\.hasValidDeliveryCoordinates))
            reconcileSelectedAddress()
            return
        } catch {
            // The checkout flow can use locally selected coordinates without remote address storage.
        }

        savedAddresses = localAddresses
        reconcileSelectedAddress()
    }

    func saveAddress(label: String, title: String, lat: Double, lng: Double, notes: String?, addressText: String? = nil, placeImages: [String] = []) async -> Bool {
        let address = Address(id: UUID().uuidString, label: label, title: title, lat: lat, lng: lng, notes: notes, addressText: addressText, placeImages: placeImages, isDefault: savedAddresses.isEmpty)

        guard let quote = await loadDeliveryQuote(for: address), quote.inDeliveryArea else {
            return false
        }

        let addressWithZone = Address(
            id: address.id,
            label: address.label,
            title: address.title,
            lat: address.lat,
            lng: address.lng,
            notes: address.notes,
            addressText: address.addressText,
            placeImages: address.placeImages,
            isDefault: address.isDefault,
            zoneId: quote.zoneId
        )

        upsertAddress(addressWithZone)
        var localAddresses = loadLocalAddresses()
        if let index = localAddresses.firstIndex(where: { $0.id == addressWithZone.id }) {
            localAddresses[index] = addressWithZone
        } else {
            localAddresses.append(addressWithZone)
        }
        persistLocalAddresses(localAddresses)
        selectAddress(addressWithZone)
        return true
    }

    func uploadPlaceImages(_ images: [Data]) async -> [String] {
        do {
            return try await api.uploadPlaceImages(images)
        } catch {
            return []
        }
    }

    func updateAddress(_ address: Address, label: String, title: String, lat: Double, lng: Double, notes: String?, addressText: String? = nil, placeImages: [String] = []) async -> Bool {
        let updatedAddress = Address(
            id: address.id,
            label: label,
            title: title,
            lat: lat,
            lng: lng,
            notes: notes,
            addressText: addressText,
            placeImages: placeImages,
            isDefault: address.isDefault,
            zoneId: address.zoneId
        )

        guard let quote = await loadDeliveryQuote(for: updatedAddress), quote.inDeliveryArea else {
            return false
        }

        let updatedAddressWithZone = Address(
            id: updatedAddress.id,
            label: updatedAddress.label,
            title: updatedAddress.title,
            lat: updatedAddress.lat,
            lng: updatedAddress.lng,
            notes: updatedAddress.notes,
            addressText: updatedAddress.addressText,
            placeImages: updatedAddress.placeImages,
            isDefault: updatedAddress.isDefault,
            zoneId: quote.zoneId ?? updatedAddress.zoneId
        )

        let localAddresses = loadLocalAddresses()
        if localAddresses.contains(where: { $0.id == address.id }) || user == nil {
            upsertAddress(updatedAddressWithZone)
            if localAddresses.contains(where: { $0.id == address.id }) {
                persistLocalAddresses(localAddresses.map { $0.id == address.id ? updatedAddressWithZone : $0 })
            } else {
                persistLocalAddresses()
            }
            selectAddress(updatedAddressWithZone)
            return true
        }

        do {
            let remoteAddress = try await api.updateAddress(
                id: address.id,
                label: label,
                title: title,
                lat: lat,
                lng: lng,
                notes: notes,
                addressText: addressText,
                placeImages: placeImages
            )
            upsertAddress(remoteAddress)
            selectAddress(remoteAddress)
            return true
        } catch {
            show(error)
            return false
        }
    }

    func deleteAddress(_ address: Address) async {
        let localAddresses = loadLocalAddresses()
        if localAddresses.contains(where: { $0.id == address.id }) {
            savedAddresses.removeAll { $0.id == address.id }
            persistLocalAddresses(localAddresses.filter { $0.id != address.id })
            reconcileSelectedAddress(deletedAddressId: address.id)
            return
        }

        if user != nil {
            do {
                _ = try await api.deleteAddress(id: address.id)
                await loadAddresses()
            } catch {
                show(error)
            }
        } else {
            savedAddresses.removeAll { $0.id == address.id }
            persistLocalAddresses()
            reconcileSelectedAddress(deletedAddressId: address.id)
        }
    }

    func selectAddress(_ address: Address) {
        selectedAddressId = address.id
        deliveryLocationTitle = address.typeName
        deliveryQuote = nil
        UserDefaults.standard.set(selectedAddressId, forKey: "selected_address_id")
        UserDefaults.standard.set(deliveryLocationTitle, forKey: "delivery_location_title")
    }

    private func syncLocalAddressesToAccount() async {
        // Keep delivery locations local; checkout sends the selected coordinates directly.
    }

    private func addLocalCartItem(_ product: Product, quantity: Int) {
        var localItems = loadLocalCartItems()
        if let index = localItems.firstIndex(where: { $0.productId == product.id }) {
            let existing = localItems[index]
            localItems[index] = CartItem(
                id: existing.id,
                productId: existing.productId,
                nameAr: existing.nameAr,
                price: existing.price,
                discountPrice: existing.discountPrice,
                imageUrl: existing.imageUrl,
                stockQty: existing.stockQty,
                quantity: existing.quantity + quantity,
                vendorId: existing.vendorId,
                vendorName: existing.vendorName,
                vendorSlug: existing.vendorSlug,
                effectivePrice: existing.effectivePrice
            )
        } else {
            localItems.append(CartItem(product: product, quantity: quantity))
        }
        cartItems = localItems
        persistLocalCartItems(localItems)
    }

    private func updateLocalCartItem(_ item: CartItem, quantity: Int) {
        var localItems = loadLocalCartItems()
        if quantity <= 0 {
            localItems.removeAll { $0.productId == item.productId }
        } else if let index = localItems.firstIndex(where: { $0.productId == item.productId }) {
            localItems[index] = CartItem(
                id: item.id,
                productId: item.productId,
                nameAr: item.nameAr,
                price: item.price,
                discountPrice: item.discountPrice,
                imageUrl: item.imageUrl,
                stockQty: item.stockQty,
                quantity: quantity,
                vendorId: item.vendorId,
                vendorName: item.vendorName,
                vendorSlug: item.vendorSlug,
                effectivePrice: item.effectivePrice
            )
        }
        cartItems = localItems
        persistLocalCartItems(localItems)
    }

    private func loadLocalCartItems() -> [CartItem] {
        guard let data = UserDefaults.standard.data(forKey: localCartKey),
              let items = try? JSONDecoder().decode([CartItem].self, from: data) else {
            return []
        }
        return items
    }

    private func persistLocalCartItems(_ items: [CartItem]) {
        if let data = try? JSONEncoder().encode(items) {
            UserDefaults.standard.set(data, forKey: localCartKey)
        }
    }

    private func clearLocalCartItems() {
        UserDefaults.standard.removeObject(forKey: localCartKey)
    }

    private func syncLocalCartToAccount() async {
        let localItems = loadLocalCartItems()
        guard !localItems.isEmpty, hasServerAuthSession else { return }

        for item in localItems {
            do {
                _ = try await api.addToCart(productId: item.productId, vendorId: item.vendorId, quantity: max(item.quantity, 1))
            } catch {
                show(error)
                return
            }
        }
        clearLocalCartItems()
    }

    private func reconcileSelectedAddress(deletedAddressId: String? = nil) {
        if selectedAddressId == deletedAddressId {
            selectedAddressId = nil
            UserDefaults.standard.removeObject(forKey: "selected_address_id")
        }

        savedAddresses = savedAddresses.filter(\.hasValidDeliveryCoordinates)
        persistLocalAddresses(loadLocalAddresses().filter(\.hasValidDeliveryCoordinates))

        if let selectedAddressId,
           let selected = savedAddresses.first(where: { $0.id == selectedAddressId && $0.hasValidDeliveryCoordinates }) {
            selectAddress(selected)
            return
        }

        if let fallback = savedAddresses.first(where: { $0.isDefault == true && $0.hasValidDeliveryCoordinates })
            ?? savedAddresses.first(where: \.hasValidDeliveryCoordinates) {
            selectAddress(fallback)
        } else {
            selectedAddressId = nil
            deliveryLocationTitle = "تحديد الموقع"
            UserDefaults.standard.removeObject(forKey: "selected_address_id")
            UserDefaults.standard.set(deliveryLocationTitle, forKey: "delivery_location_title")
        }
    }

    private func loadLocalAddresses() -> [Address] {
        guard let data = UserDefaults.standard.data(forKey: "local_addresses"),
              let local = try? JSONDecoder().decode([Address].self, from: data) else {
            return []
        }
        return local
    }

    private func upsertAddress(_ address: Address) {
        if let index = savedAddresses.firstIndex(where: { $0.id == address.id }) {
            savedAddresses[index] = address
        } else {
            savedAddresses.append(address)
        }
    }

    private func mergedAddresses(primary: [Address], secondary: [Address]) -> [Address] {
        var merged = primary
        for address in secondary where !merged.contains(where: { $0.id == address.id }) {
            merged.append(address)
        }
        return merged
    }

    private func persistLocalAddresses(_ addresses: [Address]? = nil) {
        if let data = try? JSONEncoder().encode(addresses ?? savedAddresses) {
            UserDefaults.standard.set(data, forKey: "local_addresses")
        }
    }

    private func applyLocalProfileOverrides(to user: User?) -> User? {
        guard let user else { return nil }
        let name = UserDefaults.standard.string(forKey: profileNameKey)?.nilIfBlank ?? user.name
        let email = UserDefaults.standard.string(forKey: profileEmailKey)?.nilIfBlank ?? user.email
        let phone = user.phone.nilIfBlank ?? UserDefaults.standard.string(forKey: authenticatedPhoneKey)?.nilIfBlank ?? user.phone
        return User(
            id: user.id,
            phone: phone,
            name: name,
            email: email,
            avatarUrl: user.avatarUrl,
            loyaltyPoints: user.loyaltyPoints,
            loyaltyTier: user.loyaltyTier
        )
    }

    func categoryProducts(slug: String) async -> [Product] {
        do {
            return try await api.getProducts(category: slug, limit: 100).data
        } catch {
            show(error)
            return []
        }
    }

    func productDetail(id: String) async -> ProductDetailResponse? {
        do {
            return try await api.getProduct(id: id)
        } catch {
            show(error)
            return nil
        }
    }

    func productReviews(productId: String) async -> [Review] {
        do {
            return try await api.getReviews(productId: productId)
        } catch {
            show(error)
            return []
        }
    }

    func createReview(orderId: String, storeRating: Int, driverRating: Int?, comment: String) async -> Bool {
        do {
            _ = try await api.createReview(orderId: orderId, storeRating: storeRating, driverRating: driverRating, comment: comment.nilIfBlank)
            message = "تم إرسال التقييم"
            return true
        } catch {
            show(error)
            return false
        }
    }

    func trackGuestOrder(code: String, phone: String) async {
        do {
            trackedGuestOrder = try await api.trackGuestOrder(code: code, phone: phone)
        } catch {
            show(error)
        }
    }

    func startOrderEventStream() {
        guard hasServerAuthSession, orderEventsTask == nil else { return }
        orderEventsTask = Task { [weak self, api] in
            do {
                try await api.streamOrderEvents { event in
                    Task { @MainActor [weak self] in
                        self?.liveOrderEvent = event
                        await self?.loadOrders()
                        _ = try? await api.acknowledgeEvent(id: event.id)
                    }
                }
            } catch {
                await MainActor.run { [weak self] in
                    self?.orderEventsTask = nil
                }
            }
        }
    }

    func stopOrderEventStream() {
        orderEventsTask?.cancel()
        orderEventsTask = nil
    }

    func paymentURL(for order: Order) async -> URL? {
        await paymentURL(orderId: order.id)
    }

    func updateOrderPaymentMethod(orderId: String, paymentMethod: String, idempotencyKey: String?) async -> Bool {
        guard let idempotencyKey = idempotencyKey?.nilIfBlank else {
            message = "تعذر تحديث طريقة الدفع لهذا الطلب"
            return false
        }

        do {
            _ = try await api.updateOrderPaymentMethod(
                orderId: orderId,
                paymentMethod: paymentMethod,
                moyasarMethod: paymentMethod == "cash" ? nil : paymentMethod,
                idempotencyKey: idempotencyKey
            )
            message = "تم تحديث طريقة الدفع"
            await loadOrders()
            return true
        } catch {
            show(error)
            return false
        }
    }

    func paymentURL(orderId: String) async -> URL? {
        do {
            let response = try await api.initiatePayment(orderId: orderId)
            if let paymentUrl = response.paymentUrl {
                return URL(string: paymentUrl)
            }
        } catch {
            do {
                let response = try await api.retryPayment(orderId: orderId)
                if let paymentUrl = response.paymentUrl {
                    return URL(string: paymentUrl)
                }
            } catch {
                show(error)
            }
        }
        return nil
    }

    private func cacheCurrentUser() {
        guard let user, let data = try? JSONEncoder().encode(user) else { return }
        UserDefaults.standard.set(data, forKey: Self.cachedUserKey)
    }

    private static func cachedUser() -> User? {
        guard let data = UserDefaults.standard.data(forKey: cachedUserKey) else { return nil }
        return try? JSONDecoder().decode(User.self, from: data)
    }

    private static func clearCachedUser() {
        UserDefaults.standard.removeObject(forKey: cachedUserKey)
    }

    private func clearAuthenticatedState() {
        api.clearAuth()
        user = nil
        Self.clearCachedUser()
        UserDefaults.standard.removeObject(forKey: authenticatedPhoneKey)
        orders = []
        appliedCoupon = nil
    }

    private func show(_ error: Error) {
        if error is CancellationError { return }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }

        let text = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard text != "cancelled", text != "canceled", text != "ملغى" else { return }
        guard !shouldSuppressUserMessage(text) else { return }
        message = text
    }

    private func shouldSuppressUserMessage(_ text: String) -> Bool {
        let normalized = text.lowercased()
        return normalized.contains("productid")
            || text.contains("بيانات المنتج غير مكتملة")
            || text.contains("انتهت صلاحية جلسة الأمان")
            || text.contains("رمز أمان")
            || text.contains("انتهاك أمان")
            || text.contains("تم تجاوز عدد محاولات")
            || text.contains("طلبات كثيرة")
            || normalized.contains("too many requests")
            || normalized.contains("csrf")
            || normalized.contains("security")
    }
}
