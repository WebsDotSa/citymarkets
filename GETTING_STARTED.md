# 🚀 Getting Started — iOS App Testing

## Prerequisites

- **Mac** with Xcode 14+ installed
- **iPhone/iPad** with iOS 14+ or Simulator
- **GitHub account** with access to `WebsDotSa/citymarkets`

---

## Clone & Build

### 1. Clone the repo (if not already cloned)
```bash
git clone https://github.com/WebsDotSa/citymarkets.git
cd citymarkets
```

### 2. Check out iOS branch
```bash
git checkout ios-citymarkets
# or: git switch ios-citymarkets
```

### 3. Navigate to iOS folder
```bash
cd ios-citymarkets
```

### 4. Open in Xcode
```bash
open citymarkets.xcodeproj
# NOT .xcworkspace (no CocoaPods yet)
```

### 5. Select target device/simulator
- **Top toolbar** → Select device dropdown
- Choose iPhone 15 Pro (latest) or your connected device
- Or select simulator (iPhone 15 Pro, iPhone SE, iPad)

### 6. Build & Run
```bash
# Via menu:
# Product > Build (Cmd+B)
# Product > Run (Cmd+R)

# Or press Cmd+R directly
```

---

## Test Data

### Test Login

| Field | Value |
|---|---|
| Phone | `0500000000` (any Saudi number) |
| OTP | `000000` |
| Result | Logs in successfully |

### Test Payment

| Method | Card Number | CVC | Expiry |
|---|---|---|---|
| **Moyasar** | 4111 1111 1111 1111 | Any 3 digits | Any future date |
| **Apple Pay** | Use configured card | — | — |
| **COD** | N/A | N/A | Skips payment |

---

## First Run Checklist

- [ ] App launches without crash
- [ ] Home screen loads with sections from admin/home-design
- [ ] Login page shows (if not authenticated)
- [ ] After login, home/catalog visible
- [ ] Navigation tabs at bottom work (Home → Catalog → Chef → Cart → Account)
- [ ] No console errors (Xcode → View → Debug Area)

---

## Common Issues & Fixes

### Issue: Build fails with "module not found"
```
Error: cannot load such file -- /citymarkets/citymarkets/Core/Models.swift
```
**Fix:** Ensure you're in `ios-citymarkets` directory:
```bash
cd citymarkets/ios-citymarkets  # NOT just citymarkets/
```

### Issue: Simulator won't run
```
Error: Could not launch "Simulator.app"
```
**Fix:**
```bash
# Kill stuck simulator
killall "com.apple.CoreSimulator.CoreSimulatorService"

# Start fresh in Xcode
Product > Destination > Simulators > iOS 17.0 > iPhone 15 Pro
Product > Run (Cmd+R)
```

### Issue: App crashes on launch
```
Fatal error: Cannot find 'APIClient.shared'
```
**Fix:** This should NOT happen. Check:
1. All files in `Core/` exist (APIClient.swift, Models.swift, AppStore.swift, Support.swift)
2. No missing imports in CityMarketsApp.swift
3. Clean build: Cmd+Shift+K, then Cmd+B

### Issue: Network calls timeout
```
Error: invalidResponse or status(0, "")
```
**Fix:** Check server is running:
```bash
# From main repo:
npm run dev
# Or docker: docker-compose up
```

Default API base: `https://citymarkets.sa/api/v1`

---

## Run Tests

```bash
# Unit tests (if any)
Cmd+U

# Or manually via Product > Test
```

---

## Next Steps

1. **Quick Test** (5 min): `QUICK_TEST.md`
2. **Full Test** (30 min): `TEST_CHECKLIST.md`
3. **Feature Deep-Dive**: See specific feature docs in `Features/*/`

---

## File Structure

```
ios-citymarkets/
├── citymarkets/
│   ├── CityMarketsApp.swift           # App entry point
│   ├── Core/
│   │   ├── APIClient.swift            # API calls
│   │   ├── AppStore.swift             # State management
│   │   ├── Models.swift               # Data types
│   │   └── Support.swift              # Helpers + colors
│   ├── Features/
│   │   ├── Home/
│   │   ├── Catalog/
│   │   ├── DirectOrder/               # ← NEW
│   │   ├── Orders/
│   │   ├── Cart/
│   │   ├── Account/
│   │   └── ...
│   └── Shared/
├── TEST_CHECKLIST.md                  # 28-point test plan
├── QUICK_TEST.md                      # 5-minute test
└── GETTING_STARTED.md                 # This file
```

---

## Contact & Support

- **Issues**: GitHub Issues on `WebsDotSa/citymarkets`
- **Questions**: Check `Features/*/FEATURE.md` docs
- **API Contract**: `src/lib/validation/order.ts` (main repo)

---

## Key Features Implemented

✅ Direct Order (voice + chat + 7 payment methods)  
✅ Reviews, Timeline, PDF download  
✅ Profile edit, APNs registration  
✅ Mobile config, unified colors  
✅ Full shopping flow parity  

**Status: Ready for testing on device!** 🎉
