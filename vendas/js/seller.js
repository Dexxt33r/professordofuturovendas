/* ============================================
   PROFESSOR DO FUTURO — SITE DE VENDAS
   seller.js
   ---------------
   Preenche os dados do fornecedor (nome empresarial, CNPJ/CPF, endereço
   e contato) em todos os elementos marcados com [data-seller="..."], a
   partir de window.SALES_CONFIG.seller.

   Como funciona:
   - Campos soltos: qualquer elemento com [data-seller="campo"] recebe o valor.
     Se o campo estiver vazio, o elemento é escondido (junto do wrapper
     [data-seller-line], se houver).
   - Bloco de identificação: o container [data-seller-block="identificacao"]
     é montado linha por linha, MOSTRANDO APENAS o que estiver preenchido.
     Nada de traço "—" nem aviso na tela: enquanto você não preencher, o
     bloco simplesmente não aparece.
   - Com [data-rotulado] no container, as linhas saem com rótulo
     ("Fornecedor:", "CNPJ/CPF:", "Endereço:"), formato usado nas páginas
     de Termos e Privacidade.
   ============================================ */
(function () {
  'use strict';

  var CFG = window.SALES_CONFIG || {};
  var S = CFG.seller || {};
  var CAMPOS = ['legalName', 'document', 'address', 'phone', 'email'];

  function val(campo) { return String(S[campo] || '').trim(); }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function soDigitos(t) { return String(t).replace(/[^\d+]/g, ''); }

  function emailContato() { return val('email') || String(CFG.ownerEmail || '').trim(); }

  // ------------------------------------------------------------------
  // 1) Campos soltos
  // ------------------------------------------------------------------
  function preencherCampos() {
    CAMPOS.forEach(function (campo) {
      var valor = val(campo);
      var alvos = document.querySelectorAll('[data-seller="' + campo + '"]');
      Array.prototype.forEach.call(alvos, function (el) {
        var wrapper = el.closest ? (el.closest('[data-seller-line]') || el) : el;
        if (!valor) { wrapper.hidden = true; return; }
        wrapper.hidden = false;
        if (el.tagName === 'A' && campo === 'email') {
          el.href = 'mailto:' + valor;
          el.textContent = valor;
        } else if (el.tagName === 'A' && campo === 'phone') {
          el.href = 'tel:' + soDigitos(valor);
          el.textContent = valor;
        } else {
          el.textContent = valor;
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // 2) Bloco de identificação — só aparece quando há identificação real
  // ------------------------------------------------------------------
  // Para manter o rodapé limpo, o bloco fica oculto enquanto não houver
  // nome, documento ou endereço preenchidos. E-mail/telefone sozinhos não
  // revelam o bloco: o contato já aparece nos links próprios de cada página.
  function montarBloco(bloco) {
    var rotulado = bloco.hasAttribute('data-rotulado');
    var linhas = [];

    var nome = val('legalName');
    var doc = val('document');

    var temIdentificacao = Boolean(nome || doc || val('address'));
    if (!temIdentificacao) { bloco.hidden = true; bloco.innerHTML = ''; return; }

    if (nome && doc) {
      linhas.push(rotulado
        ? '<b>Fornecedor:</b> ' + esc(nome) + ' · <b>CNPJ/CPF:</b> ' + esc(doc)
        : '<b>' + esc(nome) + '</b> · CNPJ/CPF: ' + esc(doc));
    } else if (nome) {
      linhas.push(rotulado ? '<b>Fornecedor:</b> ' + esc(nome) : '<b>' + esc(nome) + '</b>');
    } else if (doc) {
      linhas.push((rotulado ? '<b>CNPJ/CPF:</b> ' : 'CNPJ/CPF: ') + esc(doc));
    }

    if (val('address')) {
      linhas.push((rotulado ? '<b>Endereço:</b> ' : '') + esc(val('address')));
    }

    var contato = [];
    if (val('email')) {
      contato.push('<a href="mailto:' + esc(val('email')) + '">' + esc(val('email')) + '</a>');
    }
    if (val('phone')) {
      contato.push('<a href="tel:' + soDigitos(val('phone')) + '">' + esc(val('phone')) + '</a>');
    }
    if (contato.length) {
      linhas.push((rotulado ? '<b>Atendimento:</b> ' : 'Atendimento: ') + contato.join(' · '));
    }

    if (!linhas.length) { bloco.hidden = true; bloco.innerHTML = ''; return; }
    bloco.innerHTML = linhas.join('<br>');
    bloco.hidden = false;
  }

  function preencherBlocos() {
    var blocos = document.querySelectorAll('[data-seller-block="identificacao"]');
    Array.prototype.forEach.call(blocos, montarBloco);
  }

  // ------------------------------------------------------------------
  // 3) Botão de WhatsApp (opcional)
  // ------------------------------------------------------------------
  function montarWhatsApp() {
    var numero = String(CFG.whatsapp || '').replace(/\D/g, '');
    Array.prototype.forEach.call(document.querySelectorAll('[data-whatsapp]'), function (el) {
      if (!numero) { el.hidden = true; return; }
      var msg = el.getAttribute('data-whatsapp') || 'Olá! Tenho uma dúvida sobre o curso Professor do Futuro.';
      el.href = 'https://wa.me/' + numero + '?text=' + encodeURIComponent(msg);
      el.hidden = false;
    });
  }

  // ------------------------------------------------------------------
  function preencher() {
    preencherCampos();
    preencherBlocos();
    montarWhatsApp();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', preencher);
  } else {
    preencher();
  }
})();
