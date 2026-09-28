'use client';

import { useEffect, useCallback } from 'react';
import { analytics } from '@/lib/analytics';

/**
 * Initialize analytics
 */
export function useAnalyticsInit() {
  useEffect(() => {
    analytics.init({ trackingId: process.env.NEXT_PUBLIC_GA4_ID || '' });
  }, []);
}

/**
 * Track custom events
 */
export function useAnalytics() {
  const trackEvent = useCallback((action: string, params?: Record<string, string | number | boolean>) => {
    analytics.event(action, params);
  }, []);

  const trackProductView = useCallback((product: { id: string; name: string; category?: string; price?: number }) => {
    analytics.productView(product);
  }, []);

  const trackAddToCart = useCallback((item: { id: string; name: string; price: number; quantity: number; category?: string }) => {
    analytics.addToCart(item);
  }, []);

  const trackRemoveFromCart = useCallback((item: { id: string; name: string; price: number; quantity: number }) => {
    analytics.removeFromCart(item);
  }, []);

  const trackCheckoutStart = useCallback((cartValue: number, itemCount: number) => {
    analytics.checkoutStart(cartValue, itemCount);
  }, []);

  const trackPurchase = useCallback((order: {
    id: string;
    revenue: number;
    tax?: number;
    shipping?: number;
    items: Array<{ id: string; name: string; price: number; quantity: number; category?: string }>;
  }) => {
    analytics.purchase(order);
  }, []);

  const trackSearch = useCallback((searchTerm: string, resultCount: number) => {
    analytics.search(searchTerm, resultCount);
  }, []);

  const trackSignup = useCallback((method: 'phone' | 'email' | 'social') => {
    analytics.signup(method);
  }, []);

  const trackError = useCallback((description: string, fatal = false) => {
    analytics.error(description, fatal);
  }, []);

  return {
    trackEvent,
    trackProductView,
    trackAddToCart,
    trackRemoveFromCart,
    trackCheckoutStart,
    trackPurchase,
    trackSearch,
    trackSignup,
    trackError,
  };
}
