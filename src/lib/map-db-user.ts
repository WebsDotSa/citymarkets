import type { User } from "@/lib/types";

export function mapDbUserRow(r: Record<string, unknown>): User {
  const iso = (v: unknown) =>
    v instanceof Date ? v.toISOString() : String(v ?? "");

  return {
    id: String(r.id),
    phone: String(r.phone),
    name: r.name != null ? String(r.name) : null,
    email: r.email != null ? String(r.email) : null,
    avatar_url: r.avatar_url != null ? String(r.avatar_url) : null,
    loyalty_points: Number(r.loyalty_points ?? 0),
    loyalty_tier: (r.loyalty_tier as User["loyalty_tier"]) || "bronze",
    spin_count_today: Number(r.spin_count_today ?? 0),
    last_spin_at: r.last_spin_at == null ? null : iso(r.last_spin_at),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
