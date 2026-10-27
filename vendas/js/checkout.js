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
      btn.dataset.orig = btn.innerHTML;
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

  function startCheckout(form, btn) {
    var nameField = $id("cliente_nome");
    var emailField = $id("cliente_email");
    var cupomField = $id("cliente_cupom");
    var afiliadoField = $id("cliente_afiliado");

    var name = nameField ? nameField.value.trim() : "";
    var email = normalizeEmail(emailField ? emailField.value : "");
    var cupom = (cupomField ? cupomField.value : "").trim();
    var afiliado = (afiliadoField ? afiliadoField.value : "").trim();

    clearErrors();
    var ok = true;
    if (!name) { showError(nameField, "Informe seu nome completo."); ok = false; }
    if (!isValidEmail(email)) { showError(emailField, "Informe um e-mail válido."); ok = false; }
    if (!ok) return;

    var priceCents = (typeof cfg.priceCents === "number" ? cfg.priceCents : 0);
    var precoCheio = priceCents;
    var descontoCentavos = 0;
    var valorFinal = precoCheio;

    // Cupons de 10% de desconto (R$ 97 originais -> R$ 87,30 com desconto)
    var cuponsValidos = {
      "THY10": 970,   // 10% de 9700 = 970 centavos
      "MTH10": 970,
      "CRR10": 970,
      "VRG10": 970,
      "JSA10": 970
    };

    if (cupom) {
      if (cuponsValidos[cupom]) {
        descontoCentavos = cuponsValidos[cupom];
        valorFinal = precoCheio - descontoCentavos;
        setLoading(btn, true, "Comprar agora", "Aplicando desconto…");

        // Aplicar desconto imediatamente na interface
        var btnValor = document.querySelector(".preco-atual");
        if (btnValor) btnValor.textContent = "R$ " + (valorFinal / 100).toFixed(2);

        // Prosseguir para pagamento com o cupom aplicado
        prosseguirParaPagamento(name, email, null, cupom, afiliado, precoCheio, descontoCentavos, valorFinal, btn);
      } else {
        setLoading(btn, false, "Comprar agora");
        showError(cupomField, "Cupom inválido ou não encontrado. Cupons disponíveis: THY10, MTH10, CRR10, VRG10, JSA10");
      }
      return;
    }

    prosseguirParaPagamento(name, email, null, "", afiliado, precoCheio, 0, precoCheio, btn);
  }

  function prosseguirParaPagamento(name, email, password, cupom, afiliado, precoCheio, descontoCentavos, valorFinal, btn) {
    if (!password) password = generatePassword();
    storeCustomer(email, name, password);
    setLoading(btn, true, "Comprar agora", "Abrindo checkout…");

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
      codigo_afiliado: afiliado || "",
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
              cupom: cupom || "",
              afiliado: afiliado || ""
            });
          }
          window.location.href = data.init_point;
        } else {
          throw new Error("A resposta não trouxe o link do checkout.");
        }
      })
      .catch(function () {
        if (window.pdfTrack) {
          window.pdfTrack("checkout_error", { reason: "create_preference_falhou" });
        }
        setLoading(btn, false, "Comprar agora");
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  } 
