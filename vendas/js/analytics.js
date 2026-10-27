/* ============================================
   PROFESSOR DO FUTURO — SITE DE VENDAS
   analytics.js
   ---------------
   Medição de tráfego e de eventos de conversão.

   Como funciona:
   - Lê a configuração em js/config.js (window.SALES_CONFIG.analytics).
   - Se analytics.ga4Id estiver preenchido, carrega o Google Analytics 4.
   - Se analytics.umamiWebsiteId estiver preenchido, carrega o Umami.
   - TODO evento também é enviado para window.dataLayer, então você pode
     plugar Google Tag Manager (e, por tabela, Meta Pixel / Google Ads)
     depois, sem mexer neste arquivo.
   - Nenhum ID configurado = nada sai para fora, mas os eventos continuam
     disponíveis no console (analytics.debug) e em window.PDF_TRACK_LOG.

   Eventos:
     page_view            toda página
     scroll_75            chegou a 75% da página (sinal de interesse real)
     cta_click            clique em qualquer elemento com [data-track]
     begin_checkout       envio válido do formulário de compra
     checkout_redirect    redirecionado para o Checkout do Mercado Pago
     checkout_error       falha ao criar a preferência de pagamento
     purchase             página de obrigado (pagamento aprovado)
     purchase_pending     página de pendente (Pix/boleto em aberto)
     purchase_failed      página de falha
   ============================================ */
(function () {
  'use strict';

  var CFG = window.SALES_CONFIG || {};
  var A = CFG.analytics || {};
  var PRICE = (typeof CFG.priceCents === 'number' ? CFG.priceCents : 0) / 100;
  var PRODUCT = CFG.productName || 'Professor do Futuro';

  // Log local de eventos (inspeção manual: window.PDF_TRACK_LOG no console)
  window.PDF_TRACK_LOG = [];

  function log(name, params) {
    window.PDF_TRACK_LOG.push({ event: name, params: params || {}, at: new Date().toISOString() });
    if (A.debug && window.console && console.log) {
      console.log('%c[analytics] ' + name, 'color:#0f9d72;font-weight:bold', params || {});
    }
  }

  /**
   * Envia um evento para todas as ferramentas configuradas.
   * Nunca lança erro: medição jamais pode quebrar a página de vendas.
   * @param {string} name
   * @param {object} [params]
   */
  function track(name, params) {
    var p = params || {};
    log(name, p);
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: name }, p));
    } catch (e) {}
    try { if (typeof window.gtag === 'function') window.gtag('event', name, p); } catch (e) {}
    try {
      if (window.umami && typeof window.umami.track === 'function') window.umami.track(name, p);
    } catch (e) {}
  }

  // Exposto globalmente: checkout.js e as páginas de retorno usam.
  window.pdfTrack = track;

  // ------------------------------------------------------------------
  // Carga das ferramentas
  // ------------------------------------------------------------------
  function loadGA4(id) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', id, { anonymize_ip: true });
  }

  function loadUmami(id, src) {
    var s = document.createElement('script');
    s.async = true;
    s.defer = true;
    s.src = src || 'https://cloud.umami.is/script.js';
    s.setAttribute('data-website-id', id);
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------
  // Eventos automáticos
  // ------------------------------------------------------------------
  function initPageView() {
    track('page_view', {
      page_path: window.location.pathname,
      page_title: document.title,
      page_location: window.location.href
    });
  }

  function initScroll() {
    var fired = false;
    function check() {
      if (fired) return;
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      var pct = (window.pageYOffset || doc.scrollTop) / max;
      if (pct >= 0.75) {
        fired = true;
        track('scroll_75', { page_path: window.location.pathname });
        window.removeEventListener('scroll', onScroll);
      }
    }
    function onScroll() { check(); }
    window.addEventListener('scroll', onScroll, { passive: true });
    check();
  }

  function initClicks() {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-track]') : null;
      if (!el) return;
      track('cta_click', {
        label: el.getAttribute('data-track'),
        text: (el.textContent || '').trim().slice(0, 80),
        target: el.getAttribute('href') || ''
      });
    });
  }

  // ------------------------------------------------------------------
  // Páginas de retorno do pagamento
  //
  // A página declara o seu papel em <body data-analytics-page="...">.
  // Em "obrigado" dispara um evento de compra. Para não contar duas vezes
  // quando o aluno recarrega a página, deduplicamos por e-mail: a mesma
  // compra só é enviada uma vez neste navegador.
  // ------------------------------------------------------------------
  function initResultPage() {
    var page = document.body ? document.body.getAttribute('data-analytics-page') : '';
    if (!page) return;

    var email = '';
    try { email = new URLSearchParams(window.location.search).get('email') || ''; } catch (e) {}

    var payload = {
      currency: 'BRL',
      value: PRICE,
      product: PRODUCT,
      email: email || undefined
    };

    if (page === 'obrigado') {
      var key = 'pdf-purchase-sent:' + (email || 'anonimo');
      var already = false;
      try { already = localStorage.getItem(key) === '1'; } catch (e) {}
      if (already) { log('purchase_duplicado_ignorado', payload); return; }
      track('purchase', payload);
      try { localStorage.setItem(key, '1'); } catch (e) {}
      return;
    }

    if (page === 'pendente') { track('purchase_pending', payload); return; }
    if (page === 'falha') { track('purchase_failed', payload); return; }
  }

  // ------------------------------------------------------------------
  function init() {
    initPageView();
    initScroll();
    initClicks();
    initResultPage();
  }

  if (A.ga4Id) loadGA4(A.ga4Id);
  if (A.umamiWebsiteId) loadUmami(A.umamiWebsiteId, A.umamiSrc);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
