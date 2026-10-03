import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: AppStore
    @State private var selectedTab: MainTab = .home

    var body: some View {
        GeometryReader { proxy in
            TabView(selection: $selectedTab) {
                HomeView()
                    .tabItem { Label("الرئيسية", systemImage: "house") }
                    .tag(MainTab.home)

                CatalogView()
                    .tabItem { Label("المقاضي", systemImage: "square.grid.2x2") }
                    .tag(MainTab.catalog)

                ChefCityView()
                    .tabItem { Label("شيف سيتي", systemImage: "sparkles") }
                    .tag(MainTab.chefCity)

                CartView()
                    .tabItem { Label("السلة", systemImage: "cart") }
                    .badge(store.cartCount)
                    .tag(MainTab.cart)

                AccountView()
                    .tabItem { Label("حسابي", systemImage: "person") }
                    .tag(MainTab.account)
            }
            .tint(.cmPrimary)
            .simultaneousGesture(pageSwipeGesture(screenWidth: proxy.size.width))
        }
        .task {
            await store.bootstrap()
        }
    }

    private func pageSwipeGesture(screenWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 90, coordinateSpace: .local)
            .onEnded { value in
                let horizontal = value.translation.width
                let vertical = value.translation.height
                guard abs(horizontal) > abs(vertical) * 1.35 else { return }

                let edgeWidth: CGFloat = 34
                let startsAtLeadingEdge = value.startLocation.x <= edgeWidth
                let startsAtTrailingEdge = value.startLocation.x >= screenWidth - edgeWidth

                withAnimation(.easeOut(duration: 0.22)) {
                    if horizontal < 0, startsAtTrailingEdge {
                        selectedTab = selectedTab.next
                    } else if horizontal > 0, startsAtLeadingEdge {
                        selectedTab = selectedTab.previous
                    }
                }
            }
    }
}

private enum MainTab: Int, CaseIterable {
    case home
    case catalog
    case chefCity
    case cart
    case account

    var next: MainTab {
        let tabs = Self.allCases
        let nextIndex = min(rawValue + 1, tabs.count - 1)
        return tabs[nextIndex]
    }

    var previous: MainTab {
        let tabs = Self.allCases
        let previousIndex = max(rawValue - 1, 0)
        return tabs[previousIndex]
    }
}

#Preview {
    ContentView()
        .environmentObject(AppStore())
        .environment(\.layoutDirection, .rightToLeft)
}
