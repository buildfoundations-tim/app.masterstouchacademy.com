'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type SdkStatus = 'loading' | 'ready' | 'failed';

/**
 * Inline PayPal checkout, matching the prototype — the buyer approves in a
 * PayPal overlay rather than leaving the site.
 *
 * The SDK never learns the price. Its createOrder callback asks our server,
 * which prices the cart itself and returns only an order id; onApprove hands
 * that id back for capture. Nothing about cost crosses the browser.
 *
 * If the SDK cannot load — blocked script, offline, PayPal down — the redirect
 * form beside this stays usable. That path is server-rendered and works without
 * JavaScript at all, so checkout is never wholly dependent on this.
 */
export function PayPalButtons({
  clientId,
  disabled,
  onFallbackNeeded,
}: {
  clientId: string;
  disabled: boolean;
  onFallbackNeeded: (needed: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SdkStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (disabled) return;

    const SCRIPT_ID = 'paypal-sdk';
    let cancelled = false;

    function render() {
      const paypal = (window as unknown as { paypal?: Record<string, unknown> }).paypal;
      if (!paypal || !container.current || cancelled) return;

      setStatus('ready');
      onFallbackNeeded(false);
      container.current.innerHTML = '';

      const Buttons = (paypal as { Buttons: (o: unknown) => { render: (el: HTMLElement) => void } }).Buttons;

      Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'pay', height: 44 },

        createOrder: async () => {
          setError(null);
          const res = await fetch('/api/checkout/create', { method: 'POST' });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? 'Could not start the payment.');
          return json.id as string;
        },

        onApprove: async (data: { orderID: string }) => {
          const res = await fetch('/api/checkout/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: data.orderID }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            setError(json.error ?? 'The payment could not be completed.');
            return;
          }
          // Land on the same confirmation the redirect flow uses, so there is
          // one success screen rather than two.
          router.push(`/checkout/return?token=${encodeURIComponent(data.orderID)}`);
        },

        onError: () => {
          setError('PayPal reported a problem. You can try the standard checkout below.');
          onFallbackNeeded(true);
        },

        onCancel: () => setError(null),
      }).render(container.current);
    }

    if (document.getElementById(SCRIPT_ID)) {
      render();
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    // intent=capture matches the Orders API call on the server.
    script.src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
      '&currency=USD&intent=capture&components=buttons&disable-funding=paylater';
    script.async = true;
    script.onload = render;
    script.onerror = () => {
      if (cancelled) return;
      setStatus('failed');
      onFallbackNeeded(true);
    };
    document.body.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [clientId, disabled, onFallbackNeeded, router]);

  if (disabled) return null;

  return (
    <div>
      {error ? (
        <p className="alert alert--error" style={{ fontSize: 12.5 }} role="alert">
          {error}
        </p>
      ) : null}

      <div ref={container} />

      {status === 'loading' ? (
        <p className="faint" style={{ fontSize: 12, textAlign: 'center', padding: '10px 0' }}>
          Loading PayPal…
        </p>
      ) : null}

      {status === 'failed' ? (
        <p className="faint" style={{ fontSize: 12, lineHeight: 1.6 }}>
          PayPal&rsquo;s checkout could not load. Use the button below instead — it takes you to
          PayPal and back.
        </p>
      ) : null}
    </div>
  );
}
