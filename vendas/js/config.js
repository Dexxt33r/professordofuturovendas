/* ============================================
   PROFESSOR DO FUTURO — SITE DE VENDAS
   config.js
   ---------------
   Arquivo ÚNICO de configuração do site de vendas.
   Preencha os campos abaixo antes de publicar.
   ============================================ */
(function () {
  'use strict';

  window.SALES_CONFIG = {
    // >>> COLE AQUI <<<
    // URL base da Edge Function "create-preference" (Supabase).
    // Depois de fazer o deploy (ver backend/README.md), a URL fica no formato:
    //   https://SEU-PROJETO.supabase.co/functions/v1/create-preference
    createPreferenceUrl: 'https://ngkkhpvganrfctvyyvle.supabase.co/functions/v1/create-preference',

    // >>> COLE AQUI <<<
    // Token público da sua conta Supabase (Project Settings > API > anon/public key).
    // Opcional — usado apenas se você quiser logar o cliente no fluxo. Pode deixar vazio.
    supabasePublicKey: '',

    // >>> A PÚBLICA do Mercado Pago <<<
    // Pode ir ao frontend (não é segredo). É usada apenas se você colocar
    // um pagamento transparente no futuro; no fluxo atual (Checkout) não é obrigatória.
    mercadoPagoPublicKey: 'APP_USR-67ace49c-841d-48c6-a469-089aaec9754f',

    // >>> Contato do proprietário / suporte <<<
    ownerEmail: 'kaiosantosss938@gmail.com',

    // >>> URL do site de vendas (onde o aluno volta após o pagamento) <<<
    // Use SEMPRE a URL absoluta e pública do site de vendas publicado na Vercel.
    // Assim o Mercado Pago devolve o cliente para o SITE (domínio correto),
    // e não para um caminho/arquivo relativo quebrado.
    siteUrl: 'https://professor-do-futuro-vendas.vercel.app',

    // >>> URL do site do curso (onde o aluno faz login com e-mail + senha) <<<
    courseUrl: 'https://professor-do-futuro-brown.vercel.app/',

    // Identificador do produto vendido (deve bater com o vendido no backend/README.md).
    productId: 'professor-do-futuro',

    // Nome de exibição do produto.
    productName: 'Professor do Futuro',

    // >>> PREÇO — fonte única da verdade no front-end <<<
    // ATENÇÃO: priceCents TEM QUE SER IGUAL ao unit_price da Edge Function
    // backend/supabase/functions/create-preference/index.ts. Se divergir, o
    // Mercado Pago cobra um valor diferente do que a página anuncia.
    // Não use preço "âncora" (de R$ X por R$ Y) sem histórico real de venda
    // nesse valor: é publicidade enganosa (CDC art. 37, §1º).
    priceCents: 9700,
    priceNow: 'R$ 97',
    priceInstallments: 'em até 3x no cartão',

    // ---------- ANALYTICS (medição de tráfego e conversão) ----------
    // Sem isso você não sabe quantas pessoas visitam, de onde vêm, nem onde
    // desistem. Preencha PELO MENOS um dos dois abaixo.
    // GA4: crie em https://analytics.google.com (Admin > Fluxos de dados > Web)
    //      e cole o ID que começa com "G-".
    // Umami: https://cloud.umami.is (grátis, mais simples, sem cookie banner).
    analytics: {
      ga4Id: '',            // ex.: 'G-XXXXXXXXXX'
      umamiWebsiteId: '',   // ex.: 'a1b2c3d4-....'
      umamiSrc: 'https://cloud.umami.is/script.js',
      debug: false          // true = mostra cada evento no console do navegador
    },

    // ---------- DADOS DO FORNECEDOR (obrigatório — Decreto 7.962/2013) ----------
    // Estes dados aparecem no rodapé do site e nas páginas de Termos e
    // Privacidade. Preencha antes de vender.
    seller: {
      legalName: 'Professor do Futuro',   // razão social / nome empresarial
      document: 'CPF 130.593.256-00',    // '00.000.000/0000-00' (CNPJ) ou '000.000.000-00' (CPF)
      address: 'Atendimento on-line em todo o Brasil (endereco informado na proposta e no atendimento)',     // rua, nº, complemento, bairro, cidade/UF, CEP
      phone: '',       // telefone de atendimento
      email: 'kaiosantosss938@gmail.com'
    },

    // Canal de atendimento rápido (opcional): só números, com DDI 55.
    // Ex.: '5511999999999'. Vazio = o botão de WhatsApp não aparece.
    whatsapp: '',

    // URLs ABSOLUTAS para onde o aluno volta dependendo do status do pagamento.
    successUrl: 'https://professor-do-futuro-vendas.vercel.app/obrigado.html',
    pendingUrl: 'https://professor-do-futuro-vendas.vercel.app/pendente.html',
    failureUrl: 'https://professor-do-futuro-vendas.vercel.app/falha.html'
  };
})();