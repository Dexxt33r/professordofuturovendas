// ============================================================
// PROFESSOR DO FUTURO — VENDAS
// create-preference (Supabase Edge Function)
// ------------------------------------------------------------
// Cria a "preference" de pagamento no Mercado Pago e devolve a
// URL do Checkout (init_point) para o site de vendas redirecionar.
//
// A chave SECRETA do Mercado Pago nunca sai do servidor: ela é
// lida de uma Secret (MERCADOPAGO_ACCESS_TOKEN), não do navegador.
//
// Chamada de: vendas/js/checkout.js (POST com {product_id, customer, ...})
// ============================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const MP_API = 'https://api.mercadopago.com';
const ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN') || '';

// Produtos aceitos por esta loja (preço em centavos, moeda BRL)
//
// ATENÇÃO: o unit_price abaixo TEM QUE SER IGUAL ao priceCents de
// vendas/js/config.js. Depois de mudar o preço aqui, o redeploy desta
// Edge Function é OBRIGATÓRIO, senão a página anuncia um valor e o
// Mercado Pago cobra outro.
const PRODUCTS: Record<string, { title: string; unit_price: number }> = {
  'professor-do-futuro': {
    title: 'Professor do Futuro — Curso de Slides com IA, Inclusão e Gestão',
    unit_price: 97.00, // R$ 97,00
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// CORS p/ consumir do site de vendas em qualquer origem
function cors(res: Response): Response {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new Response(res.body, { status: res.status, headers: h });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

  try {
    if (!ACCESS_TOKEN) {
      return cors(json({ error: 'Mercado Pago não configurado (Secret ausente).' }, 500));
    }

    const body = await req.json();
    const productId: string = body.product_id || '';
    const customer = body.customer || {};
    const backUrls = body.back_urls || {};
    const cupomCodigo: string = body.cupom_codigo || '';
    const descontoCentavos: number = body.desconto_centavos || 0;
    const valorFinalCentavos: number = body.valor_final_centavos || 0;

    // Força URLs ABSOLUTAS de retorno (o Mercado Pago exige e o navegador
    // pode ter cache antigo enviando caminhos relativos como "pendente.html").
    const SITE = 'https://professor-do-futuro-vendas.vercel.app';
    function absUrl(u: unknown, fallback: string): string {
      const s = String(u || '').trim();
      if (/^https?:\/\//i.test(s)) return s;
      if (!s) return fallback;
      return SITE + '/' + s.replace(/^\//, '');
    }

    const product = PRODUCTS[productId];
    if (!product) return cors(json({ error: 'Produto não encontrado.' }, 400));

    const name = String(customer.name || 'Aluno(a) Professor do Futuro');
    const email = String(customer.email || '');
    // Senha gerada no navegador e usada pelo webhook para criar a conta.
    const password = String(customer.password || '');

    const preference = {
      items: [
        {
          id: productId,
          title: product.title,
          quantity: 1,
          currency_id: 'BRL',
          // Aplica desconto do cupom se fornecido; senão usa o preço cheio do produto
          unit_price: valorFinalCentavos > 0 ? valorFinalCentavos / 100 : product.unit_price,
          // Habilita parcelamento (Mercado Pago decide as condições)
          payment_methods: {
            installments: 3,
            installments_behavior: 'lower',
          },
        },
      ],
      payer: {
        name,
        email: email || undefined,
      },
      // Onde o aluno volta após o checkout (SEMPRE absoluto, garantido aqui)
      back_urls: {
        success: absUrl(backUrls.success, `${SITE}/obrigado.html`),
        pending: absUrl(backUrls.pending, `${SITE}/pendente.html`),
        failure: absUrl(backUrls.failure, `${SITE}/falha.html`),
      },
      auto_return: 'approved',
      // Notificação de pagamento (webhook) → chama a outra Edge Function
      notification_url: 'https://ngkkhpvganrfctvyyvle.supabase.co/functions/v1/mp-webhook',
      external_reference: email ? `${productId}:${email}` : productId,
      metadata: {
        customer_email: email,
        customer_name: name,
        product_id: productId,
        customer_password: password,
        cupom_codigo: cupomCodigo || '',
        desconto_centavos: descontoCentavos,
        valor_final_centavos: valorFinalCentavos,
      },
    };

    const res = await fetch(`${MP_API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    });

    if (!res.ok) {
      const errText = await res.text();
      return cors(json({ error: 'Falha ao criar preferência no Mercado Pago.', detail: errText }, 502));
    }

    const data = await res.json();
    return cors(json({
      init_point: data.init_point,   // link do Checkout do Mercado Pago
      preference_id: data.id,
    }));
  } catch (err) {
    return cors(json({ error: 'Erro interno.', detail: String((err as Error).message || err) }, 500));
  }
});