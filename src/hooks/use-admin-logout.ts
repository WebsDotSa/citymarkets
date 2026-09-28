"use client";

import { useCallback } from "react";

/**
 * Logout helper for admin chrome (sidebar, driver-layout, admin-layout).
 *
 * Centralises the POST /api/admin/auth/logout round-trip + the
 * `admin_user` localStorage key, so call sites only need to handle
 * their own post-logout navigation.
 */
export function useAdminLogout(onSuccess?: () => void) {
  return useCallback(async () => {
    try {
      await fetch("/api/admin/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      // Logout is best-effort: even if the request fails, the local
      // user cache is cleared and the caller navigates to /admin/login.
      console.error("Logout error:", error);
    }
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("admin_user");
    }
    onSuccess?.();
  }, [onSuccess]);
}
