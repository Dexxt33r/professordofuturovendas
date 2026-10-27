// ============================================================
// PROFESSOR DO FUTURO — VENDAS
// mp-webhook (Supabase Edge Function)
// ------------------------------------------------------------
// Recebe a notificação do Mercado Pago quando um pagamento muda
// de status. Se o pagamento estiver "approved": cria a conta de
// aluno(a) no Supabase Auth (com e-mail confirmado), registra o
// pedido em `orders` (anti-duplicado) e envia o e-mail com as
// credenciais via Brevo (ex-Sendinblue).
//
// SECRETS necessárias (supabase secrets set):
//   MERCADOPAGO_ACCESS_TOKEN  → Access Token de PRODUÇÃO do MP
//   SUPABASE_SERVICE_ROLE_KEY → Service Role Key do projeto
//   BREVO_API_KEY             → API key da Brevo (ex-Sendinblue) p/ e-mail
//   BREVO_FROM_EMAIL          → e-mail remetente verificado (Sender)
//   BREVO_FROM_NAME           → (opcional) nome exibido como remetente
//   SITE_URL                  → URL de login que vai no e-mail (opcional)
//   CALLBACK_TARGET           → (opcional) e-mail do dono p/ aviso de venda
// ============================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MP_API = 'https://api.mercadopago.com';
const ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
const BREVO_FROM_EMAIL = Deno.env.get('BREVO_FROM_EMAIL') || '';
const BREVO_FROM_NAME = Deno.env.get('BREVO_FROM_NAME') || 'Professor do Futuro';
const SITE_URL = (Deno.env.get('SITE_URL') || '').replace(/\/$/, '');
const OWNER_EMAIL = Deno.env.get('CALLBACK_TARGET') || '';

const COURSE_NAME = 'Professor do Futuro';

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
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  return new Response(res.body, { status: res.status, headers: h });
}

// Gera uma senha aleatória forte
function randomPassword(len = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

// Consulta os dados de um pagamento no Mercado Pago
async function getPayment(paymentId: string): Promise<any> {
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error('Falha ao consultar pagamento ' + res.status);
  return res.json();
}

// Envia e-mail transacional via Brevo (ex-Sendinblue)
// API: POST https://api.brevo.com/v3/smtp/email  (header: api-key)
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!BREVO_API_KEY || !BREVO_FROM_EMAIL) {
    console.warn('[mp-webhook] Brevo não configurado; e-mail não enviado.');
    return;
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'api-key': BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: BREVO_FROM_NAME, email: BREVO_FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Falha no envio de e-mail (Brevo): ' + res.status + ' ' + t);
  }
}
serve(async (req) => {
  if (req.method === 'OPTIONS') return cors(new Response('ok', { status: 204 }));

  try {
    // O Mercado Pago envia: { type:"payment", data:{ id } }  (GET ou POST)
    let paymentId: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      paymentId = url.searchParams.get('id');
    } else {
      const body = await req.json().catch(() => ({}));
      paymentId = (body.data && body.data.id) || null;
    }

    if (!paymentId) return cors(json({ error: 'Sem id de pagamento.' }, 400));

    // Sempre consultamos o pagamento NA CONTA para confirmar o status real
    // (não confiamos no corpo da notificação).
    const payment = await getPayment(paymentId);
    const status = payment.status; // approved | pending | rejected | ...

    // Só liberamos acesso para pagamento aprovado
    if (status !== 'approved') {
      return cors(json({ received: 'ok', status }));
    }

    // ---- Extrai e-mail do pagamento ----
    // Ordem de confiabilidade:
    //   1) metadata.customer_email  (nós gravamos na preferência)
    //   2) external_reference       ("produto:email", também nosso)
    //   3) payer.email              (e-mail da conta MP do pagador — pode variar)
    let email = '';
    let emailSource = '';
    const meta = payment.metadata || {};
    if (meta.customer_email && String(meta.customer_email).includes('@')) {
      email = String(meta.customer_email).trim().toLowerCase();
      emailSource = 'metadata.customer_email';
    }
    if (!email && payment.external_reference && String(payment.external_reference).includes('@')) {
      const ref = String(payment.external_reference);
      const idx = ref.indexOf(':');
      const candidate = (idx > -1 ? ref.substring(idx + 1) : ref).trim().toLowerCase();
      if (candidate.includes('@')) {
        email = candidate;
        emailSource = 'external_reference';
      }
    }
    if (!email && payment.payer && payment.payer.email) {
      email = String(payment.payer.email).trim().toLowerCase();
      emailSource = 'payer.email';
    }
    console.log('[mp-webhook] email extraído:', email, '| fonte:', emailSource,
      '| metadata:', JSON.stringify(meta),
      '| external_reference:', payment.external_reference,
      '| payer.email:', payment.payer && payment.payer.email);

    const customerName = meta.customer_name || (payment.payer && payment.payer.name) || '';
    const productId = meta.product_id || 'professor-do-futuro';
    // Senha gerada no navegador do cliente (antes do pagamento) e exibida
    // na tela da página de "obrigado". Passada aqui via metadata da preferência.
    const password = String(meta.customer_password || '');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error('[mp-webhook] E-mail ausente/inválido:', email, '| payer:', JSON.stringify(payment.payer || {}));
      return cors(json({ error: 'Pagamento aprovado sem e-mail válido.', payer_email: (payment.payer && payment.payer.email) || null }, 422));
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ---- Anti-duplicação: confere se já processamos este payment ----
    const existing = await admin
      .from('orders')
      .select('id')
      .eq('payment_id', paymentId)
      .maybeSingle();
    if (existing.data) {
      // Já processado → não criar conta de novo. Retorna 200 pra não re-enviar.
      return cors(json({ received: 'ok', duplicate: true }));
    }

    // ---- Cria o usuário no Auth com e-mail confirmado ----
    // Usa a senha gerada no navegador (mostrada ao cliente na tela de obrigado);
    // se, por algum motivo, a senha não tiver vindo, gera uma aleatória como fallback.
    const userPassword = password || randomPassword();
    let userId: string | null = null;

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: userPassword,
      email_confirm: true,
      user_metadata: {
        name: customerName || email,
        plan: productId,
        origem: 'vendas',
      },
    });

    if (createErr) {
      // E-mail já existe? Tenta localizar o usuário existente.
      if (createErr.message && /already registered|already been/i.test(createErr.message)) {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        let found: string | null = null;
        if (!listErr && list && list.users) {
          const hit = list.users.find(
            (u: any) => (u.email || '').toLowerCase() === email.toLowerCase()
          );
          if (hit) found = hit.id;
        }
        if (found) {
          userId = found;
        } else {
          return cors(json({ error: 'Conta já existente mas não localizada.', detail: createErr.message }, 409));
        }
      } else {
        return cors(json({ error: 'Falha ao criar usuário.', detail: createErr.message }, 500));
      }
    } else {
      userId = created && created.user ? created.user.id : null;
    }

    // ---- Registra na tabela orders ----
    await admin.from('orders').insert({
      payment_id: paymentId,
      status,
      email,
      customer_name: customerName || null,
      product_id: productId,
      amount: payment.transaction_amount ? Number(payment.transaction_amount) : null,
      meta: JSON.stringify({ uid: userId, payer: payment.payer || {} }),
    });
// ---- Entrega do acesso ----
    // Backup da entrega das credenciais: além de exibir na tela de "obrigado",
    // enviamos por e-mail o login (e-mail cadastrado) e a senha gerada, para o
    // cliente não perder o acesso caso feche a página sem copiar.
    if (BREVO_API_KEY && BREVO_FROM_EMAIL) {
      const loginUrl = (Deno.env.get('SITE_URL') || 'https://professor-do-futuro-brown.vercel.app').replace(/\/$/, '') + '/login.html';
      const brand = COURSE_NAME;
      const firstName = (customerName || '').split(' ')[0] || 'Aluno(a)';
      await sendEmail(
        email,
        `🎓 Bem-vindo ao ${brand}! Seu acesso está liberado`,
        `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 14px rgba(15,23,42,.08);">
  <tr><td style="background:linear-gradient(135deg,#0b7a5e 0%,#0d9488 60%,#6366f1 100%);padding:32px 32px 26px;text-align:center;">
    <div style="font-size:40px;line-height:1">🎓</div>
    <h1 style="color:#ffffff;margin:12px 0 4px;font-size:22px;font-weight:bold;">Bem-vindo(a), ${firstName}!</h1>
    <p style="color:rgba(255,255,255,.85);margin:0;font-size:14px;">Seu pagamento foi aprovado e seu acesso ao <b>${brand}</b> já está ativo 🎉</p>
  </td></tr>
  <tr><td style="padding:28px 32px 8px;">
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 18px;">Guarde suas credenciais de acesso. Você vai usá-las para entrar no curso:</p>
  </td></tr>
  <tr><td style="padding:0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0 0 10px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:bold;">E-mail de acesso</p>
        <p style="margin:0 0 16px;font-size:16px;color:#0f172a;font-weight:bold;">${email}</p>
        <p style="margin:0 0 10px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:bold;">Senha</p>
        <p style="margin:0;font-size:16px;color:#0f172a;font-weight:bold;font-family:monospace;background:#ffffff;border:1px dashed #cbd5e1;border-radius:8px;padding:10px 12px;text-align:center;">${userPassword}</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:24px 32px 4px;text-align:center;">
    <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#0b7a5e,#0d9488);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-weight:bold;font-size:16px;box-shadow:0 4px 10px rgba(13,148,136,.35);">Entrar no curso →</a>
  </td></tr>
  <tr><td style="padding:14px 32px 8px;">
    <p style="color:#64748b;font-size:12.5px;line-height:1.6;margin:0;text-align:center;">📌 <b>Não encontrou este e-mail?</b> Verifique a caixa de <b>spam / promoções</b> e marque como "não é spam".<br>🔒 Guarde estas credenciais em um lugar seguro.</p>
  </td></tr>
  <tr><td style="padding:16px 32px 28px;border-top:1px solid #f1f5f9;margin-top:12px;">
    <p style="color:#94a3b8;font-size:12px;margin:0;text-align:center;line-height:1.6;">Qualquer dúvida, basta responder este e-mail.<br>Equipe ${brand} · © 2026</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
      ).catch(() => {});
    } else {
      console.warn('[mp-webhook] Brevo não configurado; e-mail de credenciais não enviado.');
    }

    // Avisa o dono (opcional) — vai para o e-mail do dono, não para o cliente
    if (OWNER_EMAIL && OWNER_EMAIL !== email) {
      await sendEmail(
        OWNER_EMAIL,
        `Nova venda! ${email}`,
        `<p>Nova venda aprovada no ${COURSE_NAME}.</p>
         <p><b>Cliente:</b> ${customerName || email}<br><b>E-mail:</b> ${email}<br>
         <b>Valor:</b> R$ ${Number(payment.transaction_amount || 0).toFixed(2)}</p>`
      ).catch(() => {});
    }

    return cors(json({ received: true, status, email }));
  } catch (err) {
    console.error('[mp-webhook]', err);
    return cors(json({ error: 'Erro no webhook.', detail: String((err as Error).message || err) }, 500));
  }
});