// ============================================================
// PROFESSOR DO FUTURO — VENDAS
// payment-status (Supabase Edge Function)
// ------------------------------------------------------------
// Consulta o status do pagamento mais recente de um e-mail no
// Mercado Pago. Usada pela página "pendente.html" para detectar
// (via polling) quando um Pix/boleto é confirmado e redirecionar
// o aluno para a tela de "obrigado" com as credenciais.
//
// GET /payment-status?email=cliente@email.com
// → { status: 'approved' | 'pending' | 'rejected' | ... , found: boolean }
// ============================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const MP_API = 'https://api.mercadopago.com';
const ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN') || '';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cors(res: Response): Response {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  return new Response(res.body, { status: res.status, headers: h });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

  try {
    if (!ACCESS_TOKEN) {
      return cors(json({ error: 'Mercado Pago não configurado.' }, 500));
    }

    const url = new URL(req.url);
    const email = (url.searchParams.get('email') || '').trim().toLowerCase();
    if (!email) return cors(json({ error: 'E-mail obrigatório.' }, 400));

    const headers = { Authorization: `Bearer ${ACCESS_TOKEN}` };

    // 1) Busca pela external_reference que definimos na preferência (produto:email)
    let results: any[] = [];
    try {
      const ref = `professor-do-futuro:${email}`;
      const r1 = await fetch(
        `${MP_API}/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(ref)}`,
        { headers }
      );
      if (r1.ok) {
        const d1 = await r1.json();
        results = (d1 && d1.results) || [];
      }
    } catch (_) { /* segue para o fallback */ }

    // 2) Fallback: busca pelos pagamentos do pagador (últimos 7 dias)
    if (!results.length) {
      try {
        const r2 = await fetch(
          `${MP_API}/v1/payments/search?sort=date_created&criteria=desc&payer.email=${encodeURIComponent(email)}`,
          { headers }
        );
        if (r2.ok) {
          const d2 = await r2.json();
          results = (d2 && d2.results) || [];
        }
      } catch (_) { /* retorna não encontrado abaixo */ }
    }

    if (!results.length) {
      return cors(json({ found: false, status: 'not_found' }));
    }

    // Pega o pagamento mais recente que não seja rejeitado, se houver;
    // caso contrário, o mais recente simplesmente.
    const preferred = results.find((p) => p.status !== 'rejected' && p.status !== 'cancelled') || results[0];
    return cors(json({
      found: true,
      id: preferred.id ?? null,              // id do pagamento no Mercado Pago
      status: preferred.status,            // approved | pending | in_process | rejected ...
      status_detail: preferred.status_detail || '',
      amount: preferred.transaction_amount || null,
      date: preferred.date_created || null,
    }));
  } catch (err) {
    return cors(json({ error: 'Erro interno.', detail: String((err as Error).message || err) }, 500));
  }
});