# Edge Functions · SIN RECREO · Stock general

Estas funciones reemplazan la lógica basada en `variant_id`. Ahora cada item recibe:

```json
{
  "product_id": "uuid del producto",
  "product_slug": "slug-publico",
  "product_title": "Nombre",
  "sku": "SR-...",
  "capsule": "Cápsula",
  "blank_stock_id": "uuid de blank_stock",
  "size": "M",
  "fit": "unisex | oversize | femenina",
  "color": "Hueso",
  "quantity": 1,
  "unit_price": 38900,
  "base_price": 38900,
  "line_total": 38900,
  "discount": 0
}
```

Variables de entorno necesarias en Supabase:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
MP_ACCESS_TOKEN=...
PUBLIC_SITE_URL=https://sinrecreo.com.ar
```

---

## create-transfer-order/index.ts

```ts
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

    const subtotal = items.reduce((acc: number, item: any) => acc + Number(item.base_price || item.unit_price || 0) * Number(item.quantity || 1), 0);
    const discount = items.reduce((acc: number, item: any) => acc + Number(item.discount || 0), 0);
    const total = items.reduce((acc: number, item: any) => acc + Number(item.line_total || item.unit_price || 0) * Number(item.quantity || 1), 0);

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
      })
      .select("id")
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

    return json({ ok: true, order_id: order.id, order_code: `SR-${String(order.id).slice(0, 8).toUpperCase()}` });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Error desconocido" }, 500);
  }
});
```

---

## create-mp-preference/index.ts

```ts
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new Error("No hay items para Mercado Pago.");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const subtotal = items.reduce((acc: number, item: any) => acc + Number(item.base_price || item.unit_price || 0) * Number(item.quantity || 1), 0);
    const discount = items.reduce((acc: number, item: any) => acc + Number(item.discount || 0), 0);
    const total = items.reduce((acc: number, item: any) => acc + Number(item.line_total || item.unit_price || 0) * Number(item.quantity || 1), 0);

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        status: "pending",
        payment_method: "mercadopago",
        customer_name: body.customer_name || null,
        customer_email: body.customer_email || null,
        customer_phone: body.customer_phone || null,
        subtotal,
        discount,
        total,
        notes: "Pedido iniciado con Mercado Pago",
      })
      .select("id")
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

    const publicSiteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://sinrecreo.com.ar";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const preferencePayload = {
      items: items.map((item: any) => ({
        title: item.product_title || "Producto SIN RECREO",
        quantity: Number(item.quantity || 1),
        unit_price: Number(item.unit_price || 0),
        currency_id: "ARS",
      })),
      payer: {
        name: body.customer_name || undefined,
        email: body.customer_email || undefined,
      },
      external_reference: order.id,
      metadata: { order_id: order.id },
      back_urls: {
        success: `${publicSiteUrl}/?mp_status=success`,
        pending: `${publicSiteUrl}/?mp_status=pending`,
        failure: `${publicSiteUrl}/?mp_status=failure`,
      },
      auto_return: "approved",
      notification_url: `${supabaseUrl}/functions/v1/mp-webhook`,
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}`,
      },
      body: JSON.stringify(preferencePayload),
    });

    const mpData = await mpRes.json();
    if (!mpRes.ok) throw new Error(mpData?.message || "Mercado Pago no creó la preferencia.");

    await supabase
      .from("orders")
      .update({ mp_preference_id: mpData.id || null })
      .eq("id", order.id);

    return json({ ok: true, order_id: order.id, init_point: mpData.init_point, sandbox_init_point: mpData.sandbox_init_point });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Error desconocido" }, 500);
  }
});
```

---

## mp-webhook/index.ts

```ts
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    let paymentId = url.searchParams.get("id") || url.searchParams.get("data.id") || "";

    if (!paymentId && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      paymentId = body?.data?.id || body?.id || "";
    }

    if (!paymentId) return json({ ok: true, ignored: "sin payment id" });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { "Authorization": `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}` },
    });
    const payment = await mpRes.json();
    if (!mpRes.ok) throw new Error(payment?.message || "No se pudo leer el pago en Mercado Pago.");

    const orderId = payment.external_reference || payment.metadata?.order_id;
    if (!orderId) return json({ ok: true, ignored: "sin order id" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const status = payment.status || "pending";
    await supabase
      .from("orders")
      .update({
        status,
        mp_payment_id: String(payment.id || paymentId),
        mp_external_reference: orderId,
      })
      .eq("id", orderId);

    if (status === "approved") {
      await supabase.rpc("decrement_blank_stock_for_order", { p_order_id: orderId });
    }

    return json({ ok: true, order_id: orderId, status });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Error desconocido" }, 500);
  }
});
```
