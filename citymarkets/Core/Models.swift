import Foundation

struct APIDataResponse<T: Decodable>: Decodable {
    let success: Bool
    let data: T
}

struct ProductsResponse: Decodable {
    let success: Bool
    let data: [Product]
    let pagination: Pagination?
}

struct ProductDetailResponse: Decodable {
    let success: Bool
    let data: Product
    let related: [Product]?
}

struct Pagination: Decodable {
    let page: Int
    let limit: Int
    let total: Int
    let totalPages: Int
}

struct Product: Decodable, Identifiable {
    let id: String
    let categoryId: String?
    let nameAr: String
    let nameEn: String?
    let sku: String?
    let description: String?
    let imageUrl: String?
    let images: [String]?
    let price: Double
    let discountPrice: Double?
    let stockQty: Int
    let isActive: Bool?
    let trackStock: Bool?
    let vendorId: String?
    let vendorSlug: String?
    let vendorName: String?
    let categoryName: String?
    let categorySlug: String?
    let avgRating: Double?
    let reviewsCount: Int?
    let effectivePrice: Double

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        id = try c.decodeFlexibleString(keys: ["id", "product_id", "productId", "_id", "uuid"]) ?? ""
        categoryId = try c.decodeFlexibleString(keys: ["category_id", "categoryId"])
        nameAr = try c.decodeFlexibleString(keys: ["name_ar", "nameAr", "name", "title"]) ?? "منتج"
        nameEn = try c.decodeFlexibleString(keys: ["name_en", "nameEn"])
        sku = try c.decodeFlexibleString(keys: ["sku"])
        description = try c.decodeFlexibleString(keys: ["description", "desc"])
        imageUrl = try c.decodeFlexibleString(keys: ["image_url", "imageUrl", "image"])
        images = (try? c.decodeIfPresent([String].self, forKey: FlexibleCodingKey("images")))
        price = try c.decodeFlexibleDouble(keys: ["price"]) ?? 0
        discountPrice = try c.decodeFlexibleDouble(keys: ["discount_price", "discountPrice", "sale_price", "salePrice"])
        stockQty = try c.decodeFlexibleInt(keys: ["stock_qty", "stockQty", "stock", "quantity_available"]) ?? 0
        isActive = try c.decodeFlexibleBool(keys: ["is_active", "isActive", "active"])
        trackStock = try c.decodeFlexibleBool(keys: ["track_stock", "trackStock"])
        vendorId = try c.decodeFlexibleString(keys: ["vendor_id", "vendorId", "store_id", "storeId"])
        vendorSlug = try c.decodeFlexibleString(keys: ["vendor_slug", "vendorSlug", "store_slug", "storeSlug"])
        vendorName = try c.decodeFlexibleString(keys: ["vendor_name", "vendorName", "store_name", "storeName"])
        categoryName = try c.decodeFlexibleString(keys: ["category_name", "categoryName"])
        categorySlug = try c.decodeFlexibleString(keys: ["category_slug", "categorySlug"])
        avgRating = try c.decodeFlexibleDouble(keys: ["avg_rating", "avgRating", "rating"])
        reviewsCount = try c.decodeFlexibleInt(keys: ["reviews_count", "reviewsCount"])
        let apiEffective = try c.decodeFlexibleDouble(keys: ["effective_price", "effectivePrice"])
        effectivePrice = apiEffective ?? discountPrice ?? price
    }

    var absoluteImageURL: URL? { (imageUrl ?? images?.first).absoluteCityURL }
}

struct Category: Decodable, Identifiable, Equatable {
    let id: String
    let nameAr: String
    let nameEn: String?
    let slug: String
    let parentId: String?
    let sortOrder: Int?
    let productCount: Int?
    let descendantCount: Int?
    let childCount: Int?
    let iconUrl: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        id = try c.decodeFlexibleString(keys: ["id", "category_id", "categoryId", "uuid"]) ?? UUID().uuidString
        nameAr = try c.decodeFlexibleString(keys: ["name_ar", "nameAr", "name", "title"]) ?? "تصنيف"
        nameEn = try c.decodeFlexibleString(keys: ["name_en", "nameEn"])
        slug = try c.decodeFlexibleString(keys: ["slug"]) ?? id
        parentId = try c.decodeFlexibleString(keys: ["parent_id", "parentId"])
        sortOrder = try c.decodeFlexibleInt(keys: ["sort_order", "sortOrder"])
        productCount = try c.decodeFlexibleInt(keys: ["product_count", "productCount"])
        descendantCount = try c.decodeFlexibleInt(keys: ["descendant_count", "descendantCount"])
        childCount = try c.decodeFlexibleInt(keys: ["child_count", "childCount"])
        iconUrl = try c.decodeFlexibleString(keys: ["icon_url", "iconUrl", "image_url", "imageUrl", "image"])
    }

    var absoluteIconURL: URL? { iconUrl.absoluteCityURL }
}

struct Vendor: Decodable, Identifiable {
    let id: String
    let slug: String
    let name: String
    let nameEn: String?
    let description: String?
    let logo: String?
    let banner: String?
    let type: String
    let primaryColor: String
    let isOpen: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        id = try c.decodeFlexibleString(keys: ["id", "vendor_id", "vendorId", "uuid"]) ?? UUID().uuidString
        slug = try c.decodeFlexibleString(keys: ["slug", "vendor_slug", "vendorSlug", "store_slug", "storeSlug"]) ?? id
        name = try c.decodeFlexibleString(keys: ["name", "name_ar", "nameAr", "title", "store_name", "storeName"]) ?? "متجر"
        nameEn = try c.decodeFlexibleString(keys: ["name_en", "nameEn", "english_name", "englishName"])
        description = try c.decodeFlexibleString(keys: ["description", "desc", "bio", "about"])
        logo = try c.decodeFlexibleString(keys: ["logo", "logo_url", "logoUrl", "logo_image", "logoImage", "image", "image_url", "imageUrl", "avatar", "icon"])
        banner = try c.decodeFlexibleString(keys: ["banner", "banner_url", "bannerUrl", "banner_image", "bannerImage", "cover", "cover_url", "coverUrl", "cover_image", "coverImage", "background", "background_url", "backgroundUrl", "background_image", "backgroundImage", "header_image", "headerImage"])
        type = try c.decodeFlexibleString(keys: ["type", "category", "vendor_type", "vendorType", "store_type", "storeType"]) ?? "store"
        primaryColor = try c.decodeFlexibleString(keys: ["primary_color", "primaryColor", "color", "brand_color", "brandColor"]) ?? "1B5E20"
        isOpen = try c.decodeFlexibleBool(keys: ["is_open", "isOpen", "open", "active", "is_active", "isActive"]) ?? true
    }

    var absoluteLogoURL: URL? { logo.absoluteCityURL }
    var absoluteBannerURL: URL? { banner.absoluteCityURL }
}

struct VendorsResponse: Decodable {
    let vendors: [Vendor]?
    let data: [Vendor]?
}

struct VendorResponse: Decodable {
    let vendor: Vendor?
    let data: Vendor?
}

struct Address: Codable, Identifiable {
    let id: String
    let label: String
    let title: String?
    let lat: Double?
    let lng: Double?
    let notes: String?
    let addressText: String?
    let placeImages: [String]
    let isDefault: Bool?
    let zoneId: String?

    init(id: String, label: String, title: String?, lat: Double?, lng: Double?, notes: String?, addressText: String? = nil, placeImages: [String] = [], isDefault: Bool?, zoneId: String? = nil) {
        self.id = id
        self.label = label
        self.title = title
        self.lat = lat
        self.lng = lng
        self.notes = notes
        self.addressText = addressText
        self.placeImages = placeImages
        self.isDefault = isDefault
        self.zoneId = zoneId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        id = try c.decodeFlexibleString(keys: ["id", "address_id", "addressId", "uuid"]) ?? UUID().uuidString
        label = try c.decodeFlexibleString(keys: ["label", "type", "address_type", "addressType"]) ?? "other"
        title = try c.decodeFlexibleString(keys: ["title", "name", "address", "address_text", "addressText", "address_line", "addressLine", "full_address", "fullAddress", "delivery_address", "deliveryAddress"])
        lat = try c.decodeFlexibleDouble(keys: ["lat", "latitude"])
        lng = try c.decodeFlexibleDouble(keys: ["lng", "lon", "long", "longitude"])
        notes = try c.decodeFlexibleString(keys: ["notes", "note", "delivery_notes", "deliveryNotes", "description", "instructions"])
        addressText = try c.decodeFlexibleString(keys: ["address_text", "addressText", "formatted_address", "formattedAddress"])
        placeImages = (try? c.decodeIfPresent([String].self, forKey: FlexibleCodingKey("place_images")))
            ?? (try? c.decodeIfPresent([String].self, forKey: FlexibleCodingKey("placeImages")))
            ?? []
        isDefault = try c.decodeFlexibleBool(keys: ["is_default", "isDefault", "default"])
        zoneId = try c.decodeFlexibleString(keys: ["zone_id", "zoneId", "delivery_zone_id", "deliveryZoneId", "zone"])
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: FlexibleCodingKey.self)
        try c.encode(id, forKey: FlexibleCodingKey("id"))
        try c.encode(label, forKey: FlexibleCodingKey("label"))
        try c.encodeIfPresent(title, forKey: FlexibleCodingKey("title"))
        try c.encodeIfPresent(lat, forKey: FlexibleCodingKey("lat"))
        try c.encodeIfPresent(lng, forKey: FlexibleCodingKey("lng"))
        try c.encodeIfPresent(notes, forKey: FlexibleCodingKey("notes"))
        try c.encodeIfPresent(addressText, forKey: FlexibleCodingKey("address_text"))
        try c.encode(placeImages, forKey: FlexibleCodingKey("place_images"))
        try c.encodeIfPresent(isDefault, forKey: FlexibleCodingKey("is_default"))
        try c.encodeIfPresent(zoneId, forKey: FlexibleCodingKey("zone_id"))
    }

    var typeIcon: String {
        switch label {
        case "home", "المنزل": return "🏠"
        case "work", "العمل": return "🏢"
        case "rest", "الاستراحة": return "☕"
        default:     return "📍"
        }
    }

    var typeName: String {
        switch label {
        case "home", "المنزل": return title?.nilIfBlank ?? "المنزل"
        case "work", "العمل": return title?.nilIfBlank ?? "العمل"
        case "rest", "الاستراحة": return title?.nilIfBlank ?? "الاستراحة"
        default:     return title?.nilIfBlank ?? label.nilIfBlank ?? "عنوان"
        }
    }

    var displayDetails: String {
        if let addressText = addressText?.nilIfBlank { return addressText }
        if let notes = notes?.nilIfBlank { return notes }
        return coordinateText
    }

    var coordinateText: String {
        guard let lat, let lng else { return "" }
        return String(format: "%.5f، %.5f", lng, lat)
    }
}

struct AddressListResponse: Decodable {
    let success: Bool?
    let addresses: [Address]?
    let data: [Address]?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        success = try c.decodeFlexibleBool(keys: ["success"])
        addresses = try Self.decodeAddressArray(from: c, keys: ["addresses", "items", "results"])
        data = try Self.decodeAddressArray(from: c, keys: ["data"])
            ?? Self.decodeNestedAddressArray(from: c, key: "data", nestedKeys: ["addresses", "items", "results"])
    }

    private static func decodeAddressArray(
        from container: KeyedDecodingContainer<FlexibleCodingKey>,
        keys: [String]
    ) throws -> [Address]? {
        for key in keys {
            if let addresses = try? container.decodeIfPresent([Address].self, forKey: FlexibleCodingKey(key)) {
                return addresses
            }
        }
        return nil
    }

    private static func decodeNestedAddressArray(
        from container: KeyedDecodingContainer<FlexibleCodingKey>,
        key: String,
        nestedKeys: [String]
    ) throws -> [Address]? {
        guard container.contains(FlexibleCodingKey(key)),
              let nested = try? container.nestedContainer(keyedBy: FlexibleCodingKey.self, forKey: FlexibleCodingKey(key)) else {
            return nil
        }
        return try decodeAddressArray(from: nested, keys: nestedKeys)
    }
}

struct AddressSingleResponse: Decodable {
    let success: Bool?
    let address: Address?
    let data: Address?
    let createdId: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        success = try c.decodeFlexibleBool(keys: ["success"])
        var decodedAddress = Self.decodeTopLevelAddress(from: c)
        if decodedAddress == nil {
            decodedAddress = Self.decodeNestedAddress(from: c, key: "data", nestedKeys: ["address", "item"])
        }
        if decodedAddress == nil {
            decodedAddress = Self.decodeNestedAddress(from: c, key: "result", nestedKeys: ["address", "item", "deliveryAddress", "delivery_address"])
        }
        if decodedAddress == nil {
            decodedAddress = Self.decodeNestedAddressArray(from: c, key: "data", nestedKeys: ["addresses", "items", "results"])?.first
        }
        address = decodedAddress
        data = (try? c.decodeIfPresent(Address.self, forKey: FlexibleCodingKey("data")))
            ?? address
        var decodedId = try c.decodeFlexibleString(keys: ["id", "addressId", "address_id", "deliveryAddressId", "delivery_address_id"])
        if decodedId == nil {
            decodedId = Self.decodeNestedString(from: c, key: "data", nestedKeys: ["id", "addressId", "address_id", "deliveryAddressId", "delivery_address_id"])
        }
        if decodedId == nil {
            decodedId = Self.decodeNestedString(from: c, key: "result", nestedKeys: ["id", "addressId", "address_id", "deliveryAddressId", "delivery_address_id"])
        }
        createdId = decodedId
    }

    private static func decodeTopLevelAddress(from container: KeyedDecodingContainer<FlexibleCodingKey>) -> Address? {
        for key in ["address", "deliveryAddress", "delivery_address", "customerAddress", "customer_address"] {
            if let address = try? container.decodeIfPresent(Address.self, forKey: FlexibleCodingKey(key)) {
                return address
            }
        }
        return nil
    }

    private static func decodeNestedAddress(
        from container: KeyedDecodingContainer<FlexibleCodingKey>,
        key: String,
        nestedKeys: [String]
    ) -> Address? {
        guard container.contains(FlexibleCodingKey(key)),
              let nested = try? container.nestedContainer(keyedBy: FlexibleCodingKey.self, forKey: FlexibleCodingKey(key)) else {
            return nil
        }
        for nestedKey in nestedKeys {
            if let address = try? nested.decodeIfPresent(Address.self, forKey: FlexibleCodingKey(nestedKey)) {
                return address
            }
        }
        return nil
    }

    private static func decodeNestedAddressArray(
        from container: KeyedDecodingContainer<FlexibleCodingKey>,
        key: String,
        nestedKeys: [String]
    ) -> [Address]? {
        guard container.contains(FlexibleCodingKey(key)),
              let nested = try? container.nestedContainer(keyedBy: FlexibleCodingKey.self, forKey: FlexibleCodingKey(key)) else {
            return nil
        }
        for nestedKey in nestedKeys {
            if let addresses = try? nested.decodeIfPresent([Address].self, forKey: FlexibleCodingKey(nestedKey)) {
                return addresses
            }
        }
        return nil
    }

    private static func decodeNestedString(
        from container: KeyedDecodingContainer<FlexibleCodingKey>,
        key: String,
        nestedKeys: [String]
    ) -> String? {
        guard container.contains(FlexibleCodingKey(key)),
              let nested = try? container.nestedContainer(keyedBy: FlexibleCodingKey.self, forKey: FlexibleCodingKey(key)) else {
            return nil
        }
        return try? nested.decodeFlexibleString(keys: nestedKeys)
    }
}

struct CreateAddressRequest: Encodable {
    let label: String
    let title: String
    let lat: Double
    let lng: Double
    let notes: String?
    let addressText: String?
    let placeImages: [String]

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: FlexibleCodingKey.self)
        let resolvedAddressText = addressText?.nilIfBlank ?? notes?.nilIfBlank ?? title.nilIfBlank ?? String(format: "%.5f, %.5f", lat, lng)
        try c.encode(title.nilIfBlank ?? label, forKey: FlexibleCodingKey("label"))
        try c.encode(title, forKey: FlexibleCodingKey("title"))
        try c.encode(resolvedAddressText, forKey: FlexibleCodingKey("address_text"))
        try c.encode(lat, forKey: FlexibleCodingKey("lat"))
        try c.encode(lng, forKey: FlexibleCodingKey("lng"))
        try c.encodeIfPresent(notes, forKey: FlexibleCodingKey("notes"))
        if !placeImages.isEmpty {
            try c.encode(placeImages, forKey: FlexibleCodingKey("place_images"))
        }
    }
}

struct PlaceImagesUploadResponse: Decodable {
    let success: Bool?
    let urls: [String]
    let url: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        success = try c.decodeFlexibleBool(keys: ["success"])
        urls = (try? c.decodeIfPresent([String].self, forKey: FlexibleCodingKey("urls")))
            ?? (try? c.decodeIfPresent([String].self, forKey: FlexibleCodingKey("data")))
            ?? []
        url = try c.decodeFlexibleString(keys: ["url"])
    }

    var uploadedURLs: [String] {
        if !urls.isEmpty { return urls }
        if let url { return [url] }
        return []
    }
}

private struct FlexibleCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init(_ stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

private extension KeyedDecodingContainer where Key == FlexibleCodingKey {
    func decodeFlexibleString(keys: [String]) throws -> String? {
        for key in keys {
            let codingKey = FlexibleCodingKey(key)
            if let value = try decodeIfPresent(String.self, forKey: codingKey), !value.isEmpty { return value }
            if let value = try decodeIfPresent(Int.self, forKey: codingKey) { return String(value) }
            if let value = try decodeIfPresent(Double.self, forKey: codingKey) { return String(value) }
        }
        return nil
    }

    func decodeFlexibleDouble(keys: [String]) throws -> Double? {
        for key in keys {
            let codingKey = FlexibleCodingKey(key)
            if let value = try decodeIfPresent(Double.self, forKey: codingKey) { return value }
            if let value = try decodeIfPresent(Int.self, forKey: codingKey) { return Double(value) }
            if let value = try decodeIfPresent(String.self, forKey: codingKey), let double = Double(value) { return double }
        }
        return nil
    }

    func decodeFlexibleInt(keys: [String]) throws -> Int? {
        for key in keys {
            let codingKey = FlexibleCodingKey(key)
            if let value = try decodeIfPresent(Int.self, forKey: codingKey) { return value }
            if let value = try decodeIfPresent(Double.self, forKey: codingKey) { return Int(value) }
            if let value = try decodeIfPresent(String.self, forKey: codingKey), let int = Int(value) { return int }
        }
        return nil
    }

    func decodeFlexibleBool(keys: [String]) throws -> Bool? {
        for key in keys {
            let codingKey = FlexibleCodingKey(key)
            if let value = try decodeIfPresent(Bool.self, forKey: codingKey) { return value }
            if let value = try decodeIfPresent(Int.self, forKey: codingKey) { return value != 0 }
            if let value = try decodeIfPresent(String.self, forKey: codingKey) {
                let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if ["true", "1", "yes"].contains(normalized) { return true }
                if ["false", "0", "no"].contains(normalized) { return false }
            }
        }
        return nil
    }
}

struct Banner: Decodable, Identifiable {
    let id: String
    let imageUrl: String
    let linkType: String?
    let linkValue: String?
    let sortOrder: Int?

    var absoluteImageURL: URL? { imageUrl.absoluteCityURL }
}

struct CartResponse: Decodable {
    let success: Bool
    let items: [CartItem]
    let subtotal: Double
    let count: Int
    let deliveryFee: Double?
    let discount: Double?
    let total: Double?

    init(from decoder: Decoder) throws {
        let root = try decoder.container(keyedBy: FlexibleCodingKey.self)
        success = try root.decodeFlexibleBool(keys: ["success"]) ?? true

        let cartContainer: KeyedDecodingContainer<FlexibleCodingKey>
        if root.contains(FlexibleCodingKey("data")),
           let nested = try? root.nestedContainer(keyedBy: FlexibleCodingKey.self, forKey: FlexibleCodingKey("data")) {
            cartContainer = nested
        } else {
            cartContainer = root
        }

        items = (try? cartContainer.decodeIfPresent([CartItem].self, forKey: FlexibleCodingKey("items"))) ?? []
        subtotal = try cartContainer.decodeFlexibleDouble(keys: ["subtotal"]) ?? items.reduce(0) { $0 + $1.total }
        count = try cartContainer.decodeFlexibleInt(keys: ["count", "items_count", "itemsCount"]) ?? items.reduce(0) { $0 + $1.quantity }
        deliveryFee = try cartContainer.decodeFlexibleDouble(keys: ["delivery_fee", "deliveryFee"])
        discount = try cartContainer.decodeFlexibleDouble(keys: ["discount"])
        total = try cartContainer.decodeFlexibleDouble(keys: ["total"])
    }
}

struct CartItem: Codable, Identifiable {
    let id: String
    let productId: String
    let nameAr: String
    let price: Double
    let discountPrice: Double?
    let imageUrl: String?
    let stockQty: Int
    let quantity: Int
    let vendorId: String?
    let vendorName: String?
    let vendorSlug: String?
    let effectivePrice: Double?
    let total: Double

    init(
        id: String,
        productId: String,
        nameAr: String,
        price: Double,
        discountPrice: Double?,
        imageUrl: String?,
        stockQty: Int,
        quantity: Int,
        vendorId: String?,
        vendorName: String?,
        vendorSlug: String?,
        effectivePrice: Double?
    ) {
        self.id = id
        self.productId = productId
        self.nameAr = nameAr
        self.price = price
        self.discountPrice = discountPrice
        self.imageUrl = imageUrl
        self.stockQty = stockQty
        self.quantity = quantity
        self.vendorId = vendorId
        self.vendorName = vendorName
        self.vendorSlug = vendorSlug
        self.effectivePrice = effectivePrice
        self.total = (effectivePrice ?? discountPrice ?? price) * Double(quantity)
    }

    init(product: Product, quantity: Int) {
        self.init(
            id: product.id,
            productId: product.id,
            nameAr: product.nameAr,
            price: product.price,
            discountPrice: product.discountPrice,
            imageUrl: product.imageUrl ?? product.images?.first,
            stockQty: product.stockQty,
            quantity: quantity,
            vendorId: product.vendorId,
            vendorName: product.vendorName,
            vendorSlug: product.vendorSlug,
            effectivePrice: product.effectivePrice
        )
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        productId = try c.decodeFlexibleString(keys: ["product_id", "productId"]) ?? UUID().uuidString
        id = try c.decodeFlexibleString(keys: ["id", "cart_item_id", "cartItemId"]) ?? productId
        nameAr = try c.decodeFlexibleString(keys: ["name_ar", "nameAr", "name", "product_name", "productName"]) ?? "منتج"
        price = try c.decodeFlexibleDouble(keys: ["price", "unit_price", "unitPrice"]) ?? 0
        discountPrice = try c.decodeFlexibleDouble(keys: ["discount_price", "discountPrice"])
        imageUrl = try c.decodeFlexibleString(keys: ["image_url", "imageUrl", "image"])
        stockQty = try c.decodeFlexibleInt(keys: ["stock_qty", "stockQty", "stock"]) ?? 0
        quantity = try c.decodeFlexibleInt(keys: ["quantity", "qty"]) ?? 0
        vendorId = try c.decodeFlexibleString(keys: ["vendor_id", "vendorId"])
        vendorName = try c.decodeFlexibleString(keys: ["vendor_name", "vendorName"])
        vendorSlug = try c.decodeFlexibleString(keys: ["vendor_slug", "vendorSlug"])
        effectivePrice = try c.decodeFlexibleDouble(keys: ["effective_price", "effectivePrice"])
        total = try c.decodeFlexibleDouble(keys: ["total", "line_total", "lineTotal"]) ?? ((effectivePrice ?? discountPrice ?? price) * Double(quantity))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: FlexibleCodingKey.self)
        try c.encode(id, forKey: FlexibleCodingKey("id"))
        try c.encode(productId, forKey: FlexibleCodingKey("productId"))
        try c.encode(nameAr, forKey: FlexibleCodingKey("nameAr"))
        try c.encode(price, forKey: FlexibleCodingKey("price"))
        try c.encodeIfPresent(discountPrice, forKey: FlexibleCodingKey("discountPrice"))
        try c.encodeIfPresent(imageUrl, forKey: FlexibleCodingKey("imageUrl"))
        try c.encode(stockQty, forKey: FlexibleCodingKey("stockQty"))
        try c.encode(quantity, forKey: FlexibleCodingKey("quantity"))
        try c.encodeIfPresent(vendorId, forKey: FlexibleCodingKey("vendorId"))
        try c.encodeIfPresent(vendorName, forKey: FlexibleCodingKey("vendorName"))
        try c.encodeIfPresent(vendorSlug, forKey: FlexibleCodingKey("vendorSlug"))
        try c.encodeIfPresent(effectivePrice, forKey: FlexibleCodingKey("effectivePrice"))
        try c.encode(total, forKey: FlexibleCodingKey("total"))
    }

    var absoluteImageURL: URL? { imageUrl.absoluteCityURL }
}

struct User: Codable, Identifiable {
    let id: String
    let phone: String
    let name: String?
    let email: String?
    let avatarUrl: String?
    let loyaltyPoints: Int?
    let loyaltyTier: String?
}

struct Order: Decodable, Identifiable, Hashable {
    let id: String
    let status: OrderStatus
    let total: Double
    let subtotal: Double?
    let deliveryFee: Double?
    let discount: Double?
    let addressText: String?
    let deliveryAddress: String?
    let orderNumber: String?
    let items: [OrderItem]?
    let createdAt: String?
    let paymentMethod: String?
    let paymentStatus: String?
    let idempotencyKey: String?

    enum CodingKeys: String, CodingKey {
        case id, status, total, subtotal, deliveryFee, discount, addressText, deliveryAddress, orderNumber, items, createdAt, paymentMethod, paymentStatus, idempotencyKey
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Order, rhs: Order) -> Bool {
        lhs.id == rhs.id
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = try c.decodeIfPresent(OrderStatus.self, forKey: .status) ?? .pending
        total = try c.decodeFlexibleDouble(forKey: .total) ?? 0
        subtotal = try c.decodeFlexibleDouble(forKey: .subtotal)
        deliveryFee = try c.decodeFlexibleDouble(forKey: .deliveryFee)
        discount = try c.decodeFlexibleDouble(forKey: .discount)
        addressText = try c.decodeIfPresent(String.self, forKey: .addressText)
        deliveryAddress = try c.decodeIfPresent(String.self, forKey: .deliveryAddress)
        orderNumber = try c.decodeIfPresent(String.self, forKey: .orderNumber)
        items = try c.decodeIfPresent([OrderItem].self, forKey: .items)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        paymentMethod = try c.decodeIfPresent(String.self, forKey: .paymentMethod)
        paymentStatus = try c.decodeIfPresent(String.self, forKey: .paymentStatus)
        let flexible = try decoder.container(keyedBy: FlexibleCodingKey.self)
        idempotencyKey = try flexible.decodeFlexibleString(keys: ["idempotencyKey", "idempotency_key"])
    }
}

struct OrderItem: Decodable, Identifiable, Hashable {
    let id: String?
    let productId: String?
    let nameAr: String?
    let quantity: Int
    let price: Double?
    let total: Double?
    let imageUrl: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        id = try c.decodeFlexibleString(keys: ["id", "order_item_id", "orderItemId"])
        productId = try c.decodeFlexibleString(keys: ["product_id", "productId"])
        nameAr = try c.decodeFlexibleString(keys: ["name_ar", "nameAr", "name", "product_name", "productName"])
        quantity = try c.decodeFlexibleInt(keys: ["quantity", "qty"]) ?? 0
        price = try c.decodeFlexibleDouble(keys: ["price", "unit_price", "unitPrice"])
        total = try c.decodeFlexibleDouble(keys: ["total", "line_total", "lineTotal"])
        imageUrl = try c.decodeFlexibleString(keys: ["image_url", "imageUrl", "image"])
    }

    var absoluteImageURL: URL? { imageUrl.absoluteCityURL }
}

enum OrderStatus: String, Decodable, Hashable {
    case pending
    case confirmed
    case shopping
    case onTheWay = "on_the_way"
    case delivered
    case cancelled

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        switch raw {
        case "pending": self = .pending
        case "confirmed": self = .confirmed
        case "shopping", "preparing": self = .shopping
        case "on_the_way", "out_for_delivery": self = .onTheWay
        case "delivered": self = .delivered
        case "cancelled", "canceled": self = .cancelled
        default: self = .pending
        }
    }

    var displayName: String {
        switch self {
        case .pending: "قيد المراجعة"
        case .confirmed: "مؤكد"
        case .shopping: "قيد التجهيز"
        case .onTheWay: "في الطريق"
        case .delivered: "تم التوصيل"
        case .cancelled: "ملغي"
        }
    }
}

struct AuthResponse: Decodable {
    let success: Bool
    let user: User
    let token: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        let data = try? c.nestedContainer(keyedBy: FlexibleCodingKey.self, forKey: FlexibleCodingKey("data"))
        success = (try? c.decodeFlexibleBool(keys: ["success"])) ?? true
        user = try c.decodeIfPresent(User.self, forKey: FlexibleCodingKey("user"))
            ?? data?.decodeIfPresent(User.self, forKey: FlexibleCodingKey("user"))
            ?? c.decode(User.self, forKey: FlexibleCodingKey("data"))
        token = (try? c.decodeFlexibleString(keys: ["token", "accessToken", "access_token", "sessionToken", "session_token"]))
            ?? (try? data?.decodeFlexibleString(keys: ["token", "accessToken", "access_token", "sessionToken", "session_token"]))
    }
}

struct CurrentUserResponse: Decodable {
    let user: User?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        let data = try? c.nestedContainer(keyedBy: FlexibleCodingKey.self, forKey: FlexibleCodingKey("data"))
        user = try c.decodeIfPresent(User.self, forKey: FlexibleCodingKey("user"))
            ?? data?.decodeIfPresent(User.self, forKey: FlexibleCodingKey("user"))
            ?? (try? c.decodeIfPresent(User.self, forKey: FlexibleCodingKey("data")))
    }
}

struct OrdersResponse: Decodable {
    let success: Bool?
    let orders: [Order]?
    let data: [Order]?
}

struct CheckoutResponse: Decodable {
    let success: Bool
    let parentOrderId: String?
    let total: Double?
    let paymentUrl: String?
    let inlinePayment: Bool?
    let requiresPayment: Bool?
    let message: String?
    var idempotencyKey: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        success = try c.decodeFlexibleBool(keys: ["success"]) ?? true
        parentOrderId = try c.decodeFlexibleString(keys: ["parent_order_id", "parentOrderId", "order_id", "orderId", "id"])
        total = try c.decodeFlexibleDouble(keys: ["total", "amount"])
        paymentUrl = try c.decodeFlexibleString(keys: ["payment_url", "paymentUrl"])
        inlinePayment = try c.decodeFlexibleBool(keys: ["inline_payment", "inlinePayment"])
        requiresPayment = try c.decodeFlexibleBool(keys: ["requires_payment", "requiresPayment"])
        message = try c.decodeFlexibleString(keys: ["message"])
        idempotencyKey = try c.decodeFlexibleString(keys: ["idempotency_key", "idempotencyKey"])
    }
}

struct DeliverySlotsResponse: Decodable {
    let date: String
    let timezone: String?
    let enabled: Bool
    let leadTimeMinutes: Int?
    let minDate: String?
    let maxDate: String?
    let windows: [DeliverySlot]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        let data = Self.nestedDataContainer(from: c)
        date = Self.decodeString(from: c, nested: data, keys: ["date"]) ?? ""
        timezone = Self.decodeString(from: c, nested: data, keys: ["timezone", "time_zone", "timeZone"])
        enabled = Self.decodeBool(from: c, nested: data, keys: ["enabled"]) ?? true
        leadTimeMinutes = Self.decodeInt(from: c, nested: data, keys: ["lead_time_minutes", "leadTimeMinutes"])
        minDate = Self.decodeString(from: c, nested: data, keys: ["min_date", "minDate"])
        maxDate = Self.decodeString(from: c, nested: data, keys: ["max_date", "maxDate"])
        windows = (try? c.decodeIfPresent([DeliverySlot].self, forKey: FlexibleCodingKey("windows")))
            ?? (try? c.decodeIfPresent([DeliverySlot].self, forKey: FlexibleCodingKey("slots")))
            ?? (try? c.decodeIfPresent([DeliverySlot].self, forKey: FlexibleCodingKey("data")))
            ?? data.flatMap { try? $0.decodeIfPresent([DeliverySlot].self, forKey: FlexibleCodingKey("windows")) }
            ?? data.flatMap { try? $0.decodeIfPresent([DeliverySlot].self, forKey: FlexibleCodingKey("slots")) }
            ?? []
    }

    private static func nestedDataContainer(from container: KeyedDecodingContainer<FlexibleCodingKey>) -> KeyedDecodingContainer<FlexibleCodingKey>? {
        guard container.contains(FlexibleCodingKey("data")) else { return nil }
        return try? container.nestedContainer(keyedBy: FlexibleCodingKey.self, forKey: FlexibleCodingKey("data"))
    }

    private static func decodeString(from container: KeyedDecodingContainer<FlexibleCodingKey>, nested: KeyedDecodingContainer<FlexibleCodingKey>?, keys: [String]) -> String? {
        (try? container.decodeFlexibleString(keys: keys)) ?? nested.flatMap { try? $0.decodeFlexibleString(keys: keys) }
    }

    private static func decodeBool(from container: KeyedDecodingContainer<FlexibleCodingKey>, nested: KeyedDecodingContainer<FlexibleCodingKey>?, keys: [String]) -> Bool? {
        (try? container.decodeFlexibleBool(keys: keys)) ?? nested.flatMap { try? $0.decodeFlexibleBool(keys: keys) }
    }

    private static func decodeInt(from container: KeyedDecodingContainer<FlexibleCodingKey>, nested: KeyedDecodingContainer<FlexibleCodingKey>?, keys: [String]) -> Int? {
        (try? container.decodeFlexibleInt(keys: keys)) ?? nested.flatMap { try? $0.decodeFlexibleInt(keys: keys) }
    }
}

struct DeliverySlot: Decodable, Identifiable, Equatable {
    let id: String
    let labelAr: String
    let start: String?
    let end: String?
    let startAt: String
    let endAt: String?
    let capacity: Int?
    let booked: Int?
    let remaining: Int?
    let available: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        id = try c.decodeFlexibleString(keys: ["id", "slot_id", "slotId"]) ?? UUID().uuidString
        labelAr = try c.decodeFlexibleString(keys: ["label_ar", "labelAr", "label", "name"]) ?? id
        start = try c.decodeFlexibleString(keys: ["start"])
        end = try c.decodeFlexibleString(keys: ["end"])
        startAt = try c.decodeFlexibleString(keys: ["start_at", "startAt", "scheduled_for", "scheduledFor"]) ?? ""
        endAt = try c.decodeFlexibleString(keys: ["end_at", "endAt"])
        capacity = try c.decodeFlexibleInt(keys: ["capacity"])
        booked = try c.decodeFlexibleInt(keys: ["booked", "booked_count", "bookedCount"])
        remaining = try c.decodeFlexibleInt(keys: ["remaining", "remaining_capacity", "remainingCapacity", "remaining_seats", "remainingSeats"])
        available = try c.decodeFlexibleBool(keys: ["available", "is_available", "isAvailable"]) ?? true
    }

    var displayTime: String {
        if let start, let end { return "\(start) - \(end)" }
        return startAt
    }

    var remainingSeatsText: String? {
        if let remaining { return "\(remaining) مقعد متبقي" }
        if let capacity, let booked { return "\(max(capacity - booked, 0)) مقعد متبقي" }
        return nil
    }
}

struct DeliveryQuoteRequest: Encodable {
    let latitude: Double
    let longitude: Double
    let subtotal: Double
}

struct DeliveryQuoteResponse: Decodable {
    let success: Bool
    let deliveryFee: Double
    let isFreeDelivery: Bool
    let zoneName: String?
    let zoneId: String?
    let freeDeliveryMin: Double?
    let inDeliveryArea: Bool
    let serviceFee: Double?
    let tax: Double?
    let distanceKm: Double?
    let maxDistance: Double?
    let error: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        let data = Self.nestedDataContainer(from: c)
        success = Self.decodeBool(from: c, nested: data, keys: ["success"]) ?? false
        deliveryFee = Self.decodeDouble(from: c, nested: data, keys: ["deliveryFee", "delivery_fee", "fee", "deliveryPrice", "delivery_price"]) ?? 0
        isFreeDelivery = Self.decodeBool(from: c, nested: data, keys: ["isFreeDelivery", "is_free_delivery", "freeDelivery", "free_delivery"]) ?? false
        zoneName = Self.decodeString(from: c, nested: data, keys: ["zoneName", "zone_name", "deliveryZoneName", "delivery_zone_name"])
            ?? Self.decodeNestedZoneName(from: c)
            ?? data.flatMap { Self.decodeNestedZoneName(from: $0) }
        zoneId = Self.decodeZoneId(from: c) ?? data.flatMap { Self.decodeZoneId(from: $0) }
        freeDeliveryMin = Self.decodeDouble(from: c, nested: data, keys: ["freeDeliveryMin", "free_delivery_min", "freeDeliveryMinimum", "free_delivery_minimum"])
        inDeliveryArea = Self.decodeBool(from: c, nested: data, keys: ["inDeliveryArea", "in_delivery_area", "withinDeliveryArea", "within_delivery_area", "available", "isAvailable", "is_available"]) ?? success
        serviceFee = Self.decodeDouble(from: c, nested: data, keys: ["serviceFee", "service_fee"])
        tax = Self.decodeDouble(from: c, nested: data, keys: ["tax", "vat"])
        distanceKm = Self.decodeDouble(from: c, nested: data, keys: ["distanceKm", "distance_km", "distance"])
        maxDistance = Self.decodeDouble(from: c, nested: data, keys: ["maxDistance", "max_distance"])
        error = Self.decodeString(from: c, nested: data, keys: ["error", "message"])
    }

    private static func nestedDataContainer(from container: KeyedDecodingContainer<FlexibleCodingKey>) -> KeyedDecodingContainer<FlexibleCodingKey>? {
        guard container.contains(FlexibleCodingKey("data")) else { return nil }
        return try? container.nestedContainer(keyedBy: FlexibleCodingKey.self, forKey: FlexibleCodingKey("data"))
    }

    private static func decodeString(from container: KeyedDecodingContainer<FlexibleCodingKey>, nested: KeyedDecodingContainer<FlexibleCodingKey>?, keys: [String]) -> String? {
        (try? container.decodeFlexibleString(keys: keys)) ?? nested.flatMap { try? $0.decodeFlexibleString(keys: keys) }
    }

    private static func decodeDouble(from container: KeyedDecodingContainer<FlexibleCodingKey>, nested: KeyedDecodingContainer<FlexibleCodingKey>?, keys: [String]) -> Double? {
        (try? container.decodeFlexibleDouble(keys: keys)) ?? nested.flatMap { try? $0.decodeFlexibleDouble(keys: keys) }
    }

    private static func decodeBool(from container: KeyedDecodingContainer<FlexibleCodingKey>, nested: KeyedDecodingContainer<FlexibleCodingKey>?, keys: [String]) -> Bool? {
        (try? container.decodeFlexibleBool(keys: keys)) ?? nested.flatMap { try? $0.decodeFlexibleBool(keys: keys) }
    }

    private static func decodeZoneId(from container: KeyedDecodingContainer<FlexibleCodingKey>) -> String? {
        (try? container.decodeFlexibleString(keys: ["zoneId", "zone_id", "deliveryZoneId", "delivery_zone_id"]))
            ?? Self.decodeNestedZoneField(from: container, keys: ["id", "uuid", "zone_id", "zoneId", "delivery_zone_id", "deliveryZoneId"])
    }

    private static func decodeNestedZoneName(from container: KeyedDecodingContainer<FlexibleCodingKey>) -> String? {
        Self.decodeNestedZoneField(from: container, keys: ["name", "name_ar", "nameAr", "title", "zone_name", "zoneName"])
    }

    private static func decodeNestedZoneField(from container: KeyedDecodingContainer<FlexibleCodingKey>, keys: [String]) -> String? {
        for key in ["zone", "deliveryZone", "delivery_zone", "deliveryZoneInfo", "delivery_zone_info"] {
            guard container.contains(FlexibleCodingKey(key)),
                  let nested = try? container.nestedContainer(keyedBy: FlexibleCodingKey.self, forKey: FlexibleCodingKey(key)),
                  let value = try? nested.decodeFlexibleString(keys: keys) else {
                continue
            }
            return value
        }
        return nil
    }
}

struct NominatimReverseGeocodeResponse: Decodable {
    let displayName: String?
    let address: NominatimAddress?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        displayName = try c.decodeFlexibleString(keys: ["display_name", "displayName"])
        address = try c.decodeIfPresent(NominatimAddress.self, forKey: FlexibleCodingKey("address"))
    }

    func resolvedAddress(latitude: Double, longitude: Double) -> ResolvedLocationAddress {
        let road = address?.road?.nilIfBlank
        let district = address?.neighbourhood?.nilIfBlank ?? address?.suburb?.nilIfBlank
        let city = address?.city?.nilIfBlank ?? address?.town?.nilIfBlank ?? address?.county?.nilIfBlank
        let state = address?.state?.nilIfBlank
        let display = [road, district, city, state].compactMap { $0 }.joined(separator: "، ").nilIfBlank
            ?? displayName?.nilIfBlank
            ?? String(format: "%.5f، %.5f", longitude, latitude)
        let title = district ?? city ?? road ?? "موقعي الحالي"
        return ResolvedLocationAddress(shortTitle: title, fullAddress: display)
    }
}

struct NominatimAddress: Decodable {
    let road: String?
    let neighbourhood: String?
    let suburb: String?
    let city: String?
    let town: String?
    let county: String?
    let state: String?
}

struct PaymentInitiateResponse: Decodable {
    let paymentUrl: String?
    let id: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        paymentUrl = try c.decodeFlexibleString(keys: ["payment_url", "paymentUrl"])
        id = try c.decodeFlexibleString(keys: ["id", "payment_id", "paymentId"])
    }
}

struct Coupon: Decodable, Identifiable {
    var id: String { code }
    let code: String
    let type: String?
    let value: Double?
    let maxDiscount: Double?
    let freeDelivery: Bool?
    let minOrder: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        code = try c.decodeFlexibleString(keys: ["code", "coupon_code", "couponCode"]) ?? ""
        type = try c.decodeFlexibleString(keys: ["type"])
        value = try c.decodeFlexibleDouble(keys: ["value", "discount_value", "discountValue"])
        maxDiscount = try c.decodeFlexibleDouble(keys: ["max_discount", "maxDiscount"])
        freeDelivery = try c.decodeFlexibleBool(keys: ["free_delivery", "freeDelivery"])
        minOrder = try c.decodeFlexibleDouble(keys: ["min_order", "minOrder"])
    }
}

struct CouponValidationResponse: Decodable {
    let success: Bool
    let coupon: Coupon?
    let error: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        success = try c.decodeFlexibleBool(keys: ["success"]) ?? false
        coupon = try? c.decodeIfPresent(Coupon.self, forKey: FlexibleCodingKey("coupon"))
        error = try c.decodeFlexibleString(keys: ["error", "message"])
    }
}

struct LoyaltySummary: Decodable {
    let balance: Int
    let lifetimeEarned: Int?
    let lifetimeRedeemed: Int?
    let settings: LoyaltySettings?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        balance = try c.decodeFlexibleInt(keys: ["balance", "points", "loyalty_points", "loyaltyPoints"]) ?? 0
        lifetimeEarned = try c.decodeFlexibleInt(keys: ["lifetime_earned", "lifetimeEarned"])
        lifetimeRedeemed = try c.decodeFlexibleInt(keys: ["lifetime_redeemed", "lifetimeRedeemed"])
        settings = try? c.decodeIfPresent(LoyaltySettings.self, forKey: FlexibleCodingKey("settings"))
    }
}

struct LoyaltySettings: Decodable {
    let minRedeemPoints: Int?
    let enabled: Bool?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        minRedeemPoints = try c.decodeFlexibleInt(keys: ["min_redeem_points", "minRedeemPoints"])
        enabled = try c.decodeFlexibleBool(keys: ["enabled"])
    }
}

struct LoyaltyPreview: Decodable {
    let redeemablePoints: Int
    let discountSar: Double
    let remainingPointsAfter: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        redeemablePoints = try c.decodeFlexibleInt(keys: ["redeemable_points", "redeemablePoints"]) ?? 0
        discountSar = try c.decodeFlexibleDouble(keys: ["discount_sar", "discountSar", "discount"]) ?? 0
        remainingPointsAfter = try c.decodeFlexibleInt(keys: ["remaining_points_after", "remainingPointsAfter"])
    }
}

struct Offer: Decodable, Identifiable {
    let id: String
    let name: String
    let type: String?
    let discountValue: Double?
    let minOrder: Double?
    let imageUrl: String?
    let validUntil: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        id = try c.decodeFlexibleString(keys: ["id", "uuid"]) ?? UUID().uuidString
        // /api/v1/offers returns title_ar / discount_type / ends_at.
        name = try c.decodeFlexibleString(keys: ["title_ar", "titleAr", "name_ar", "nameAr", "name", "title"]) ?? "عرض"
        type = try c.decodeFlexibleString(keys: ["discount_type", "discountType", "type"])
        discountValue = try c.decodeFlexibleDouble(keys: ["discount_value", "discountValue", "value"])
        minOrder = try c.decodeFlexibleDouble(keys: ["min_order", "minOrder"])
        imageUrl = try c.decodeFlexibleString(keys: ["image_url", "imageUrl", "image"])
        validUntil = try c.decodeFlexibleString(keys: ["ends_at", "endsAt", "valid_until", "validUntil"])
    }

    var absoluteImageURL: URL? { imageUrl.absoluteCityURL }
}

struct Review: Decodable, Identifiable {
    let id: String
    let rating: Int?
    let comment: String?
    let userName: String?
    let createdAt: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        id = try c.decodeFlexibleString(keys: ["id", "uuid"]) ?? UUID().uuidString
        rating = try c.decodeFlexibleInt(keys: ["rating", "store_rating", "storeRating", "driver_rating", "driverRating"])
        comment = try c.decodeFlexibleString(keys: ["comment", "message"])
        userName = try c.decodeFlexibleString(keys: ["user_name", "userName", "name"])
        createdAt = try c.decodeFlexibleString(keys: ["created_at", "createdAt"])
    }
}

struct TrackedOrder: Decodable, Identifiable {
    let id: String
    let status: OrderStatus
    let statusLabel: String?
    let total: Double?
    let etaMinutes: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        id = try c.decodeFlexibleString(keys: ["id", "order_id", "orderId"]) ?? UUID().uuidString
        status = (try? c.decodeIfPresent(OrderStatus.self, forKey: FlexibleCodingKey("status"))) ?? .pending
        statusLabel = try c.decodeFlexibleString(keys: ["status_label", "statusLabel"])
        total = try c.decodeFlexibleDouble(keys: ["total", "amount"])
        etaMinutes = try c.decodeFlexibleInt(keys: ["eta_minutes", "etaMinutes"])
    }
}

struct OrderEvent: Decodable, Identifiable {
    let id: String
    let event: String
    let orderId: String?
    let status: OrderStatus?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        id = try c.decodeFlexibleString(keys: ["id", "event_id", "eventId"]) ?? UUID().uuidString
        event = try c.decodeFlexibleString(keys: ["event", "type", "name"]) ?? "order.status"
        orderId = try c.decodeFlexibleString(keys: ["order_id", "orderId"])
        status = try? c.decodeIfPresent(OrderStatus.self, forKey: FlexibleCodingKey("status"))
    }
}

struct SuccessResponse: Decodable {
    let success: Bool?
    let message: String?
    let error: String?
}

struct DeleteAccountRequest: Encodable {
    let confirmation: String
}

struct DeleteAccountResponse: Decodable {
    let success: Bool
    let message: String?
    let error: String?
}

// AUDIT 2026-09-30 / iOS Phase T2-3: the iOS app accepts both legacy and
// new server envelopes. The server still emits `{ success: false, error:
// "<ar-string>" }` for the v1 routes the iOS app calls — that path is
// covered by the two flat fields below.
//
// Admin routes now also emit the structured `{ success: false, error:
// { code, messageAr, messageEn }, requestId }` envelope. We expose
// those fields as optionals so the iOS app can opt-in to the new
// fields (e.g. show `code` in the support ticket) without breaking
// the existing user-facing `error` flow.
struct ErrorResponse: Decodable {
    let error: String?
    let message: String?

    // New structured envelope (server Phase 1.3 / 8.1.1). Optional so
    // older deployments that only send `{ error: "<string>" }` keep
    // decoding.
    struct DetailEnvelope: Decodable {
        let code: String?
        let messageAr: String?
        let messageEn: String?
    }
    let errorDetail: DetailEnvelope?
    let requestId: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        error = try c.decodeFlexibleString(keys: ["error"])
        message = try c.decodeFlexibleString(keys: ["message"])

        // The new admin envelope uses `error` as a JSON OBJECT
        // (`{ code, messageAr, messageEn }`) instead of a flat string.
        // We peek at the JSON type first — if it's a string we keep
        // `errorDetail = nil` (legacy shape); if it's an object we
        // decode it as a `DetailEnvelope`.
        if c.contains(FlexibleCodingKey("error")) {
            // Peek at the raw value to detect type.
            let rawValue = try? c.decodeIfPresent(
                DetailEnvelope.self,
                forKey: FlexibleCodingKey("error")
            )
            errorDetail = rawValue
        } else {
            errorDetail = nil
        }
        requestId = try c.decodeFlexibleString(keys: ["requestId"])
    }
}

struct CSRFResponse: Decodable {
    let csrfToken: String
}

struct AIChatRequest: Encodable {
    let message: String
    let history: [AIChatTurn]
}

struct AIChatTurn: Codable, Identifiable {
    var id: String { "\(role)-\(content)" }
    let role: String
    let content: String
}

struct AIChatResponse: Decodable {
    let success: Bool
    let reply: String?
    let matched: [AIMatchedProduct]?
    let unmatched: [String]?
    let autoAdd: Bool?
    let mealSuggestions: [MealSuggestion]?
    let error: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        success = try c.decodeFlexibleBool(keys: ["success"]) ?? true
        reply = try c.decodeFlexibleString(keys: ["reply", "message", "content"])
        matched = (try? c.decodeIfPresent([AIMatchedProduct].self, forKey: FlexibleCodingKey("matched")))
            ?? (try? c.decodeIfPresent([AIMatchedProduct].self, forKey: FlexibleCodingKey("matched_items")))
            ?? (try? c.decodeIfPresent([AIMatchedProduct].self, forKey: FlexibleCodingKey("matchedItems")))
        unmatched = try? c.decodeIfPresent([String].self, forKey: FlexibleCodingKey("unmatched"))
        autoAdd = try c.decodeFlexibleBool(keys: ["auto_add", "autoAdd"])
        mealSuggestions = (try? c.decodeIfPresent([MealSuggestion].self, forKey: FlexibleCodingKey("meal_suggestions")))
            ?? (try? c.decodeIfPresent([MealSuggestion].self, forKey: FlexibleCodingKey("mealSuggestions")))
        error = try c.decodeFlexibleString(keys: ["error"])
    }
}

struct AIMatchedProduct: Decodable, Identifiable {
    let product: Product
    let quantity: Int

    var id: String { product.id }
}

struct MealSuggestion: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String
    let ingredients: [MealIngredient]?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        title = try c.decodeFlexibleString(keys: ["title", "name_ar", "nameAr", "name"]) ?? "اقتراح"
        id = try c.decodeFlexibleString(keys: ["id"]) ?? title
        description = try c.decodeFlexibleString(keys: ["description", "instructions", "summary"]) ?? ""
        ingredients = try? c.decodeIfPresent([MealIngredient].self, forKey: FlexibleCodingKey("ingredients"))
    }
}

struct MealIngredient: Decodable, Identifiable {
    var id: String { "\(searchQuery)-\(quantity)" }
    let searchQuery: String
    let quantity: Int

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: FlexibleCodingKey.self)
        searchQuery = try c.decodeFlexibleString(keys: ["search_query", "searchQuery", "name", "name_ar", "nameAr"]) ?? ""
        quantity = try c.decodeFlexibleInt(keys: ["quantity", "qty"]) ?? 1
    }
}

struct ChefChatMessage: Identifiable, Equatable {
    let id = UUID()
    let role: ChefRole
    let content: String
    let matches: [AIMatchedProduct]
    let suggestions: [MealSuggestion]

    static func == (lhs: ChefChatMessage, rhs: ChefChatMessage) -> Bool {
        lhs.id == rhs.id
    }
}

enum ChefRole: String {
    case user
    case assistant
}

struct AddCartRequest: Encodable {
    let productId: String
    let vendorId: String?
    let quantity: Int

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: FlexibleCodingKey.self)
        try c.encode(productId, forKey: FlexibleCodingKey("product_id"))
        try c.encodeIfPresent(vendorId, forKey: FlexibleCodingKey("vendor_id"))
        try c.encode(quantity, forKey: FlexibleCodingKey("quantity"))
    }
}

struct UpdateCartRequest: Encodable {
    let productId: String
    let quantity: Int

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: FlexibleCodingKey.self)
        try c.encode(productId, forKey: FlexibleCodingKey("product_id"))
        try c.encode(quantity, forKey: FlexibleCodingKey("quantity"))
    }
}

struct PhoneRequest: Encodable { let phone: String }
struct VerifyRequest: Encodable { let phone: String; let code: String }
struct EmptyBody: Encodable {}

struct CheckoutItem: Encodable {
    let productId: String
    let quantity: Int

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: FlexibleCodingKey.self)
        try c.encode(productId, forKey: FlexibleCodingKey("productId"))
        try c.encode(productId, forKey: FlexibleCodingKey("product_id"))
        try c.encode(quantity, forKey: FlexibleCodingKey("quantity"))
    }
}

struct GuestCheckoutInfo: Encodable {
    let name: String
    let phone: String
    let address: Address

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: FlexibleCodingKey.self)
        let addressInfo = CheckoutAddressInfo(address: address)
        try c.encode(name, forKey: FlexibleCodingKey("name"))
        try c.encode(phone, forKey: FlexibleCodingKey("phone"))
        try c.encode(addressInfo.addressText, forKey: FlexibleCodingKey("street"))
        try c.encode(addressInfo.addressText, forKey: FlexibleCodingKey("district"))
        try c.encode(addressInfo.city, forKey: FlexibleCodingKey("city"))
        try c.encodeIfPresent(addressInfo.lat, forKey: FlexibleCodingKey("lat"))
        try c.encodeIfPresent(addressInfo.lng, forKey: FlexibleCodingKey("lng"))
    }
}

struct CheckoutAddressInfo: Encodable {
    let label: String
    let title: String
    let addressText: String
    let notes: String?
    let lat: Double?
    let lng: Double?
    let city: String
    let placeImages: [String]

    init(address: Address) {
        label = address.label
        title = address.title?.nilIfBlank ?? address.typeName
        addressText = address.displayDetails.nilIfBlank ?? address.title?.nilIfBlank ?? address.coordinateText
        notes = address.notes?.nilIfBlank
        lat = address.lat
        lng = address.lng
        city = "الرياض"
        placeImages = address.placeImages
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: FlexibleCodingKey.self)
        try c.encode(addressText, forKey: FlexibleCodingKey("address_text"))
        try c.encodeIfPresent(lat, forKey: FlexibleCodingKey("lat"))
        try c.encodeIfPresent(lng, forKey: FlexibleCodingKey("lng"))
    }
}

struct CheckoutRequest: Encodable {
    let items: [CheckoutItem]
    let paymentMethod: String
    let moyasarMethod: String?
    let deliveryType: String
    let notes: String?
    let customerName: String?
    let customerPhone: String?
    let addressId: String?
    let address: CheckoutAddressInfo?
    let guestInfo: GuestCheckoutInfo?
    let couponCode: String?
    let pointsRedeemed: Int?
    let scheduled: Bool
    let scheduledFor: String?
    let slotId: String?
    let slotWindow: String?
    let deliveryZoneId: String?
    let scheduledAt: String?
    let idempotencyKey: String

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: FlexibleCodingKey.self)
        try c.encode(items, forKey: FlexibleCodingKey("items"))
        try c.encode(paymentMethod, forKey: FlexibleCodingKey("payment_method"))
        try c.encode(deliveryType, forKey: FlexibleCodingKey("delivery_type"))
        try c.encodeIfPresent(notes, forKey: FlexibleCodingKey("notes"))
        try c.encodeIfPresent(customerName, forKey: FlexibleCodingKey("name"))
        try c.encodeIfPresent(customerPhone, forKey: FlexibleCodingKey("phone"))
        try c.encodeIfPresent(addressId, forKey: FlexibleCodingKey("address_id"))
        try c.encodeIfPresent(address, forKey: FlexibleCodingKey("address"))
        if let address {
            try c.encode(address.addressText, forKey: FlexibleCodingKey("address_text"))
            try c.encodeIfPresent(address.lat, forKey: FlexibleCodingKey("lat"))
            try c.encodeIfPresent(address.lng, forKey: FlexibleCodingKey("lng"))
        }
        try c.encodeIfPresent(guestInfo, forKey: FlexibleCodingKey("guest_info"))
        try c.encodeIfPresent(couponCode, forKey: FlexibleCodingKey("coupon_code"))
        try c.encodeIfPresent(pointsRedeemed, forKey: FlexibleCodingKey("points_redeemed"))
        try c.encodeIfPresent(moyasarMethod, forKey: FlexibleCodingKey("moyasar_method"))
        try c.encode(scheduled, forKey: FlexibleCodingKey("scheduled"))
        try c.encodeIfPresent(scheduledFor, forKey: FlexibleCodingKey("scheduled_for"))
        try c.encodeIfPresent(slotId, forKey: FlexibleCodingKey("slot_id"))
        try c.encodeIfPresent(slotWindow, forKey: FlexibleCodingKey("slot_window"))
        try c.encodeIfPresent(deliveryZoneId, forKey: FlexibleCodingKey("delivery_zone_id"))
        try c.encodeIfPresent(scheduledAt, forKey: FlexibleCodingKey("scheduled_at"))
        try c.encode(idempotencyKey, forKey: FlexibleCodingKey("idempotency_key"))
    }
}

struct PaymentOrderRequest: Encodable {
    let orderId: String
}

struct UpdatePaymentMethodRequest: Encodable {
    let paymentMethod: String
    let moyasarMethod: String?
    let idempotencyKey: String

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: FlexibleCodingKey.self)
        try c.encode(paymentMethod, forKey: FlexibleCodingKey("payment_method"))
        try c.encodeIfPresent(moyasarMethod, forKey: FlexibleCodingKey("moyasar_method"))
        try c.encode(idempotencyKey, forKey: FlexibleCodingKey("idempotency_key"))
    }
}

struct CouponValidationRequest: Encodable {
    let code: String
    let subtotal: Double
    let vendorId: String?
}

struct LoyaltyPreviewRequest: Encodable {
    let action = "preview_redeem"
    let subtotal: Double
    let maxPointsToUse: Int?

    enum CodingKeys: String, CodingKey {
        case action, subtotal
        case maxPointsToUse = "max_points_to_use"
    }
}

struct ReviewRequest: Encodable {
    let orderId: String
    let driverRating: Int?
    let storeRating: Int?
    let comment: String?

    enum CodingKeys: String, CodingKey {
        case orderId = "order_id"
        case driverRating = "driver_rating"
        case storeRating = "store_rating"
        case comment
    }
}

struct EventAckRequest: Encodable {
    let eventId: String

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
    }
}

// MARK: – Mobile Config

struct MobileConfig: Decodable {
    let apiVersion: String
    let minAppVersion: String
    let site: SiteConfig
    let auth: AuthConfig
    let payments: PaymentConfig
    let push: PushConfig
    let features: FeaturesConfig
    let locales: [LocaleConfig]
    let pagination: PaginationConfig
    let contact: ContactConfig
}

struct SiteConfig: Decodable {
    let name: String
    let nameAr: String
    let url: String
    let locale: String
    let direction: String
    let currency: String
    let timezone: String
}

struct AuthConfig: Decodable {
    let twilioOtp: Bool
    let twilioMessaging: Bool
    let bearerScheme: Bool
    let cookieScheme: Bool
}

struct PaymentConfig: Decodable {
    let provider: String
    let publishableKey: String
    let applePayDomain: String
    let webviewFallback: Bool
}

struct PushConfig: Decodable {
    let vapidPublicKey: String?
    let apnsEnabled: Bool
    let fcmEnabled: Bool
    let bundleId: String?
}

struct FeaturesConfig: Decodable {
    let loyalty: Bool
    let spinWheel: Bool
    let multiVendor: Bool
    let guestCheckout: Bool
    let applePay: Bool
    let coupons: Bool
    let blog: Bool
    let aiAssistant: Bool
    let voiceOrder: Bool
    let deliveryTracking: Bool
}

struct LocaleConfig: Decodable {
    let code: String
    let dir: String
    let name: String
    let nameEn: String
}

struct PaginationConfig: Decodable {
    let defaultLimit: Int
    let maxLimit: Int
}

struct ContactConfig: Decodable {
    let email: String
    let phone: String
}

struct TimelineEvent: Decodable, Identifiable {
    let id = UUID()
    let oldStatus: String?
    let newStatus: String
    let changedByName: String?
    let changedByRole: String?
    let notes: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case oldStatus = "old_status"
        case newStatus = "new_status"
        case changedByName = "changed_by_name"
        case changedByRole = "changed_by_role"
        case notes
        case createdAt = "created_at"
    }
}

struct TimelineResponse: Decodable {
    let success: Bool
    let timeline: [TimelineEvent]?
}

struct UserReview: Decodable, Identifiable {
    let id: String
    let productId: String
    let userId: String
    let rating: Int
    let comment: String?
    let isVerifiedPurchase: Bool
    let isApproved: Bool?
    let createdAt: String
    let updatedAt: String?
    let productName: String?
    let productImage: String?

    enum CodingKeys: String, CodingKey {
        case id
        case productId = "product_id"
        case userId = "user_id"
        case rating
        case comment
        case isVerifiedPurchase = "is_verified_purchase"
        case isApproved = "is_approved"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case productName = "product_name"
        case productImage = "product_image"
    }
}

struct MyReviewsResponse: Decodable {
    let success: Bool
    let reviews: [UserReview]?
}

struct ProfileUpdateRequest: Encodable {
    let name: String?
    let email: String?
    let avatar_url: String?
}

// MARK: - Direct Order

struct DirectOrderRequest: Encodable {
    let payment_method: String
    let notes: String?
    let voice_note_url: String?
    let voice_note_duration: Int?
    let customer_phone: String?
    let fee_acknowledged: Bool
    let delivery_address: DirectOrderAddress
    let items: [DirectOrderItem]?
    let idempotency_key: String?

    enum CodingKeys: String, CodingKey {
        case payment_method
        case notes
        case voice_note_url
        case voice_note_duration
        case customer_phone
        case fee_acknowledged
        case delivery_address
        case items
        case idempotency_key
    }
}

struct DirectOrderAddress: Encodable {
    let label: String
    let address_text: String
    let lat: Double
    let lng: Double
    let plus_code: String?
    let city: String?
    let district: String?
    let description: String?
    let place_images: [String]?

    enum CodingKeys: String, CodingKey {
        case label
        case address_text
        case lat
        case lng
        case plus_code
        case city
        case district
        case description
        case place_images
    }
}

struct DirectOrderItem: Encodable {
    let product_id: String?
    let free_text: String?
    let quantity: Int
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case product_id
        case free_text
        case quantity
        case notes
    }
}

struct DirectOrderResponse: Decodable {
    let success: Bool
    let orderId: String
    let orderNumber: String

    enum CodingKeys: String, CodingKey {
        case success
        case orderId = "orderId"
        case orderNumber = "orderNumber"
    }
}
