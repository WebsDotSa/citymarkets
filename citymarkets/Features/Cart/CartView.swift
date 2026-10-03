import MapKit
import SwiftUI

struct CartView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.openURL) private var openURL

    @State private var name = ""
    @State private var phone = ""
    @State private var notes = ""
    @State private var selectedPaymentMethod = "apple_pay"
    @State private var showLoginPrompt = false
    @State private var showNativePayment = false
    @State private var showAddressSheet = false
    @State private var isCheckingOut = false
    @State private var isReviewingOrder = false
    @State private var paymentSheetAmount = 0.0
    @State private var paymentSheetOrderId = ""
    @State private var paymentSheetDescription = "طلب أسواق سيتي"

    private let deliveryFee = 0.0

    private var paymentMethods: [CheckoutPaymentMethod] {
        [
            CheckoutPaymentMethod(id: "apple_pay", title: "Apple Pay", subtitle: "الأسرع للدفع", systemImage: "apple.logo", tint: Color.cmText, isMoyasar: true),
            CheckoutPaymentMethod(id: "mada", title: "مدى", subtitle: "بطاقات مدى", systemImage: "creditcard.fill", tint: Color.cmPrimary, isMoyasar: true),
            CheckoutPaymentMethod(id: "stc_pay", title: "STC Pay", subtitle: "محفظة الجوال", systemImage: "iphone", tint: Color(hex: "6D28D9"), isMoyasar: true),
            CheckoutPaymentMethod(id: "visa", title: "فيزا", subtitle: "3D Secure", systemImage: "creditcard", tint: Color(hex: "2563EB"), isMoyasar: true),
            CheckoutPaymentMethod(id: "mastercard", title: "ماستركارد", subtitle: "3D Secure", systemImage: "creditcard", tint: Color(hex: "DC2626"), isMoyasar: true),
            CheckoutPaymentMethod(id: "cash", title: "نقداً", subtitle: "عند الاستلام", systemImage: "banknote", tint: Color(hex: "64748B"), isMoyasar: false)
        ]
    }

    private var selectedPayment: CheckoutPaymentMethod {
        paymentMethods.first { $0.id == selectedPaymentMethod } ?? paymentMethods[0]
    }

    private var checkoutTotal: Double {
        store.cartSubtotal + deliveryFee
    }

    private var selectedAddress: Address? {
        store.selectedAddress
    }

    private var suggestedProducts: [Product] {
        let cartProductIds = Set(store.cartItems.map(\.productId))
        return store.featuredProducts.filter { !cartProductIds.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Color.cmBg.ignoresSafeArea()

                if store.cartItems.isEmpty {
                    EmptyState(title: "السلة فارغة", subtitle: "أضف منتجات من المقاضي لبدء الطلب", systemImage: "cart")
                        .padding(.horizontal, 24)
                } else if isReviewingOrder {
                    reviewContent
                } else {
                    cartContent
                }

                if !store.cartItems.isEmpty {
                    bottomActionBar
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .task { await store.loadAddresses() }
            .refreshable {
                await store.loadCart()
                await store.loadAddresses()
            }
            .sheet(isPresented: $showLoginPrompt) {
                PhoneLoginSheet(isPresented: $showLoginPrompt)
            }
            .sheet(isPresented: $showNativePayment) {
                MoyasarPaymentSheet(
                    paymentMethod: selectedPaymentMethod,
                    amount: paymentSheetAmount,
                    orderId: paymentSheetOrderId,
                    description: paymentSheetDescription
                ) { _ in }
            }
            .sheet(isPresented: $showAddressSheet) {
                LocationSheet()
                    .environmentObject(store)
            }
            .onChange(of: store.cartItems.isEmpty) { _, isEmpty in
                if isEmpty { isReviewingOrder = false }
            }
        }
    }

    private var cartContent: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 18) {
                cartHeader
                completionBanner
                if !suggestedProducts.isEmpty { suggestedProductsRail(title: "منتجات تكمل سلتك!") }
                cartItemsSection
                if !suggestedProducts.isEmpty { suggestedProductsRail(title: "منتجات مقترحة") }
            }
            .padding(.bottom, 118)
        }
    }

    private var reviewContent: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                reviewHeader
                deliveryReviewSection
                deliveryTimeSection
                if store.user == nil { guestContactSection }
                orderNotesSection
                paymentReviewSection
                couponSection
                reviewSummarySection
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 128)
        }
    }

    private var cartHeader: some View {
        HStack(alignment: .top) {
            Button {
                Task { await store.clearCart() }
            } label: {
                Label("حذف الكل", systemImage: "trash")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.cmTextMuted)
            }
            .buttonStyle(.plain)
            .opacity(store.cartItems.isEmpty ? 0 : 1)

            Spacer()

            VStack(spacing: 4) {
                Text("السلة")
                    .font(.title2.bold())
                    .foregroundStyle(Color.cmText)
                Text("\(store.cartItems.count) منتجات")
                    .font(.caption)
                    .foregroundStyle(Color.cmTextMuted)
            }

            Spacer()

            Button {} label: {
                Image(systemName: "chevron.right")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(Color.cmText)
                    .frame(width: 38, height: 38)
                    .background(Color.white)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .opacity(0.75)
        }
        .padding(.horizontal, 22)
        .padding(.top, 12)
    }

    private var reviewHeader: some View {
        HStack {
            Button { isReviewingOrder = false } label: {
                Image(systemName: "chevron.right")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(Color.cmText)
                    .frame(width: 38, height: 38)
                    .background(Color.white)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Color.cmBorder))
            }
            .buttonStyle(.plain)

            Spacer()
            Text("مراجعة الطلب")
                .font(.title3.bold())
                .foregroundStyle(Color.cmText)
            Spacer()
            Color.clear.frame(width: 38, height: 38)
        }
        .padding(.top, 12)
    }

    private var completionBanner: some View {
        ZStack(alignment: .trailing) {
            LinearGradient(
                colors: [Color(hex: "FFF7E8"), Color(hex: "FFFDF6")],
                startPoint: .leading,
                endPoint: .trailing
            )
            HStack(spacing: 12) {
                ForEach(store.cartItems.prefix(3)) { item in
                    ProductImage(url: item.absoluteImageURL, height: 84)
                        .frame(width: 92)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                Spacer(minLength: 0)
                Text("منتجات\nتكمل سلتك!")
                    .font(.title2.bold())
                    .foregroundStyle(Color(hex: "D85F1B"))
                    .multilineTextAlignment(.trailing)
                    .padding(.trailing, 18)
            }
            .padding(.horizontal, 14)
        }
        .frame(height: 142)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.horizontal, 16)
    }

    private func suggestedProductsRail(title: String) -> some View {
        VStack(alignment: .trailing, spacing: 10) {
            Text(title)
                .font(.headline.bold())
                .foregroundStyle(Color.cmText)
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(suggestedProducts.prefix(10)) { product in
                        CompactCartProductCard(product: product)
                            .environmentObject(store)
                            .frame(width: 118)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private var cartItemsSection: some View {
        VStack(alignment: .trailing, spacing: 16) {
            HStack {
                Button {
                    Task { await store.clearCart() }
                } label: {
                    Label("حذف الكل", systemImage: "trash")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.cmTextMuted)
                }
                .buttonStyle(.plain)

                Spacer()
                Label("المنتجات في السلة", systemImage: "cart")
                    .font(.headline.bold())
                    .foregroundStyle(Color.cmText)
            }

            VStack(spacing: 0) {
                ForEach(Array(store.cartItems.enumerated()), id: \.element.id) { index, item in
                    CartItemReviewRow(item: item)
                        .environmentObject(store)
                    if index < store.cartItems.count - 1 {
                        Divider().padding(.leading, 92)
                    }
                }
            }
        }
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .padding(.horizontal, 16)
    }

    private var deliveryReviewSection: some View {
        VStack(spacing: 0) {
            mapPreview

            Button { showAddressSheet = true } label: {
                HStack(spacing: 12) {
                    Image(systemName: "mappin.circle.fill")
                        .font(.title2)
                        .foregroundStyle(Color.cmText)
                    VStack(alignment: .trailing, spacing: 5) {
                        Text(selectedAddress?.typeName ?? "عنوان التوصيل")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.cmText)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .overlay(Capsule().stroke(Color.cmTextMuted.opacity(0.45)))
                        Text(deliverySubtitle)
                            .font(.subheadline)
                            .foregroundStyle(Color.cmText)
                            .multilineTextAlignment(.trailing)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }
                .padding(16)
                .background(Color.white)
            }
            .buttonStyle(.plain)

            Button { showAddressSheet = true } label: {
                HStack {
                    Image(systemName: "chevron.left")
                        .foregroundStyle(Color.cmTextMuted)
                    Spacer()
                    Text("تعليمات للسائق")
                        .font(.subheadline)
                        .foregroundStyle(Color.cmText)
                    Text("تساعدنا نوصل أسرع!")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color(hex: "64751E"))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(Color(hex: "F3F8C9"))
                        .clipShape(Capsule())
                }
                .padding(14)
                .background(Color.white)
                .overlay(Rectangle().fill(Color.cmBorder).frame(height: 1), alignment: .top)
            }
            .buttonStyle(.plain)
        }
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.cmBorder))
    }

    @ViewBuilder
    private var mapPreview: some View {
        if let lat = selectedAddress?.lat, let lng = selectedAddress?.lng {
            Map(position: .constant(.region(MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
            ))))
            .frame(height: 124)
            .allowsHitTesting(false)
        } else {
            ZStack(alignment: .bottomTrailing) {
                Color(hex: "E9EEF2")
                Image(systemName: "map.fill")
                    .font(.system(size: 46))
                    .foregroundStyle(Color.cmTextMuted.opacity(0.35))
                    .padding(18)
            }
            .frame(height: 124)
        }
    }

    private var deliveryTimeSection: some View {
        VStack(alignment: .trailing, spacing: 12) {
            Text("فترة التوصيل")
                .font(.headline.bold())
                .foregroundStyle(Color.cmText)

            DeliveryTimeOption(
                title: "توصيل فوري",
                subtitle: "خلال 30-45 دقيقة",
                badge: "جديد",
                systemImage: "bolt.fill",
                isSelected: true
            )

            DeliveryTimeOption(
                title: "جدولة الطلب",
                subtitle: "حدد التاريخ والوقت",
                badge: nil,
                systemImage: "calendar",
                isSelected: false
            )
        }
    }

    private var guestContactSection: some View {
        ReviewSection(title: "بيانات المستلم") {
            CheckoutTextField(title: "الاسم", text: $name, systemImage: "person.fill", keyboardType: .default)
            CheckoutTextField(title: "رقم الجوال", text: $phone, systemImage: "phone.fill", keyboardType: .phonePad)
        }
    }

    private var orderNotesSection: some View {
        ReviewSection(title: "ملاحظات الطلب") {
            CheckoutTextEditor(title: "أضف ملاحظة للسائق أو المتجر", text: $notes)
        }
    }

    private var paymentReviewSection: some View {
        VStack(alignment: .trailing, spacing: 12) {
            Text("طريقة الدفع")
                .font(.headline.bold())
                .foregroundStyle(Color.cmText)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(paymentMethods) { method in
                        ReviewPaymentOption(method: method, isSelected: selectedPaymentMethod == method.id) {
                            selectedPaymentMethod = method.id
                        }
                        .frame(width: 126)
                    }
                }
                .padding(.horizontal, 1)
            }
        }
    }

    private var couponSection: some View {
        HStack(spacing: 12) {
            Button {} label: {
                Label("تطبيق الخصم", systemImage: "plus")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color(hex: "0D8B9A"))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(Color.white)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(Color(hex: "0D8B9A")))
            }
            .buttonStyle(.plain)

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Label("الخصومات والقسائم", systemImage: "ticket.fill")
                    .font(.subheadline.bold())
                    .foregroundStyle(Color(hex: "0D8B9A"))
                Text("بإمكانك إضافة قسيمة شرائية أو خصم")
                    .font(.caption)
                    .foregroundStyle(Color.cmText)
            }
        }
        .padding(14)
        .background(Color(hex: "EAFBFA"))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "17A5B5"), lineWidth: 1))
    }

    private var reviewSummarySection: some View {
        VStack(alignment: .trailing, spacing: 12) {
            Text("الملخص (\(store.cartItems.count) منتجات)")
                .font(.headline.bold())
                .foregroundStyle(Color.cmText)

            VStack(spacing: 10) {
                ForEach(store.cartItems) { item in
                    HStack {
                        Text(item.total.currencyText)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.cmText)
                        Spacer()
                        Text("x\(item.quantity) \(item.nameAr)")
                            .font(.subheadline)
                            .foregroundStyle(Color.cmText)
                            .lineLimit(1)
                    }
                }
                Divider()
                SummaryLine(title: "قيمة المنتجات", value: store.cartSubtotal.currencyText)
                SummaryLine(title: "رسوم التوصيل", value: deliveryFee == 0 ? "تحدد لاحقاً" : deliveryFee.currencyText)
                SummaryLine(title: "طريقة الدفع", value: selectedPayment.title)
                SummaryLine(title: "الإجمالي", value: checkoutTotal.currencyText, isTotal: true)
            }
            .padding(14)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private var bottomActionBar: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(checkoutTotal.currencyText)
                    .font(.headline.bold())
                    .foregroundStyle(.white)
                    .monospacedDigit()
                Text(isReviewingOrder ? selectedPayment.title : "\(store.cartCount) منتجات")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.8))
            }

            Spacer()

            Button {
                if isReviewingOrder {
                    Task { await completeCheckout() }
                } else {
                    isReviewingOrder = true
                }
            } label: {
                HStack(spacing: 10) {
                    if isCheckingOut {
                        ProgressView().tint(Color(hex: "1293A3"))
                    } else {
                        Text(isReviewingOrder ? checkoutButtonTitle : "الانتقال للدفع")
                            .font(.headline.weight(.bold))
                        Text("\(store.cartCount)")
                            .font(.subheadline.bold())
                            .foregroundStyle(Color(hex: "1293A3"))
                            .frame(width: 32, height: 32)
                            .background(Color.white)
                            .clipShape(Circle())
                    }
                }
                .foregroundStyle(.white)
            }
            .buttonStyle(.plain)
            .disabled(isCheckingOut)
        }
        .padding(.horizontal, 18)
        .frame(height: 64)
        .background(Color(hex: "1293A3"))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .shadow(color: .black.opacity(0.14), radius: 12, x: 0, y: 6)
    }

    private var deliverySubtitle: String {
        if let selectedAddress, !selectedAddress.displayDetails.isEmpty {
            return selectedAddress.displayDetails
        }
        return "اختر عنوانك من الصفحة الرئيسية أو أكمل بالعنوان الحالي"
    }

    private var checkoutButtonTitle: String {
        selectedPaymentMethod == "cash" ? "إتمام نقداً" : "الدفع الآن"
    }

    private func completeCheckout() async {
        guard !isCheckingOut else { return }
        isCheckingOut = true
        let amountBeforeCheckout = checkoutTotal
        let description = "طلب أسواق سيتي - \(selectedPayment.title)"
        defer { isCheckingOut = false }

        if selectedPaymentMethod == "cash" {
            await store.createCashCheckout(name: name, phone: phone, notes: notes)
            return
        }

        guard let response = await store.createCheckout(name: name, phone: phone, notes: notes, paymentMethod: selectedPaymentMethod) else {
            return
        }

        if let paymentUrl = response.paymentUrl, let url = URL(string: paymentUrl) {
            openURL(url)
            return
        }

        paymentSheetAmount = response.total ?? amountBeforeCheckout
        paymentSheetOrderId = response.parentOrderId ?? "cart-\(UUID().uuidString)"
        paymentSheetDescription = description
        showNativePayment = true
    }
}

private struct CheckoutPaymentMethod: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color
    let isMoyasar: Bool
}

private struct CartItemReviewRow: View {
    @EnvironmentObject private var store: AppStore
    let item: CartItem

    var body: some View {
        HStack(spacing: 14) {
            CartQuantityStepper(item: item)
                .environmentObject(store)

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 6) {
                Text(item.nameAr)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color.cmText)
                    .lineLimit(2)
                if let vendorName = item.vendorName, !vendorName.isEmpty {
                    Text(vendorName)
                        .font(.caption)
                        .foregroundStyle(Color.cmTextMuted)
                        .lineLimit(1)
                }
                HStack(spacing: 8) {
                    if let discount = item.discountPrice, discount < item.price {
                        Text(item.price.currencyText)
                            .font(.caption)
                            .foregroundStyle(Color.cmTextMuted)
                            .strikethrough()
                    }
                    Text((item.effectivePrice ?? item.price).currencyText)
                        .font(.subheadline.bold())
                        .foregroundStyle(Color.cmSale)
                }
            }

            ProductImage(url: item.absoluteImageURL, height: 72)
                .frame(width: 72)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .padding(.vertical, 14)
    }
}

private struct CartQuantityStepper: View {
    @EnvironmentObject private var store: AppStore
    let item: CartItem

    var body: some View {
        HStack(spacing: 18) {
            Button {
                Task { await store.updateCartItem(item, quantity: max(item.quantity - 1, 0)) }
            } label: {
                Image(systemName: item.quantity <= 1 ? "trash" : "minus")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(item.quantity <= 1 ? Color.cmTextMuted : Color.cmText)
            }
            .buttonStyle(.plain)

            Text("\(item.quantity)")
                .font(.headline.monospacedDigit().weight(.bold))
                .foregroundStyle(Color.cmText)
                .frame(minWidth: 22)

            Button {
                Task { await store.updateCartItem(item, quantity: item.quantity + 1) }
            } label: {
                Image(systemName: "plus")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color.cmText)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .frame(height: 42)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.cmBorder))
    }
}

private struct CompactCartProductCard: View {
    @EnvironmentObject private var store: AppStore
    let product: Product

    var body: some View {
        VStack(spacing: 6) {
            ZStack(alignment: .bottomTrailing) {
                ProductImage(url: product.absoluteImageURL, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                Button {
                    Task { await store.addToCart(product) }
                } label: {
                    Image(systemName: "plus")
                        .font(.caption.bold())
                        .foregroundStyle(Color(hex: "0D8B9A"))
                        .frame(width: 28, height: 28)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: "0D8B9A")))
                }
                .buttonStyle(.plain)
                .offset(x: 4, y: 4)
            }

            Text(product.nameAr)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.cmText)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(height: 34)

            Text(product.effectivePrice.currencyText)
                .font(.caption.bold())
                .foregroundStyle(Color.cmSale)
        }
        .padding(8)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

private struct DeliveryTimeOption: View {
    let title: String
    let subtitle: String
    let badge: String?
    let systemImage: String
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                .font(.title3)
                .foregroundStyle(isSelected ? Color.cmText : Color.cmBorder)

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 5) {
                HStack(spacing: 8) {
                    Image(systemName: systemImage)
                        .foregroundStyle(Color(hex: "FFB000"))
                    Text(title)
                        .font(.headline.bold())
                    if let badge {
                        Text(badge)
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(Color(hex: "FF9F1A"))
                            .clipShape(Capsule())
                    }
                }
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(Color.cmTextMuted)
            }
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(isSelected ? Color.cmText : Color.cmBorder, lineWidth: isSelected ? 1.2 : 1))
    }
}

private struct ReviewPaymentOption: View {
    let method: CheckoutPaymentMethod
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                HStack {
                    Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                        .font(.subheadline)
                        .foregroundStyle(isSelected ? Color.cmText : Color.cmBorder)
                    Spacer()
                }
                HStack(spacing: 6) {
                    Image(systemName: method.systemImage)
                        .font(.headline.weight(.semibold))
                    Text(method.title)
                        .font(.subheadline.bold())
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }
                .foregroundStyle(method.tint)
            }
            .padding(12)
            .frame(height: 78)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(isSelected ? Color.cmText : Color.cmBorder, lineWidth: isSelected ? 1.4 : 1))
        }
        .buttonStyle(.plain)
    }
}

private struct ReviewSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            Text(title)
                .font(.headline.bold())
                .foregroundStyle(Color.cmText)
            VStack(spacing: 10) { content }
                .padding(14)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }
}

private struct CheckoutTextField: View {
    let title: String
    @Binding var text: String
    let systemImage: String
    let keyboardType: UIKeyboardType

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(Color.cmTextMuted)
                .frame(width: 22)
            TextField(title, text: $text)
                .keyboardType(keyboardType)
                .textInputAutocapitalization(.never)
                .multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .background(Color.cmBg)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.cmBorder, lineWidth: 1))
    }
}

private struct CheckoutTextEditor: View {
    let title: String
    @Binding var text: String

    var body: some View {
        TextField(title, text: $text, axis: .vertical)
            .lineLimit(2...4)
            .multilineTextAlignment(.trailing)
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .background(Color.cmBg)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.cmBorder, lineWidth: 1))
    }
}

private struct SummaryLine: View {
    let title: String
    let value: String
    var isTotal = false

    var body: some View {
        HStack {
            Text(value)
                .font(isTotal ? .headline.bold() : .subheadline.weight(.semibold))
                .foregroundStyle(isTotal ? Color.cmPrimary : Color.cmText)
            Spacer()
            Text(title)
                .font(isTotal ? .headline : .subheadline)
                .foregroundStyle(isTotal ? Color.cmText : Color.cmTextMuted)
        }
    }
}
