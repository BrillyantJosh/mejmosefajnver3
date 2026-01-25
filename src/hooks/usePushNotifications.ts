import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface PushSubscriptionState {
  isSupported: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission | 'default';
  loading: boolean;
  error: string | null;
}

export function usePushNotifications() {
  const { session } = useAuth();
  const [state, setState] = useState<PushSubscriptionState>({
    isSupported: false,
    isSubscribed: false,
    permission: 'default',
    loading: true,
    error: null,
  });
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);

  // Load VAPID public key from app_settings
  useEffect(() => {
    const loadVapidKey = async () => {
      try {
        const { data, error } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'vapid_public_key')
          .maybeSingle();

        if (error) {
          console.error('[Push] Error loading VAPID key:', error);
          return;
        }

        if (data?.value) {
          // Value is stored as JSON string
          const key = typeof data.value === 'string' ? data.value : String(data.value);
          setVapidPublicKey(key.replace(/^"|"$/g, '')); // Remove quotes if present
        }
      } catch (error) {
        console.error('[Push] Error loading VAPID key:', error);
      }
    };

    loadVapidKey();
  }, []);

  // Check support and current subscription status
  useEffect(() => {
    const checkSupport = async () => {
      const isSupported = 'serviceWorker' in navigator && 
                          'PushManager' in window && 
                          'Notification' in window;

      if (!isSupported) {
        setState(prev => ({ ...prev, isSupported: false, loading: false }));
        return;
      }

      const permission = Notification.permission;
      
      // Check if already subscribed
      let isSubscribed = false;
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        isSubscribed = !!subscription;
      } catch (error) {
        console.error('[Push] Error checking subscription:', error);
      }

      setState(prev => ({
        ...prev,
        isSupported: true,
        isSubscribed,
        permission,
        loading: false,
      }));
    };

    checkSupport();
  }, []);

  // Convert VAPID key to Uint8Array for Web Push
  const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!session?.nostrHexId || !vapidPublicKey) {
      setState(prev => ({ ...prev, error: 'Not authenticated or VAPID key missing' }));
      return false;
    }

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));

      // Request permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(prev => ({ 
          ...prev, 
          permission, 
          loading: false, 
          error: 'Notification permission denied' 
        }));
        return false;
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });

      // Extract keys
      const p256dh = subscription.getKey('p256dh');
      const auth = subscription.getKey('auth');

      if (!p256dh || !auth) {
        throw new Error('Failed to get subscription keys');
      }

      const p256dhBase64 = btoa(String.fromCharCode(...new Uint8Array(p256dh)));
      const authBase64 = btoa(String.fromCharCode(...new Uint8Array(auth)));

      // Save to database
      const { error: dbError } = await supabase
        .from('push_subscriptions')
        .upsert({
          nostr_hex_id: session.nostrHexId,
          endpoint: subscription.endpoint,
          p256dh: p256dhBase64,
          auth: authBase64,
        }, {
          onConflict: 'nostr_hex_id,endpoint',
        });

      if (dbError) {
        throw dbError;
      }

      setState(prev => ({
        ...prev,
        isSubscribed: true,
        permission: 'granted',
        loading: false,
      }));

      console.log('[Push] Successfully subscribed to notifications');
      return true;
    } catch (error) {
      console.error('[Push] Error subscribing:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to subscribe',
      }));
      return false;
    }
  }, [session?.nostrHexId, vapidPublicKey]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    if (!session?.nostrHexId) return false;

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();

        // Remove from database
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('nostr_hex_id', session.nostrHexId)
          .eq('endpoint', subscription.endpoint);
      }

      setState(prev => ({
        ...prev,
        isSubscribed: false,
        loading: false,
      }));

      console.log('[Push] Successfully unsubscribed from notifications');
      return true;
    } catch (error) {
      console.error('[Push] Error unsubscribing:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to unsubscribe',
      }));
      return false;
    }
  }, [session?.nostrHexId]);

  return {
    ...state,
    subscribe,
    unsubscribe,
  };
}
