# City Markets — Authorization Matrix

| Actor | Scope | Examples |
|---|---|---|
| Customer | self | profile, addresses, cart, own orders |
| Vendor Staff | vendor | products, inventory, vendor orders |
| Vendor Manager | vendor | vendor settings, staff |
| Vendor Owner | vendor | full vendor scope |
| Driver | assigned orders | delivery actions |
| Admin | platform | platform operations |
| Super Admin | platform | high-risk/security operations |

Rules:
- UI visibility is never authorization.
- Mutations check actor + resource scope.
- Vendor queries enforce vendor ownership server-side.
- Customer queries derive user ID from the actor.
