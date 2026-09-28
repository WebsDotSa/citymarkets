# City Markets — Frontend Consolidation

## Storefront
Canonical flow: server page -> domain service -> initial render -> client interaction.

Known refactor candidates:
- product detail resolves product/SEO server-side while the client component is not passed the resolved object.
- auth contains aliases.
- cart/checkout rely on large client components.
- category pages repeat category/count queries.

## Admin
Admin pages consume domain services; no business logic is copied into individual pages.

## Vendor
Separate public storefront, vendor portal and admin vendor management. Vendor scope is enforced server-side.

## Shared UI
Button, Input, Select, Form, Dialog, Drawer, Table, Badge, Pagination, FilterBar, EmptyState, LoadingState, ErrorState, Toast.

## Cleanup
Remove aliases/components only after reference and consumer inventory confirms they are obsolete.
