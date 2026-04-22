import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const clean = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.max(0, Math.round(Number(value || 0)));

function normalizeShipping(body: any = {}) {
  const raw = body.shipping || body.shipping_data || null;
  if (!raw) return { provider: null, price: 0, data: null };

  const providerRaw = clean(body.shipping_provider || raw.provider || raw.Provider || "");
  const provider = providerRaw ? providerRaw.toLowerCase() : null;
  const price = money(body.shipping_price ?? raw.price ?? raw.charge ?? 0);
  const realPrice = money(raw.real_price ?? raw.realPrice ?? price);
  const shippingMethodIdRaw = raw.shippingMethodId ?? raw.shipping_method_id ?? raw.methodId ?? raw.method_id ?? null;
  const shippingMethodId = shippingMethodIdRaw == null || shippingMethodIdRaw === "" ? null : Number(shippingMethodIdRaw);
  const shippingMethodName = clean(raw.shippingMethodName || raw.shipping_method_name || raw.methodName || raw.method_name || "");
  const lockerIdRaw = raw.lockerId ?? raw.locker_id ?? null;
  const lockerId = lockerIdRaw == null || lockerIdRaw === "" ? null : lockerIdRaw;

  const selectedOption = {
    lockerId,
    lockerName: clean(raw.lockerName || raw.locker_name || ""),
    address: clean(raw.lockerAddress || raw.locker_address || raw.address || ""),
    city: clean(raw.city || raw.destination?.city || ""),
    province: clean(raw.province || raw.destination?.province || ""),
    zipcode: clean(raw.zipcode || raw.postalCode || raw.postal_code || raw.destination?.postalCode || ""),
    lockerLocationDetails: clean(raw.lockerLocationDetails || raw.locker_details || ""),
  };

  return {
    provider,
    price,
    data: {
      ...raw,
      provider: providerRaw || raw.provider || null,
      shippingMethodId,
      shippingMethodName,
      selectedRate: { shippingMethodId, shippingMethodName, price, realPrice },
      selectedOption,
      destination: raw.destination || {},
      charge: price,
      realPrice,
      isFree: Boolean(raw.is_free ?? raw.isFree ?? price === 0),
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new Error("No hay items para registrar.");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const shipping = normalizeShipping(body);

    const subtotal = items.reduce((acc: number, item: any) => acc + Number(item.base_price || item.unit_price || 0) * Number(item.quantity || 1), 0);
    const discount = items.reduce((acc: number, item: any) => acc + Number(item.discount || 0), 0);
    const itemsTotal = items.reduce((acc: number, item: any) => acc + Number(item.line_total || item.unit_price || 0) * Number(item.quantity || 1), 0);
    const total = itemsTotal + shipping.price;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        status: "pending",
        payment_method: "transferencia",
        customer_name: body.customer_name || null,
        customer_email: body.customer_email || null,
        customer_phone: body.customer_phone || null,
        subtotal,
        discount,
        total,
        notes: body.notes || "Pedido por transferencia",
        shipping_provider: shipping.provider,
        shipping_price: shipping.price,
        shipping_data: shipping.data,
      })
      .select("id, public_order_number")
      .single();

    if (orderError) throw orderError;

    const orderItems = items.map((item: any) => ({
      order_id: order.id,
      product_id: item.product_id || null,
      product_slug: item.product_slug || null,
      product_title: item.product_title || "Producto",
      sku: item.sku || null,
      capsule: item.capsule || null,
      blank_stock_id: item.blank_stock_id || null,
      size: item.size || null,
      fit: item.fit || null,
      color: item.color || null,
      quantity: Number(item.quantity || 1),
      unit_price: Number(item.unit_price || 0),
      base_price: Number(item.base_price || item.unit_price || 0),
      discount: Number(item.discount || 0),
      line_total: Number(item.line_total || 0),
    }));

    const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
    if (itemsError) throw itemsError;

    return json({
      ok: true,
      order_id: order.id,
      public_order_number: order.public_order_number || null,
      order_code: order.public_order_number ? `SR-${order.public_order_number}` : `SR-${String(order.id).slice(0, 8).toUpperCase()}`,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Error desconocido" }, 500);
  }
});
