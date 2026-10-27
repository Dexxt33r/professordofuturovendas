#  Site de Vendas — Professor do Futuro

Este repositório é o **site de vendas** (front-end + backend de pagamento).
O **site do curso** (onde o aluno faz login) fica no repositório principal,
em `site/` — publicado em `https://professor-do-futuro-brown.vercel.app/`.

---

## ⚙️ Configuração em UM arquivo: `js/config.js`

Quase tudo que muda no dia a dia está em `js/config.js`. Não espalhe esses
valores em HTML — se você editar em dois lugares, um vai ficar desatualizado.

| Campo | Para que serve | Obrigatório? |
|---|---|---|
| `createPreferenceUrl` | URL da Edge Function que cria a cobrança | **Sim** |
| `priceCents` / `priceNow` | Preço cobrado e preço anunciado | **Sim** |
| `analytics.ga4Id` ou `analytics.umamiWebsiteId` | Medição de tráfego e conversão | **Sim (na prática)** |
| `seller.*` | Dados do fornecedor exigidos pelo Decreto 7.962/2013 | **Sim, por lei** |
| `whatsapp` | Botão de contato rápido (opcional) | Não |

### ⚠️ Regra de ouro do preço

`priceCents` (aqui, em centavos) **tem que ser igual** ao `unit_price` da Edge
Function `backend/supabase/functions/create-preference/index.ts` (lá, em reais).
Se divergir, a página anuncia um valor e o Mercado Pago cobra outro.

Depois de mudar o preço no backend, **faça o redeploy**:

```bash
cd backend
supabase functions deploy create-preference
```

### 📋 Dados do fornecedor (obrigatório por lei)

O **Decreto 7.962/2013, art. 2º, I e II** exige que todo site de e-commerce
brasileiro exiba, **em local de destaque**, o nome empresarial, a inscrição
(CNPJ ou CPF) e o endereço físico e eletrônico do fornecedor.

Preencha `seller` em `js/config.js`:

```js
seller: {
  legalName: 'RAZÃO SOCIAL LTDA',
  document: '00.000.000/0000-00',
  address: 'Rua Exemplo, 100, sala 2 — Bairro — Cidade/UF — CEP 00000-000',
  phone: '(11) 0000-0000',
  email: 'seu@email.com'
}
```

Enquanto estiver vazio, **as páginas exibem um aviso visível de pendência** no
rodapé, em Termos e em Privacidade. Isso é proposital: é melhor lançar com o
aviso do que publicar em desacordo com a lei.

**Use o CNPJ da sua própria empresa.** Nunca coloque o CNPJ de terceiros:
além de ilegal, isso transfere a responsabilidade do seu produto para outra
pessoa — e ela pode ser cobrada por algo que não vendeu.

---

## 📊 Medição (analytics)

Sem medição você não sabe quantas pessoas visitam o site, de onde vêm, nem onde
desistem — e passa a decidir no escuro.

### Como ativar

1. **Google Analytics 4:** crie uma propriedade em
   [analytics.google.com](https://analytics.google.com) → *Admin → Fluxos de
   dados → Web* → copie o ID que começa com `G-` e cole em `analytics.ga4Id`.
2. **Ou Umami** (mais simples, sem aviso de cookie):
   [cloud.umami.is](https://cloud.umami.is) → copie o *website id* e cole em
   `analytics.umamiWebsiteId`.
3. Para conferir no seu navegador, ligue `analytics.debug: true`. Cada evento
   aparece no console, e você também pode inspecionar:

```js
window.PDF_TRACK_LOG        // histórico de eventos desta página
window.dataLayer            // eventos enviados para o Google Tag Manager
```

### Eventos já instrumentados

| Evento | Quando dispara |
|---|---|
| `page_view` | Qualquer página |
| `scroll_75` | Aluno chegou a 75% da página (interesse real) |
| `cta_click` | Clique em qualquer elemento com `data-track="..."` |
| `begin_checkout` | Formulário de compra preenchido corretamente |
| `checkout_redirect` | Aluno saiu para o Checkout do Mercado Pago |
| `checkout_error` | Falha ao criar a cobrança |
| `purchase` | Página de obrigado (pagamento aprovado) — deduplicado por e-mail |
| `purchase_pending` | Página pendente (Pix/boleto em aberto) |
| `purchase_failed` | Página de falha |

Todos os eventos também vão para `window.dataLayer`, então você pode plugar
**Google Tag Manager** (e, por tabela, Meta Pixel / Google Ads) depois, sem
mexer em nenhuma linha de código.

**Métricas que importam, em ordem:** visitas → cliques no botão de compra →
`begin_checkout` → `checkout_redirect` → `purchase`. O ponto onde o número cai
mais é onde está o seu problema.

---

##  Estrutura

```
vendas/
├── index.html            → página de vendas (curso individual)
├── escolas.html          → página B2B (escolas, redes, secretarias)
├── img/                  → prints reais do curso (galeria) + og.jpg (compartilhamento)
├── termos.html           → termos de uso, garantia de 7 dias, arrependimento
├── privacidade.html      → política de privacidade (LGPD)
├── obrigado.html         → pagamento aprovado (exibe credenciais)
├── pendente.html         → Pix/boleto aguardando confirmação
├── falha.html            → pagamento não concluído
├── css/style.css         → tema global
├── js/
│   ├── config.js         → TODA a configuração (preço, seller, analytics)
│   ├── seller.js         → preenche os dados do fornecedor no site
│   ├── analytics.js      → medição de tráfego e eventos de conversão
│   └── checkout.js       → coleta nome/e-mail e chama o Mercado Pago
├── backend/              → Supabase Edge Functions (create-preference, mp-webhook, payment-status)
├── prospeccao/           → material comercial: roteiros, listas, posts
└── robots.txt / sitemap.xml
```

---

## 🚀 Deploy

O site é estático (Vercel). Depois de editar:

```bash
git add .
git commit -m "descrição da mudança"
git push
```

O backend precisa de deploy separado (`cd backend && supabase functions deploy <nome>`).

---

##  Segurança

- **Nunca** commite `.env`, `.env.local`, tokens ou chaves secretas. O
  `.gitignore` já bloqueia, mas confira antes de cada `git add`.
- Um segredo que entrou no histórico do git **continua lá** mesmo depois de
  você apagar o arquivo. Se isso acontecer: **revogue/troque a chave** primeiro,
  depois limpe o histórico (`git filter-repo` ou BFG).
- A `service_role` do Supabase e o `Access Token` do Mercado Pago vivem apenas
  como *secrets* das Edge Functions — nunca no navegador.