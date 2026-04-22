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

async function callPudoCreateOrder(orderId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const res = await fetch(`${supabaseUrl}/functions/v1/pudo-create-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceRole}`,
    },
    body: JSON.stringify({ order_id: orderId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `No se pudo crear la orden PUDO. HTTP ${res.status}`);
  }
  return data;
}

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

    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || Deno.env.get("MP_ACCESS_TOKEN");
    if (!mpAccessToken) throw new Error("Falta MERCADOPAGO_ACCESS_TOKEN o MP_ACCESS_TOKEN en Supabase.");

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { "Authorization": `Bearer ${mpAccessToken}` },
    });
    const payment = await mpRes.json();
    if (!mpRes.ok) throw new Error(payment?.message || "No se pudo leer el pago en Mercado Pago.");

    const orderId = payment.external_reference || payment.metadata?.order_id;
    if (!orderId) return json({ ok: true, ignored: "sin order id" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: existingOrder, error: existingError } = await supabase
      .from("orders")
      .select("id, status")
      .eq("id", orderId)
      .single();

    if (existingError || !existingOrder) {
      throw new Error("No se encontró el pedido vinculado al pago.");
    }

    const status = payment.status || "pending";
    const wasApproved = String(existingOrder.status || "").toLowerCase() === "approved";
    const justApproved = !wasApproved && String(status).toLowerCase() === "approved";

    await supabase
      .from("orders")
      .update({
        status,
        mp_payment_id: String(payment.id || paymentId),
        mp_external_reference: orderId,
      })
      .eq("id", orderId);

    let stockResult: unknown = null;
    let pudoResult: unknown = null;

    if (justApproved) {
      stockResult = await supabase.rpc("decrement_blank_stock_for_order", { p_order_id: orderId });
      pudoResult = await callPudoCreateOrder(orderId);
    }

    return json({ ok: true, order_id: orderId, status, justApproved, stockResult, pudoResult });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Error desconocido" }, 500);
  }
});
