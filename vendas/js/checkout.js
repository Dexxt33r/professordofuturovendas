/* ============================================
   PROFESSOR DO FUTURO — SITE DE VENDAS
   checkout.js
   ---------------
   Coleta nome + e-mail + cupom/afiliado do aluno,
   chama a Edge Function "create-preference" do Supabase,
   registra a venda após pagamento aprovado e cria conta
   no site do curso automaticamente.
   ============================================ */
(function () {
  "use strict";

  var cfg = window.SALES_CONFIG;

  function $id(id) { return document.getElementById(id); }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  }

  function resolveUrl(url) {
    if (!url) return url;
    if (/^(https?:)?\/\//i.test(url)) return url;
    var base = window.location.pathname;
    var idx = base.lastIndexOf("/");
    var dir = idx >= 0 ? base.slice(0, idx + 1) : "/";
    return dir + url;
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function generatePassword(len) {
    len = len || 10;
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    var arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    var out = "";
    for (var i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    return out;
  }

  function storeCustomer(email, name, password) {
    try {
      localStorage.setItem("pdf-venda-cliente", JSON.stringify({
        email: email, name: name, password: password, data: new Date().toISOString()
      }));
    } catch (e) {}
  }

  function setLoading(btn, loading, text, loadingText) {
    if (!btn) return;
    if (loading) {
      btn.dataset.orig = btn.dataset.orig || btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = "<span class=\"loading-spinner\"></span>" + (loadingText || "Processando…");
    } else {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.orig || text;
    }
  }

  function showError(field, msg) {
    if (!field) return;
    var wrap = field.closest(".field");
    if (!wrap) return;
    wrap.classList.add("invalid");
    var err = wrap.querySelector(".field-error");
    if (err) err.textContent = msg;
  }

  function clearErrors() {
    document.querySelectorAll(".field.invalid").forEach(function (w) {
      w.classList.remove("invalid");
    });
  }

  // Lista de cupons válidos e desconto em centavos (R$ 97,00 = 9700 centavos)
  // Adicione novos cupons aqui no formato "CODIGO": descontoEmCentavos
  var CUPONS_VALIDOS = {
    "THY10": 970,   // 10% de desconto -> R$ 87,30
    "MTH10": 970,   // 10% de desconto -> R$ 87,30
    "CRR10": 970,   // 10% de desconto -> R$ 87,30
    "VRG10": 970,   // 10% de desconto -> R$ 87,30
    "JSA10": 970    // 10% de desconto -> R$ 87,30
  };

  // Estado do cupom aplicado (preenchido quando o usuário clica em "Aplicar desconto")
  var estadoCupom = {
    codigo: "",
    descontoCentavos: 0,
    valorFinal: 0,
    precoCheio: 0,
    aplicado: false
  };

  function aplicarCupom() {
    var cupomField = $id("cliente_cupom");
    var msgEl = $id("msg_cupom");
    var btnCompra = document.querySelector(".checkout-form button[type=submit]");

    if (!cupomField) return;

    var cupom = (cupomField.value || "").trim();
    clearErrors();

    if (!cupom) {
      msgEl.textContent = "";
      msgEl.className = "cupom-msg";
      estadoCupom = { codigo: "", descontoCentavos: 0, valorFinal: 0, precoCheio: 0, aplicado: false };
      if (btnCompra) btnCompra.textContent = "Quero meu acesso por R$ 97";
      return;
    }

    var cupomUpper = cupom.toUpperCase();
    if (CUPONS_VALIDOS.hasOwnProperty(cupomUpper)) {
      var priceCents = (typeof cfg.priceCents === "number" ? cfg.priceCents : 0);
      var desconto = CUPONS_VALIDOS[cupomUpper];
      var valorFinal = priceCents - desconto;

      estadoCupom = {
        codigo: cupomUpper,
        descontoCentavos: desconto,
        valorFinal: valorFinal,
        precoCheio: priceCents,
        aplicado: true
      };

      msgEl.textContent = "Cupom aplicado! Você economiza R$ " + (desconto / 100).toFixed(2);
      msgEl.className = "cupom-msg success";

      if (btnCompra) {
        btnCompra.textContent = "Quero meu acesso por R$ " + (valorFinal / 100).toFixed(2);
        btnCompra.classList.add("btn-compra-principal");
      }

      cupomField.closest(".field").classList.remove("invalid");
    } else {
      msgEl.textContent = "Cupom inválido. Tente: " + Object.keys(CUPONS_VALIDOS).join(", ");
      msgEl.className = "cupom-msg error";
      estadoCupom = { codigo: "", descontoCentavos: 0, valorFinal: 0, precoCheio: 0, aplicado: false };
      showError(cupomField, "Cupom inválido.");
    }
  }

  function startCheckout(form, btn) {
    var nameField = $id("cliente_nome");
    var emailField = $id("cliente_email");

    var name = nameField ? nameField.value.trim() : "";
    var email = normalizeEmail(emailField ? emailField.value : "");

    clearErrors();
    var ok = true;
    if (!name) { showError(nameField, "Informe seu nome completo."); ok = false; }
    if (!isValidEmail(email)) { showError(emailField, "Informe um e-mail válido."); ok = false; }
    if (!ok) return;

    var precoCheio = estadoCupom.precoCheio || (typeof cfg.priceCents === "number" ? cfg.priceCents : 0);
    var descontoCentavos = estadoCupom.descontoCentavos || 0;
    var valorFinal = estadoCupom.valorFinal || precoCheio;
    var cupomAplicado = estadoCupom.codigo || "";

    prosseguirParaPagamento(name, email, null, cupomAplicado, precoCheio, descontoCentavos, valorFinal, btn, btn.textContent);
  }

  function prosseguirParaPagamento(name, email, password, cupom, precoCheio, descontoCentavos, valorFinal, btn, btnText) {
    if (!password) password = generatePassword();
    storeCustomer(email, name, password);
    setLoading(btn, true, btnText || "Quero meu acesso por R$ 97", "Abrindo checkout…");

    function withCredentials(url) {
      try {
        var u = url + (url.indexOf("?") === -1 ? "?" : "&") +
          "email=" + encodeURIComponent(email) +
          "&senha=" + encodeURIComponent(password);
        return u;
      } catch (e) { return url; }
    }

    var payload = {
      product_id: cfg.productId,
      customer: { name: name, email: email, password: password },
      cupom_codigo: cupom || "",
      desconto_centavos: descontoCentavos,
      valor_final_centavos: valorFinal,
      back_urls: {
        success: withCredentials(resolveUrl(cfg.successUrl)),
        pending: withCredentials(resolveUrl(cfg.pendingUrl)),
        failure: withCredentials(resolveUrl(cfg.failureUrl))
      }
    };

    fetch(resolveUrl(cfg.createPreferenceUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) { throw new Error("Resposta de preferência inválida (" + res.status + ")"); }
        return res.json();
      })
      .then(function (data) {
        if (data && data.init_point) {
          if (window.pdfTrack) {
            window.pdfTrack("checkout_redirect", {
              currency: "BRL",
              value: valorFinal / 100,
              product: cfg.productName || "Professor do Futuro",
              cupom: cupom || ""
            });
          }
          // Redireciona para o Checkout do Mercado Pago
          window.location.href = data.init_point;
        } else {
          throw new Error("A resposta não trouxe o link do checkout.");
        }
      })
      .catch(function (err) {
        if (window.pdfTrack) {
          window.pdfTrack("checkout_error", { reason: "create_preference_falhou", detail: String(err && err.message ? err.message : err) });
        }
        setLoading(btn, false, "Quero meu acesso por R$ 97");
        var msg = "Não foi possível iniciar o pagamento agora. Tente novamente em instantes.";
        alert(msg);
      });
  }

  function init() {
    var forms = document.querySelectorAll(".checkout-form");
    forms.forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var btn = form.querySelector("button[type=submit]");
        startCheckout(form, btn);
      });
    });

    // Botão "Aplicar desconto" ao lado do campo de cupom
    var btnAplicar = $id("btn_aplicar_cupom");
    if (btnAplicar) {
      btnAplicar.addEventListener("click", aplicarCupom);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(); 
