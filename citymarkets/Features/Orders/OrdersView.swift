import SwiftUI

struct OrdersView: View {
    @EnvironmentObject private var store: AppStore
    @State private var trackingCode = ""
    @State private var trackingPhone = ""
    @State private var showDirectOrder = false
    @State private var navigationPath: NavigationPath = NavigationPath()

    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                if store.user == nil {
                    guestTrackingSection
                        .listRowBackground(Color.clear)
                } else if store.orders.isEmpty {
                    EmptyState(title: "لا توجد طلبات", subtitle: "ستظهر طلباتك الأخيرة هنا", systemImage: "shippingbox")
                        .listRowBackground(Color.clear)
                } else {
                    if let event = store.liveOrderEvent {
                        Label("تحديث مباشر: \(event.status?.displayName ?? event.event)", systemImage: "dot.radiowaves.left.and.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.cmPrimary)
                    }
                    ForEach(store.orders) { order in
                        NavigationLink(value: order) {
                            OrderSummaryRow(order: order)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle("الطلبات")
            .toolbar {
                if store.user != nil {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button(action: { showDirectOrder = true }) {
                            Image(systemName: "plus.circle.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.cmPrimary)
                        }
                    }
                }
            }
            .navigationDestination(for: Order.self) { order in
                OrderDetailView(order: order)
            }
            .task {
                await store.loadOrders()
                store.startOrderEventStream()
            }
            .onChange(of: store.selectedOrderId) { oldValue, newValue in
                if let orderId = newValue {
                    // Find the order and navigate to chat
                    if let order = store.orders.first(where: { $0.id == orderId }) {
                        navigationPath.append(order)
                    }
                    store.selectedOrderId = nil
                }
            }
            .refreshable { await store.loadOrders() }
            .onDisappear { store.stopOrderEventStream() }
            .sheet(isPresented: $showDirectOrder) {
                DirectOrderView()
            }
        }
    }

    private var guestTrackingSection: some View {
        VStack(alignment: .trailing, spacing: 12) {
            EmptyState(title: "تتبع طلب ضيف", subtitle: "أدخل رقم الطلب ورقم الجوال المستخدم في الطلب", systemImage: "shippingbox.and.arrow.backward")
                .padding(.vertical, 0)
            TextField("رقم الطلب", text: $trackingCode)
                .textInputAutocapitalization(.characters)
                .multilineTextAlignment(.trailing)
                .padding(12)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.cmBorder))
            TextField("آخر 10 أرقام من الجوال", text: $trackingPhone)
                .keyboardType(.phonePad)
                .multilineTextAlignment(.trailing)
                .padding(12)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.cmBorder))
            Button {
                Task { await store.trackGuestOrder(code: trackingCode, phone: trackingPhone) }
            } label: {
                Label("تتبع الطلب", systemImage: "magnifyingglass")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())

            if let order = store.trackedGuestOrder {
                VStack(alignment: .trailing, spacing: 6) {
                    Text(order.statusLabel ?? order.status.displayName)
                        .font(.headline.bold())
                        .foregroundStyle(order.status.tint)
                    if let total = order.total {
                        Text(total.currencyText)
                            .font(.subheadline.weight(.semibold))
                    }
                    if let eta = order.etaMinutes {
                        Text("الوقت المتوقع: \(eta) دقيقة")
                            .font(.caption)
                            .foregroundStyle(Color.cmTextMuted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(14)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(.vertical, 12)
    }
}

private struct OrderSummaryRow: View {
    let order: Order

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(order.displayNumber)
                    .font(.headline)
                    .foregroundStyle(Color.cmText)
                Spacer()
                Text(order.status.displayName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(order.status.tint)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(order.status.tint.opacity(0.12))
                    .clipShape(Capsule())
            }
            Text(order.deliveryAddress ?? order.addressText ?? "عنوان غير محدد")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            HStack {
                Text(order.total.currencyText)
                    .font(.headline)
                    .foregroundStyle(Color.cmPrimary)
                Spacer()
                Label("تفاصيل الطلب", systemImage: "chevron.left")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.cmTextMuted)
            }
        }
        .padding(.vertical, 6)
    }
}

extension Order {
    var displayNumber: String {
        orderNumber ?? "طلب #\(id.prefix(8))"
    }
}

extension OrderStatus {
    var tint: Color {
        switch self {
        case .pending: Color(hex: "F59E0B")
        case .confirmed, .shopping, .onTheWay: Color.cmPrimary
        case .delivered: Color.cmPrimary
        case .cancelled: Color.cmSale
        }
    }
}
