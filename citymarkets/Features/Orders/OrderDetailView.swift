import SwiftUI

#if canImport(MoyasarSdk)
import MoyasarSdk
import PassKit
#endif

struct OrderDetailView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.openURL) private var openURL
    let order: Order

    @State private var selectedPayment = "mada"
    @State private var currentPaymentMethod: String?
    @State private var isUpdatingPaymentMethod = false
    @State private var showNativePayment = false

    private var canPayOnline: Bool {
        order.status != .cancelled && order.status != .delivered && order.paymentStatus != "paid"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                orderHeader
                OrderStatusCard(order: order)
                DeliveryInfoCard(order: order)
                OrderProductsCard(order: order)
                OrderSummaryCard(order: order, paymentMethodOverride: currentPaymentMethod)
                if order.status == .delivered {
                    ReviewSubmissionCard(order: order)
                        .environmentObject(store)
                }
                PaymentOptionsCard(
                    selectedPayment: $selectedPayment,
                    canPayOnline: canPayOnline,
                    isUpdatingPaymentMethod: isUpdatingPaymentMethod
                ) {
                    // Payment action area: Apple Pay → native button; others → labelled button
                    if selectedPayment == "apple_pay" {
                        #if canImport(MoyasarSdk)
                        MoyasarDeferredApplePayButton(
                            preparePayment: {
                                guard await updatePaymentMethod("apple_pay") else { return nil }
                                return MoyasarPreparedPayment(
                                    amount: order.total,
                                    orderId: order.id,
                                    description: order.displayNumber,
                                    idempotencyKey: order.idempotencyKey ?? ""
                                )
                            },
                            completion: { message in
                                store.message = message
                                Task { await store.loadOrders() }
                            }
                        )
                        .frame(height: 50)
                        .disabled(!canPayOnline || isUpdatingPaymentMethod)
                        #else
                        payButton
                        #endif
                    } else {
                        payButton
                    }
                }
            }
            .padding(16)
        }
        .background(Color.cmBg.ignoresSafeArea())
        .navigationTitle("تفاصيل الطلب")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            selectedPayment = order.paymentMethod?.nilIfBlank ?? "mada"
            currentPaymentMethod = order.paymentMethod
        }
        .onChange(of: selectedPayment) { _, method in
            guard canPayOnline, currentPaymentMethod != method else { return }
            Task { await updatePaymentMethod(method) }
        }
        .sheet(isPresented: $showNativePayment) {
            MoyasarPaymentSheet(
                paymentMethod: selectedPayment,
                amount: order.total,
                orderId: order.id,
                description: order.displayNumber
            ) { _ in }
        }
    }

    private var payButton: some View {
        Button {
            Task { await startPayment() }
        } label: {
            Label(
                isUpdatingPaymentMethod ? "جاري تحديث طريقة الدفع" : selectedPayment == "cash" ? "إرسال الطلب" : "ادفع",
                systemImage: selectedPayment == "cash" ? "shippingbox.fill" : "lock.fill"
            )
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(!canPayOnline || isUpdatingPaymentMethod)
        .opacity(canPayOnline && !isUpdatingPaymentMethod ? 1 : 0.55)
    }

    private func startPayment() async {
        guard await updatePaymentMethod(selectedPayment) else { return }

        if selectedPayment == "cash" {
            store.message = "تم تحديث طريقة الدفع إلى الدفع عند الاستلام"
            return
        }

        // apple_pay is handled directly by MoyasarDeferredApplePayButton — no sheet needed.
        if selectedPayment == "apple_pay" { return }

        if let url = await store.paymentURL(for: order) {
            openURL(url)
        } else {
            showNativePayment = true
        }
    }

    @discardableResult
    private func updatePaymentMethod(_ method: String) async -> Bool {
        guard currentPaymentMethod != method else { return true }
        guard !isUpdatingPaymentMethod else { return false }
        isUpdatingPaymentMethod = true
        defer { isUpdatingPaymentMethod = false }

        let updated = await store.updateOrderPaymentMethod(
            orderId: order.id,
            paymentMethod: method,
            idempotencyKey: order.idempotencyKey
        )
        if updated {
            currentPaymentMethod = method
        }
        return updated
    }

    private var orderHeader: some View {
        HStack(spacing: 12) {
            Image(systemName: "shippingbox.fill")
                .font(.title3.weight(.bold))
                .foregroundStyle(Color.cmPrimary)
                .frame(width: 42, height: 42)
                .background(Color.cmPrimaryLight)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 4) {
                Text(order.displayNumber)
                    .font(.headline.bold())
                    .foregroundStyle(Color.cmText)
                // Date row: icon + formatted date string
                Label(order.formattedCreatedAt, systemImage: "calendar.badge.clock")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.cmTextMuted)
            }

            Spacer()

            Text(order.status.displayName)
                .font(.caption.weight(.bold))
                .foregroundStyle(order.status.tint)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(order.status.tint.opacity(0.12))
                .clipShape(Capsule())
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.cmBorder, lineWidth: 1))
    }
}

// MARK: - Order date formatting

private extension Order {
    var formattedCreatedAt: String {
        guard let raw = createdAt?.nilIfBlank else { return "—" }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = iso.date(from: raw)
        if date == nil {
            iso.formatOptions = [.withInternetDateTime]
            date = iso.date(from: raw)
        }
        guard let date else { return raw }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "ar_SA")
        fmt.timeZone = TimeZone(identifier: "Asia/Riyadh")
        fmt.dateFormat = "EEEE، d MMM yyyy  •  h:mm a"
        return fmt.string(from: date)
    }
}

// MARK: - Sub-views

private struct OrderStatusCard: View {
    let order: Order

    private let steps: [OrderStatus] = [.pending, .confirmed, .shopping, .onTheWay, .delivered]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("حالة الطلب")
                    .font(.headline.bold())
                Spacer()
                Label(order.status.displayName, systemImage: order.status == .cancelled ? "xmark.circle.fill" : "clock.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(order.status.tint)
            }

            HStack(spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.element.rawValue) { index, status in
                    StatusStep(status: status, isActive: isStepActive(status), isCurrent: status == order.status)
                    if index < steps.count - 1 {
                        Rectangle()
                            .fill(isConnectorActive(after: status) ? Color.cmPrimary.opacity(0.45) : Color.cmBorder)
                            .frame(height: 3)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(.top, 4)
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.cmBorder, lineWidth: 1))
    }

    private func isStepActive(_ status: OrderStatus) -> Bool {
        guard order.status != .cancelled,
              let current = steps.firstIndex(of: order.status),
              let candidate = steps.firstIndex(of: status) else { return false }
        return candidate <= current
    }

    private func isConnectorActive(after status: OrderStatus) -> Bool {
        guard let index = steps.firstIndex(of: status), index + 1 < steps.count else { return false }
        return isStepActive(steps[index + 1])
    }
}

private struct StatusStep: View {
    let status: OrderStatus
    let isActive: Bool
    let isCurrent: Bool

    var body: some View {
        VStack(spacing: 7) {
            Image(systemName: isActive ? "checkmark" : status.iconName)
                .font(.caption.weight(.bold))
                .foregroundStyle(isActive ? Color.white : Color.cmTextMuted)
                .frame(width: 34, height: 34)
                .background(isActive ? Color.cmPrimary : Color.cmBg)
                .clipShape(Circle())
                .overlay(Circle().stroke(isCurrent ? Color.cmPrimary : Color.cmBorder, lineWidth: isCurrent ? 2 : 1))

            Text(status.displayName)
                .font(.caption2.weight(isCurrent ? .bold : .regular))
                .foregroundStyle(isCurrent ? Color.cmPrimary : Color.cmTextMuted)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(width: 58, height: 30, alignment: .top)
        }
    }
}

private struct DeliveryInfoCard: View {
    let order: Order

    var body: some View {
        DetailCard(title: "معلومات التوصيل") {
            InfoLine(title: "العنوان", value: order.deliveryAddress ?? order.addressText ?? "عنوان غير محدد", systemImage: "mappin.circle.fill", tint: Color.cmPrimary)
            Divider()
            InfoLine(title: "موعد التوصيل", value: deliveryEstimate, systemImage: "clock.fill", tint: Color(hex: "3B82F6"))
        }
    }

    private var deliveryEstimate: String {
        switch order.status {
        case .delivered: "تم التوصيل"
        case .cancelled: "الطلب ملغي"
        default: "متوقع خلال 30-45 دقيقة"
        }
    }
}

private struct OrderProductsCard: View {
    let order: Order

    var body: some View {
        DetailCard(title: "المنتجات (\(order.items?.count ?? 0))") {
            if let items = order.items, !items.isEmpty {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    OrderItemRow(item: item)
                    if index < items.count - 1 { Divider() }
                }
            } else {
                Text("لا توجد تفاصيل منتجات لهذا الطلب")
                    .font(.subheadline)
                    .foregroundStyle(Color.cmTextMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

private struct OrderItemRow: View {
    let item: OrderItem

    var body: some View {
        HStack(spacing: 12) {
            ProductImage(url: item.absoluteImageURL, height: 58)
                .frame(width: 58)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 5) {
                Text(item.nameAr ?? "منتج")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.cmText)
                    .lineLimit(2)
                Text("الكمية: \(item.quantity)")
                    .font(.caption)
                    .foregroundStyle(Color.cmTextMuted)
            }

            Spacer()

            Text((item.total ?? ((item.price ?? 0) * Double(item.quantity))).currencyText)
                .font(.subheadline.bold())
                .foregroundStyle(Color.cmPrimary)
        }
        .padding(.vertical, 6)
    }
}

private struct OrderSummaryCard: View {
    let order: Order
    let paymentMethodOverride: String?

    var body: some View {
        DetailCard(title: "ملخص الطلب") {
            SummaryLine(title: "طريقة الدفع", value: paymentMethodText)
            SummaryLine(title: "حالة الدفع", value: paymentStatusText)
            if let subtotal = order.subtotal {
                SummaryLine(title: "قيمة المنتجات", value: subtotal.currencyText)
            }
            if let deliveryFee = order.deliveryFee {
                SummaryLine(title: "رسوم التوصيل", value: deliveryFee.currencyText)
            }
            if let discount = order.discount, discount > 0 {
                SummaryLine(title: "الخصم", value: "-\(discount.currencyText)")
            }
            Divider()
            SummaryLine(title: "المجموع", value: order.total.currencyText, isTotal: true)
        }
    }

    private var paymentMethodText: String {
        switch paymentMethodOverride ?? order.paymentMethod {
        case "cash": "الدفع عند الاستلام"
        case "mada": "مدى"
        case "visa": "فيزا"
        case "mastercard": "ماستركارد"
        case "apple_pay": "Apple Pay"
        case .some(let value): value
        case .none: "غير محدد"
        }
    }

    private var paymentStatusText: String {
        switch order.paymentStatus {
        case "paid": "مدفوع"
        case "failed": "فشل الدفع"
        case "refunded": "مسترد"
        case "pending", .none: "قيد المعالجة"
        case .some(let value): value
        }
    }
}

private struct ReviewSubmissionCard: View {
    @EnvironmentObject private var store: AppStore
    let order: Order
    @State private var storeRating = 5
    @State private var driverRating = 5
    @State private var comment = ""
    @State private var isSending = false

    var body: some View {
        DetailCard(title: "تقييم الطلب") {
            Stepper("تقييم المتجر: \(storeRating)", value: $storeRating, in: 1...5)
            Stepper("تقييم التوصيل: \(driverRating)", value: $driverRating, in: 1...5)
            TextField("ملاحظتك", text: $comment, axis: .vertical)
                .lineLimit(2...4)
                .padding(10)
                .background(Color.cmBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            Button {
                Task {
                    isSending = true
                    _ = await store.createReview(orderId: order.id, storeRating: storeRating, driverRating: driverRating, comment: comment)
                    isSending = false
                }
            } label: {
                Label(isSending ? "جار الإرسال" : "إرسال التقييم", systemImage: "star.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(isSending)
        }
    }
}

// PaymentOptionsCard uses a generic @ViewBuilder for the action area so callers
// can inject either a native PKPaymentButton or a regular labelled button.
private struct PaymentOptionsCard<ActionView: View>: View {
    @Binding var selectedPayment: String
    let canPayOnline: Bool
    let isUpdatingPaymentMethod: Bool
    @ViewBuilder let actionView: () -> ActionView

    private let options = [
        PaymentOption(id: "apple_pay", title: "Apple Pay", subtitle: "الأسرع للدفع", systemImage: "apple.logo", assetName: nil, tint: Color.cmText),
        PaymentOption(id: "mada", title: "مدى", subtitle: "بطاقات مدى", systemImage: "creditcard.fill", assetName: "PaymentMada", tint: Color.cmPrimary),
        PaymentOption(id: "visa", title: "فيزا", subtitle: "3D Secure", systemImage: "creditcard", assetName: "PaymentVisa", tint: Color(hex: "2563EB")),
        PaymentOption(id: "mastercard", title: "ماستركارد", subtitle: "3D Secure", systemImage: "creditcard", assetName: "PaymentMastercard", tint: Color(hex: "DC2626")),
        PaymentOption(id: "cash", title: "الدفع عند الاستلام", subtitle: "نقداً عند الاستلام", systemImage: "banknote", assetName: nil, tint: Color(hex: "64748B"))
    ]

    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("اختر طريقة الدفع", systemImage: "creditcard")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.cmTextMuted)

            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(options) { option in
                    Button {
                        selectedPayment = option.id
                    } label: {
                        OrderPaymentOption(option: option, isSelected: selectedPayment == option.id)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canPayOnline || isUpdatingPaymentMethod)
                }
            }

            actionView()
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.cmBorder, lineWidth: 1))
    }
}

private struct PaymentOption: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let systemImage: String
    let assetName: String?
    let tint: Color
}

private struct OrderPaymentOption: View {
    let option: PaymentOption
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(isSelected ? Color.cmPrimary : Color.cmBorder)
                Spacer(minLength: 0)
            }

            paymentMark
                .frame(height: 34)

            Text(option.title)
                .font(.caption.weight(.bold))
                .foregroundStyle(isSelected ? Color.cmPrimary : Color.cmText)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(height: 96)
        .background(isSelected ? Color.cmPrimary.opacity(0.07) : Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(isSelected ? Color.cmPrimary : Color.cmBorder, lineWidth: isSelected ? 1.6 : 1)
        )
    }

    @ViewBuilder
    private var paymentMark: some View {
        if option.id == "apple_pay" {
            Image(systemName: "apple.logo")
                .font(.system(size: 23, weight: .semibold))
                .foregroundStyle(Color.cmText)
                .frame(width: 54, height: 40)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.cmBorder.opacity(0.65), lineWidth: 1))
        } else if let assetName = option.assetName {
            Image(assetName)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 44, maxHeight: 34)
                .frame(width: 78, height: 40)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.cmBorder.opacity(0.65), lineWidth: 1))
        } else {
            Image(systemName: option.systemImage)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(option.tint)
                .frame(width: 54, height: 40)
                .background(option.tint.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
}

private struct DetailCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline.bold())
                .foregroundStyle(Color.cmText)
            content
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.cmBorder, lineWidth: 1))
    }
}

private struct InfoLine: View {
    let title: String
    let value: String
    let systemImage: String
    let tint: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.headline)
                .foregroundStyle(tint)
                .frame(width: 36, height: 36)
                .background(tint.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(Color.cmTextMuted)
                Text(value)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.cmText)
                    .lineLimit(3)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct SummaryLine: View {
    let title: String
    let value: String
    var isTotal = false

    var body: some View {
        HStack {
            Text(title)
                .font(isTotal ? .headline : .subheadline)
                .foregroundStyle(isTotal ? Color.cmText : Color.cmTextMuted)
            Spacer()
            Text(value)
                .font(isTotal ? .headline.bold() : .subheadline.weight(.semibold))
                .foregroundStyle(isTotal ? Color.cmPrimary : Color.cmText)
        }
    }
}

private extension OrderStatus {
    var iconName: String {
        switch self {
        case .pending: "clock"
        case .confirmed: "checkmark"
        case .shopping: "arrow.triangle.2.circlepath"
        case .onTheWay: "truck.box"
        case .delivered: "checkmark"
        case .cancelled: "xmark"
        }
    }
}
