import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var store: AppStore
    @State private var phone = ""
    @State private var code = ""
    @State private var didSendCode = false
    @State private var isShowingLocation = false

    private var displayName: String {
        store.user?.name?.nilIfBlank ?? "مستخدم"
    }

    private var displayPhone: String {
        store.user?.phone ?? phone.nilIfBlank ?? "غير محدد"
    }

    private var loyaltyPoints: Int {
        store.user?.loyaltyPoints ?? 0
    }

    private var addressCount: Int {
        store.deliveryLocationTitle == "تحديد الموقع" ? 0 : 1
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomLeading) {
                Color.cmBg.ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        SiteAccountHeader(cartCount: store.cartCount)
                            .environmentObject(store)

                        greenHero

                        VStack(spacing: 20) {
                            profileCard
                                .padding(.top, -64)

                            accountSection
                            ordersSection
                            rewardsSection
                            settingsSection
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, store.cartCount > 0 ? 104 : 28)
                    }
                }

                if store.cartCount > 0 {
                    floatingCart
                        .padding(.leading, 16)
                        .padding(.bottom, 10)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            #if os(iOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
            .sheet(isPresented: $isShowingLocation) {
                LocationSheet()
                    .environmentObject(store)
            }
            .task {
                await store.loadOrders()
                await store.loadCart()
            }
        }
    }

    private var greenHero: some View {
        ZStack(alignment: .topTrailing) {
            Color.cmPrimary
            Text("حسابي")
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(.white)
                .padding(.top, 48)
                .padding(.trailing, 22)
        }
        .frame(height: store.user == nil ? 198 : 245)
    }

    private var profileCard: some View {
        VStack(spacing: 22) {
            if store.user == nil {
                guestLoginBlock
            } else {
                userSummaryBlock
            }

            HStack(spacing: 12) {
                AccountMetricCard(value: "\(store.cartCount)", label: "منتج", tint: Color.cmPrimaryLight, textColor: Color.cmPrimary)
                AccountMetricCard(value: "\(store.orders.count)", label: "طلب", tint: Color(hex: "FFF9E8"), textColor: Color(hex: "DD7A00"))
                AccountMetricCard(value: "\(loyaltyPoints)", label: "نقطة", tint: Color(hex: "EAF7F0"), textColor: Color.cmPrimary)
            }
        }
        .padding(24)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 28))
        .shadow(color: .black.opacity(0.08), radius: 18, x: 0, y: 8)
    }

    private var userSummaryBlock: some View {
        HStack(spacing: 18) {
            Button {} label: {
                Image(systemName: "pencil")
                    .font(.system(size: 23, weight: .medium))
                    .foregroundStyle(Color.cmTextMuted)
                    .frame(width: 68, height: 68)
                    .background(Color(hex: "F3F4F6"))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .buttonStyle(.plain)

            Spacer(minLength: 0)

            VStack(alignment: .trailing, spacing: 8) {
                Text(displayName)
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(Color.cmText)
                Text(displayPhone)
                    .font(.system(size: 18, weight: .medium, design: .monospaced))
                    .foregroundStyle(Color.cmTextMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }

            ZStack {
                LinearGradient(colors: [Color.cmPrimary, Color(hex: "18AA58")], startPoint: .leading, endPoint: .trailing)
                Image(systemName: "plus")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.white)
            }
            .frame(width: 88, height: 88)
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .shadow(color: Color.cmPrimary.opacity(0.22), radius: 16, x: 0, y: 8)
        }
    }

    private var guestLoginBlock: some View {
        VStack(alignment: .trailing, spacing: 14) {
            HStack {
                Image(systemName: "person.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Color.cmPrimary)
                    .frame(width: 70, height: 70)
                    .background(Color.cmPrimaryLight)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                Spacer()
                VStack(alignment: .trailing, spacing: 5) {
                    Text("حسابي")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(Color.cmText)
                    Text("سجّل الدخول لحفظ الطلبات والنقاط")
                        .font(.subheadline)
                        .foregroundStyle(Color.cmTextMuted)
                }
            }

            TextField("رقم الجوال", text: $phone)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .multilineTextAlignment(.trailing)
                .padding(14)
                .background(Color.cmBg)
                .clipShape(RoundedRectangle(cornerRadius: 12))

            if didSendCode {
                TextField("رمز التحقق", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .multilineTextAlignment(.center)
                    .padding(14)
                    .background(Color.cmBg)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            Button {
                Task {
                    if didSendCode {
                        await store.verifyOTP(phone: phone, code: code)
                    } else {
                        didSendCode = await store.sendOTP(phone: phone)
                    }
                }
            } label: {
                Label(didSendCode ? "تحقق" : "إرسال الرمز", systemImage: didSendCode ? "checkmark.shield" : "paperplane")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
        }
    }

    private var accountSection: some View {
        AccountSectionCard(title: "حسابي") {
            AccountNavigationRow(title: "الملف الشخصي", subtitle: displayPhone, icon: "person") {
                ProfileSummaryView(name: displayName, phone: displayPhone, email: store.user?.email)
            }
            AccountNavigationRow(title: "رقم الهاتف", subtitle: displayPhone, icon: "phone") {
                ProfileSummaryView(name: displayName, phone: displayPhone, email: store.user?.email)
            }
            AccountNavigationRow(title: "البريد الإلكتروني", subtitle: store.user?.email ?? "غير محدد", icon: "envelope") {
                ProfileSummaryView(name: displayName, phone: displayPhone, email: store.user?.email)
            }
        }
    }

    private var ordersSection: some View {
        AccountSectionCard(title: "طلباتي") {
            Button {
                isShowingLocation = true
            } label: {
                AccountPlainRow(title: "عناويني", subtitle: store.deliveryLocationTitle, icon: "mappin.circle", badge: addressCount > 0 ? "\(addressCount)" : nil)
            }
            .buttonStyle(.plain)

            AccountNavigationRow(title: "الطلبات", subtitle: nil, icon: "shippingbox", badge: store.orders.isEmpty ? nil : "\(store.orders.count)") {
                OrdersView()
            }
            AccountNavigationRow(title: "المفضلة", subtitle: nil, icon: "heart", badge: nil) {
                EmptyState(title: "المفضلة", subtitle: "ستظهر المنتجات المفضلة عند إضافتها", systemImage: "heart")
            }
            AccountNavigationRow(title: "مراجعاتي", subtitle: nil, icon: "star", badge: nil) {
                EmptyState(title: "مراجعاتي", subtitle: "ستظهر تقييماتك للمنتجات هنا", systemImage: "star")
            }
        }
    }

    private var rewardsSection: some View {
        AccountSectionCard(title: "الولاء والمكافآت") {
            AccountNavigationRow(title: "نقاط الولاء", subtitle: nil, icon: "rosette", badge: loyaltyPoints > 0 ? "\(loyaltyPoints)" : nil) {
                LoyaltySummaryView(points: loyaltyPoints)
            }
            AccountNavigationRow(title: "الرموز الترويجية", subtitle: nil, icon: "gift", badge: nil) {
                EmptyState(title: "الرموز الترويجية", subtitle: "أدخل الرمز الترويجي في صفحة الدفع", systemImage: "gift")
            }
        }
    }

    private var settingsSection: some View {
        AccountSectionCard(title: "الإعدادات") {
            AccountNavigationRow(title: "تصفح المقاضي", subtitle: nil, icon: "square.grid.2x2", badge: nil) {
                CatalogView()
            }
            AccountNavigationRow(title: "شيف سيتي", subtitle: nil, icon: "fork.knife", badge: nil) {
                ChefCityView()
            }
            Button(role: .destructive) {
                Task { await store.logout() }
            } label: {
                AccountPlainRow(title: store.user == nil ? "تسجيل الدخول" : "تسجيل الخروج", subtitle: nil, icon: store.user == nil ? "person.badge.key" : "rectangle.portrait.and.arrow.right", badge: nil)
            }
            .buttonStyle(.plain)
        }
    }

    private var floatingCart: some View {
        NavigationLink {
            CartView()
        } label: {
            HStack(spacing: 10) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "basket")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                    Text("\(store.cartCount)")
                        .font(.caption2.bold())
                        .foregroundStyle(.white)
                        .frame(width: 24, height: 24)
                        .background(Color.cmPrimary)
                        .clipShape(Circle())
                        .offset(x: 6, y: -6)
                }
                VStack(alignment: .trailing, spacing: 2) {
                    Text(store.cartSubtotal.currencyText)
                        .font(.headline.bold())
                    Text("\(store.cartCount) منتج")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.72))
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.cmCartBar)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .shadow(color: .black.opacity(0.18), radius: 12, x: 0, y: 6)
        }
        .buttonStyle(.plain)
    }
}

private struct SiteAccountHeader: View {
    @EnvironmentObject private var store: AppStore
    let cartCount: Int

    var body: some View {
        HStack(spacing: 22) {
            Button {} label: {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(Color.cmTextMuted)
            }
            .buttonStyle(.plain)

            headerIcon("person", selected: true)

            NavigationLink {
                CartView()
            } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "cart")
                        .font(.system(size: 26, weight: .medium))
                        .foregroundStyle(Color.cmTextMuted)
                    if cartCount > 0 {
                        Text("\(cartCount)")
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .frame(width: 23, height: 23)
                            .background(Color(hex: "FF6B1A"))
                            .clipShape(Circle())
                            .offset(x: 10, y: -10)
                    }
                }
                .frame(width: 42, height: 42)
            }
            .buttonStyle(.plain)

            NavigationLink {
                CatalogView()
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(Color.cmTextMuted)
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.plain)

            Spacer(minLength: 8)
            CityMarketsWordmark()
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 22)
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.black.opacity(0.08)).frame(height: 1) }
        .environment(\.layoutDirection, .leftToRight)
    }

    private func headerIcon(_ systemName: String, selected: Bool) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 24, weight: .medium))
            .foregroundStyle(selected ? Color.cmPrimary : Color.cmTextMuted)
            .frame(width: 56, height: 56)
            .background(selected ? Color(hex: "CDEFD9") : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}

private struct CityMarketsWordmark: View {
    var body: some View {
        HStack(spacing: 6) {
            VStack(alignment: .trailing, spacing: 0) {
                Text("CITY MARKETS")
                    .font(.system(size: 13, weight: .bold, design: .condensed))
                Text("أسواق سيتي")
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(Color.cmPrimary)

            ZStack {
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.cmPrimary)
                    .frame(width: 26, height: 36)
                HStack(spacing: 3) {
                    RoundedRectangle(cornerRadius: 2).fill(Color.white.opacity(0.9)).frame(width: 4, height: 24)
                    RoundedRectangle(cornerRadius: 2).fill(Color.white.opacity(0.9)).frame(width: 4, height: 24)
                }
                RoundedRectangle(cornerRadius: 5)
                    .stroke(Color.cmPrimary, lineWidth: 3)
                    .frame(width: 18, height: 14)
                    .offset(y: -23)
            }
        }
        .frame(width: 134, alignment: .trailing)
    }
}

private struct AccountSectionCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            Text(title)
                .font(.system(size: 21, weight: .bold))
                .foregroundStyle(Color.cmText)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.horizontal, 22)
                .padding(.vertical, 18)
                .background(Color(hex: "FAFAFA"))

            VStack(spacing: 0) {
                content
            }
            .background(Color.white)
        }
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.black.opacity(0.04), lineWidth: 1))
        .shadow(color: .black.opacity(0.05), radius: 10, x: 0, y: 4)
    }
}

private struct AccountNavigationRow<Destination: View>: View {
    let title: String
    let subtitle: String?
    let icon: String
    let badge: String?
    let destination: Destination

    init(title: String, subtitle: String? = nil, icon: String, badge: String? = nil, @ViewBuilder destination: () -> Destination) {
        self.title = title
        self.subtitle = subtitle
        self.icon = icon
        self.badge = badge
        self.destination = destination()
    }

    var body: some View {
        NavigationLink(destination: destination) {
            AccountPlainRow(title: title, subtitle: subtitle, icon: icon, badge: badge)
        }
        .buttonStyle(.plain)
    }
}

private struct AccountPlainRow: View {
    let title: String
    let subtitle: String?
    let icon: String
    let badge: String?

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: "chevron.left")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(Color(hex: "9CA3AF"))
                .frame(width: 28)

            if let badge {
                Text(badge)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.cmPrimary)
                    .frame(minWidth: 42, minHeight: 42)
                    .background(Color(hex: "CDEFD9"))
                    .clipShape(Circle())
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 4) {
                Text(title)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(Color.cmText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 17, weight: .medium, design: .monospaced))
                        .foregroundStyle(Color.cmTextMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }

            Image(systemName: icon)
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(Color.cmTextMuted)
                .frame(width: 64, height: 64)
                .background(Color(hex: "F3F4F6"))
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .frame(minHeight: 92)
        .padding(.horizontal, 16)
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.cmBorder).frame(height: 1) }
        .environment(\.layoutDirection, .leftToRight)
    }
}

private struct AccountMetricCard: View {
    let value: String
    let label: String
    let tint: Color
    let textColor: Color

    var body: some View {
        VStack(spacing: 5) {
            Text(value)
                .font(.system(size: 27, weight: .bold))
                .foregroundStyle(textColor)
            Text(label)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Color.cmTextMuted)
        }
        .frame(maxWidth: .infinity, minHeight: 72)
        .background(tint)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

private struct ProfileSummaryView: View {
    let name: String
    let phone: String
    let email: String?

    var body: some View {
        List {
            Section("حسابي") {
                LabeledContent("الاسم", value: name)
                LabeledContent("رقم الجوال", value: phone)
                LabeledContent("البريد الإلكتروني", value: email ?? "غير محدد")
            }
        }
        .navigationTitle("الملف الشخصي")
    }
}

private struct LoyaltySummaryView: View {
    let points: Int

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "rosette")
                .font(.system(size: 56))
                .foregroundStyle(Color.cmPrimary)
            Text("\(points) نقطة")
                .font(.largeTitle.bold())
                .foregroundStyle(Color.cmText)
            Text("نقاط الولاء مرتبطة بحسابك وتظهر حسب بيانات الموقع")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.cmBg)
        .navigationTitle("نقاط الولاء")
    }
}
