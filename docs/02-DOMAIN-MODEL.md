# City Markets — Canonical Domain Model

## Identity & Access
Customer, Admin, Vendor owner/manager/staff, Driver.

## Catalog
Product, ProductImage, Category, VendorListing, Offer.

## Commerce
Cart, CartItem, Order, OrderItem, VendorOrder, VendorOrderItem.

## Inventory
InventoryItem, InventoryAdjustment, InventoryReservation when needed.

## Payments
Payment, PaymentAttempt, PaymentEvent, PaymentWebhookEvent.

## Delivery
Address, DeliveryQuote, DeliverySlot, Driver, DriverAssignment.

## Customer value
Coupon, CouponRedemption, LoyaltyAccount, LoyaltyTransaction, Review.

## Communications
Notification, NotificationTemplate, NotificationDelivery, Broadcast.

## Operations
AuditLog, Job, JobAttempt, Application.

## Rules
- Product identity is separate from vendor listing where vendor-specific price/stock is required.
- Purchased commercial values are snapshotted on orders.
- VendorOrder has its own fulfillment lifecycle.
- Payment owns its own state machine and references an order.
- Notifications are event-driven.
- UI cannot directly mutate status.

## Money
Use numeric/decimal or minor units consistently. Provider boundaries use SAR halalas. Avoid floating point persistence.
