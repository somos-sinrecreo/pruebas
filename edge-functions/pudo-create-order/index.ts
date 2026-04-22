import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const clean = (value: unknown) => String(value ?? '').trim();

const PUDO_BASE_URL = clean(Deno.env.get('PUDO_BASE_URL')).replace(/\/$/, '');
const PUDO_CLIENT_ID = clean(Deno.env.get('PUDO_CLIENT_ID'));
const PUDO_CLIENT_SECRET = clean(Deno.env.get('PUDO_CLIENT_SECRET'));

const SUPABASE_URL = clean(Deno.env.get('SUPABASE_URL'));
const SUPABASE_SERVICE_ROLE_KEY = clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getPudoToken() {
  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', PUDO_CLIENT_ID);
  body.set('client_secret', PUDO_CLIENT_SECRET);

  const res = await fetchWithTimeout(`${PUDO_BASE_URL}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }, 15000);

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    throw new Error(data?.error || `No se pudo obtener token PUDO. HTTP ${res.status}`);
  }

  return data.access_token;
}

function getPackageFromQuantity(quantity: number) {
  const safeQty = Math.max(1, Math.min(7, Number(quantity || 1)));
  return {
    widthInMm: 280,
    depthInMm: 280,
    heightInMm: safeQty * 50,
    weightInGrams: safeQty * 400,
  };
}

function normalizeDestination(destination: any = {}, selectedOption: any = {}, shippingData: any = {}) {
  return {
    address: clean(destination.address || selectedOption.address || shippingData.locker_address || shippingData.address),
    number: clean(destination.number || ''),
    floor: clean(destination.floor || ''),
    apartment: clean(destination.apartment || ''),
    locality: clean(destination.locality || destination.city || selectedOption.city || shippingData.city),
    city: clean(destination.city || destination.locality || selectedOption.city || shippingData.city),
    province: clean(destination.province || selectedOption.province || shippingData.province),
    country: clean(destination.country || 'AR'),
    postalCode: clean(destination.postalCode || destination.postal_code || selectedOption.zipcode || selectedOption.postalCode || shippingData.postalCode || shippingData.postal_code || ''),
  };
}

async function markOrderError(orderId: string, message: string) {
  await sb
    .from('orders')
    .update({
      pudo_order_error: message,
      pudo_order_created: false,
    })
    .eq('id', orderId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no permitido' }, 405);

  try {
    if (!PUDO_BASE_URL || !PUDO_CLIENT_ID || !PUDO_CLIENT_SECRET) throw new Error('Faltan secrets de PUDO.');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');

    const body = await req.json().catch(() => ({}));
    const orderId = clean(body.order_id || body.orderId);
    if (!orderId) return jsonResponse({ error: 'Falta order_id.' }, 400);

    const { data: order, error: orderError } = await sb
      .from('orders')
      .select(`
        id,
        public_order_number,
        status,
        customer_name,
        customer_email,
        customer_phone,
        subtotal,
        discount,
        total,
        shipping_provider,
        shipping_price,
        shipping_data,
        pudo_order_created
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) return jsonResponse({ error: 'No se encontró el pedido.', details: orderError }, 404);
    if (order.pudo_order_created) return jsonResponse({ ok: true, skipped: true, reason: 'La orden PUDO ya estaba creada.' });
    if (String(order.status || '').toLowerCase() !== 'approved') return jsonResponse({ ok: true, skipped: true, reason: 'El pedido todavía no está aprobado.' });
    if (String(order.shipping_provider || '').toLowerCase() !== 'pudo') return jsonResponse({ ok: true, skipped: true, reason: 'El pedido no usa PUDO.' });

    const shippingData = order.shipping_data || {};
    const selectedRate = shippingData.selectedRate || shippingData.rate || {};
    const selectedOption = shippingData.selectedOption || shippingData.option || {};
    const destinationRaw = shippingData.destination || {};

    const shippingMethodId = Number(
      selectedRate.shippingMethodId ||
      selectedRate.shipping_method_id ||
      shippingData.shippingMethodId ||
      shippingData.shipping_method_id ||
      shippingData.methodId ||
      shippingData.method_id ||
      0
    );

    if (!shippingMethodId) throw new Error('Falta shippingMethodId en shipping_data.');

    const { data: items, error: itemsError } = await sb
      .from('order_items')
      .select('id, product_title, size, quantity, unit_price, line_total, blank_stock_id')
      .eq('order_id', orderId);

    if (itemsError) throw itemsError;

    const totalQuantity = (items || []).reduce((acc: number, item: any) => acc + Number(item.quantity || 0), 0);
    if (!totalQuantity) throw new Error('El pedido no tiene items.');
    if (totalQuantity > 7) throw new Error('PUDO permite máximo 7 remeras por envío según la regla configurada.');

    const packageInfo = getPackageFromQuantity(totalQuantity);
    const orderNumber = Number(order.public_order_number);
    if (!orderNumber) throw new Error('El pedido no tiene public_order_number.');

    const merchandiseTotal = (items || []).reduce((acc: number, item: any) => acc + Number(item.line_total || 0), 0);
    const destination = normalizeDestination(destinationRaw, selectedOption, shippingData);
    if (!destination.address || !destination.city || !destination.province || !destination.postalCode) {
      throw new Error('Faltan datos de destino para crear la orden PUDO.');
    }

    const lockerId = selectedOption?.lockerId || selectedOption?.locker_id || shippingData.lockerId || shippingData.locker_id;

    const shippingInfo: any = { shippingMethodId, destination };
    if (shippingMethodId === 1 && lockerId) shippingInfo.lockerId = lockerId;

    const pudoPayload = {
      orderId: orderNumber,
      orderNumber,
      depositCode: String(orderNumber),
      customer: {
        name: clean(order.customer_name || 'Cliente SIN RECREO'),
        mail: clean(order.customer_email || ''),
      },
      shippingInfo,
      items: [
        {
          sku: `SR-PEDIDO-${orderNumber}`,
          name: `Pedido SIN RECREO - ${totalQuantity} remera${totalQuantity === 1 ? '' : 's'}`,
          price: Math.max(1, Math.round(merchandiseTotal || Number(order.total || 1))),
          widthInMm: packageInfo.widthInMm,
          heightInMm: packageInfo.heightInMm,
          depthInMm: packageInfo.depthInMm,
          weightInGrams: packageInfo.weightInGrams,
          quantity: 1,
          freeShipping: Number(order.shipping_price || 0) === 0,
        },
      ],
    };

    const token = await getPudoToken();
    const pudoRes = await fetchWithTimeout(`${PUDO_BASE_URL}/api/v1/Orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(pudoPayload),
    }, 25000);

    const responseText = await pudoRes.text();
    let pudoData: unknown = null;
    try { pudoData = responseText ? JSON.parse(responseText) : {}; } catch { pudoData = responseText || {}; }

    if (!pudoRes.ok) {
      const errorMessage = `PUDO Orders HTTP ${pudoRes.status}`;
      await markOrderError(orderId, `${errorMessage}: ${JSON.stringify(pudoData)}`);
      return jsonResponse({ ok: false, error: errorMessage, pudoPayload, details: pudoData }, pudoRes.status);
    }

    await sb
      .from('orders')
      .update({
        pudo_order_created: true,
        pudo_order_created_at: new Date().toISOString(),
        pudo_order_response: { status: pudoRes.status, response: pudoData, payload: pudoPayload },
        pudo_order_error: null,
      })
      .eq('id', orderId);

    return jsonResponse({ ok: true, order_id: orderId, public_order_number: orderNumber, pudo_payload: pudoPayload, pudo_response: pudoData });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado creando orden PUDO.';
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
