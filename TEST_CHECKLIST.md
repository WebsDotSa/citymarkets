# iOS App Testing Checklist — Direct Order + Full Compatibility

## 🛠️ Build & Setup

```bash
# Clone the repo
git clone https://github.com/WebsDotSa/citymarkets.git
cd citymarkets/ios-citymarkets

# Open in Xcode
open citymarkets.xcodeproj

# Select a simulator or device
# Product > Destination > Select iPhone 15 (or your device)
# Product > Build > Cmd+B
# Product > Run > Cmd+R
```

---

## ✅ Core Shopping Flow (97.6% Parity)

### 1️⃣ Home Screen
- [ ] Load and display home sections from `/home-layout?device=mobile`
- [ ] All color tokens visible (no hardcoded hex colors)
- [ ] Categories, banners, products, offers load correctly
- [ ] Admin/home-design changes reflect immediately

### 2️⃣ Catalog & Search
- [ ] Browse categories without errors
- [ ] Product list pagination works
- [ ] Search by name/SKU works
- [ ] Filter by price range works
- [ ] Wishlist heart icon toggles (sync with server)

### 3️⃣ Product Detail
- [ ] Image gallery scrolls
- [ ] Price displays correctly (with discount if applicable)
- [ ] Reviews show with stars + verified purchase badge
- [ ] "Add to Cart" button works
- [ ] Quantity selector works

### 4️⃣ Shopping Cart
- [ ] Items appear after adding
- [ ] Quantity +/- works
- [ ] Remove item works (with confirmation)
- [ ] Subtotal, delivery fee, tax calculate correctly
- [ ] Apply coupon works
- [ ] Loyalty points preview shows

### 5️⃣ Checkout
- [ ] Login required if not authenticated
- [ ] Address selector shows saved addresses
- [ ] Add new address works
- [ ] Payment method selector shows all 7 methods
- [ ] Delivery time slot picker works (if enabled)
- [ ] Order summary is accurate
- [ ] "Confirm Order" button disabled until all required fields filled

### 6️⃣ Payment
- [ ] **Moyasar**: Shows card form, processes payment, returns to orders
- [ ] **Apple Pay**: Sheet opens, payment works
- [ ] **COD**: Skips payment, goes directly to orders
- [ ] Payment failure shows error message
- [ ] Success redirects to order detail/chat

### 7️⃣ Orders
- [ ] Order list shows all orders
- [ ] Order detail opens with status badge
- [ ] Timeline shows status changes
- [ ] Download PDF button works
- [ ] Chat opens (real-time updates via SSE)
- [ ] Add/remove items works
- [ ] Guest tracking works (phone + order code)

---

## 🎤 Direct Order Feature (NEW)

### 8️⃣ Direct Order Creation
- [ ] "+" button visible in Orders tab (authenticated only)
- [ ] Clicking "+" opens DirectOrderView sheet
- [ ] Address picker loads saved addresses
- [ ] Selected address displays correctly
- [ ] Payment method segmented picker works (all 7 visible)

### 9️⃣ Voice Recording
- [ ] Microphone permission request appears on first try
- [ ] "Start Recording" button works
- [ ] Recording duration timer increments in real-time
- [ ] Auto-stop at 10 minutes (600 seconds)
- [ ] Stop button saves audio file
- [ ] Reset button clears recording

### 🔟 Product Items
- [ ] "Add Item" sheet opens
- [ ] Free-text product name field accepts input
- [ ] Quantity +/- buttons work
- [ ] Item adds to list after "Add"
- [ ] Items display in list with delete button (X)
- [ ] Multiple items can be added

### 1️⃣1️⃣ Notes & Fee
- [ ] Text notes field accepts up to 700 characters
- [ ] Fee acknowledgment toggle enables "Confirm" button
- [ ] Disabling toggle disables button

### 1️⃣2️⃣ Order Submission
- [ ] "Confirm Direct Order" sends POST /api/v1/orders/direct
- [ ] Loading state shows spinner
- [ ] Success: sheet closes automatically
- [ ] Auto-navigation to chat page with new order
- [ ] Chat shows order details + voice note playback
- [ ] Chat shows timeline with status changes
- [ ] Error message displays if submission fails

---

## 👤 Account Features (P2)

### 1️⃣3️⃣ Profile Edit
- [ ] Profile tab shows user name + phone
- [ ] Edit button opens ProfileEditView
- [ ] Name field editable
- [ ] Email field editable
- [ ] Phone read-only with icon
- [ ] Save button disabled if no changes
- [ ] Save button enabled if name/email changed
- [ ] Success message shows "Profile updated"
- [ ] Profile refreshes after save

### 1️⃣4️⃣ My Reviews
- [ ] Reviews link in Account section opens MyReviewsView
- [ ] Review list shows products with thumbnail
- [ ] Star rating displays (1-5 filled stars)
- [ ] Verified purchase badge shows if applicable
- [ ] Review comment text truncated to 3 lines
- [ ] Review date formatted in Arabic locale
- [ ] Empty state shows if no reviews

### 1️⃣5️⃣ Loyalty
- [ ] Loyalty points balance displays
- [ ] Redeem points flow works
- [ ] Points deducted from checkout if applied

---

## 🔔 System Features (P1)

### 1️⃣6️⃣ Mobile Config
- [ ] On app launch, /mobile-config is called
- [ ] Version check: if `forceUpdateRequired=true`, ForceUpdateView blocks access
- [ ] Feature flags enable/disable UI elements
- [ ] No hardcoded feature flags

### 1️⃣7️⃣ APNs Registration
- [ ] Notification permission request appears on login
- [ ] Device token registered via POST /push/apns-register
- [ ] Token stored in Keychain
- [ ] Push notifications received (send test from admin)
- [ ] Notification tapped opens order detail

### 1️⃣8️⃣ API Field Names
- [ ] All requests send snake_case only (payment_method, delivery_address, etc.)
- [ ] No camelCase in request payloads
- [ ] Responses decode correctly (snake_case → camelCase via JSONDecoder)

---

## 🎨 Design System (P2-4)

### 1️⃣9️⃣ Colors
- [ ] No hardcoded hex colors visible in any view
- [ ] All colors use Color.cm* tokens (cmPrimary, cmError, cmSuccess, etc.)
- [ ] Colors match web platform palette
- [ ] Light/dark variants use correct tokens
- [ ] Buttons use cmPrimary with white text
- [ ] Error states use cmError
- [ ] Success states use cmSuccess

### 2️⃣0️⃣ Typography
- [ ] Headings use consistent font weights
- [ ] Body text readable on all backgrounds
- [ ] RTL layout correct (all text right-aligned)
- [ ] Arabic numerals in prices/quantities

### 2️⃣1️⃣ Spacing & Layout
- [ ] 16px gutters consistent
- [ ] Card padding uniform
- [ ] No horizontal scroll
- [ ] iPhone SE (small) to 15 Pro Max (large) render correctly

---

## 🔐 Authentication & Security

### 2️⃣2️⃣ Login/Logout
- [ ] Phone field accepts Saudi numbers (05X, +966)
- [ ] OTP code field accepts 6 digits
- [ ] Resend OTP works after timeout
- [ ] Session token stored in Keychain
- [ ] Logout clears session + favorites cache
- [ ] Redirect to login if token expires

### 2️⃣3️⃣ CSRF Protection
- [ ] CSRF token fetched on app launch
- [ ] Token sent in X-CSRF-Token header for POST/PUT/DELETE
- [ ] Cookie storage works

---

## ⚡ Performance

### 2️⃣4️⃣ Loading Times
- [ ] Home loads in < 2 seconds (first time)
- [ ] Catalog pagination smooth (< 500ms)
- [ ] Checkout form renders instantly
- [ ] Chat loads without lag
- [ ] No memory warnings

### 2️⃣5️⃣ Network
- [ ] App handles 4G LTE correctly
- [ ] App handles WiFi correctly
- [ ] Slow network (3G) shows loading states
- [ ] Network timeout shows error message
- [ ] Offline mode prevents POST requests (shows "no network")

---

## 🐛 Edge Cases

### 2️⃣6️⃣ Error Handling
- [ ] Invalid address shows error ("lat/lng required")
- [ ] Invalid payment method shows error
- [ ] Empty item list prevents order submission
- [ ] Duplicate order detected (idempotency key prevents)
- [ ] Server errors (5xx) show retry button
- [ ] Validation errors (422) show field-specific messages in Arabic

### 2️⃣7️⃣ State Management
- [ ] App recovers from background suspension
- [ ] Cart persists after app close (guests: UserDefaults; auth: server)
- [ ] Favorites persist (server sync for auth)
- [ ] Session persists after app close
- [ ] Force update flow doesn't brick app

---

## 🌍 Localization

### 2️⃣8️⃣ Arabic RTL
- [ ] All text right-to-left
- [ ] Icons flip when needed
- [ ] Keyboard RTL layout
- [ ] Dates formatted in Arabic (ملاحظات التاريخ)
- [ ] Numbers in Arabic context (١٢٣)

---

## 📋 Test Execution

### Run on Device:
```bash
# Connect iPhone to Mac
# Xcode: Window > Devices and Simulators > Select device
# Select in Xcode: Product > Destination > [Your Device]
# Run: Cmd+R

# Or test build for TestFlight:
# Product > Archive > Upload to App Store Connect
```

### Test on Simulator:
```bash
# iPhone 15 Pro (latest)
# iPhone SE (smallest)
# iPad Air (if needed)

# Test on different iOS versions:
# iOS 14, 15, 16, 17 (minimum deployment target)
```

---

## ✅ Sign-Off

- [ ] All 28 test sections passed
- [ ] No crashes or hangs
- [ ] Performance acceptable
- [ ] Arabic localization correct
- [ ] Ready for TestFlight/App Store submission

**Tester:** ________________  
**Date:** ________________  
**Device(s):** ________________  
**iOS Version(s):** ________________  

---

## 🚀 Notes

- **Direct Order** is the marquee feature — test thoroughly
- **Voice recording** needs real microphone (simulator may not work)
- **Moyasar payment** requires test card: `4111 1111 1111 1111` (any CVC/expiry)
- **APNs** requires real device + Apple Developer account
- **Simulator limitations:** Location, camera, microphone may not work
