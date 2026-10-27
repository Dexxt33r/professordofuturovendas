# 📦 Backend do Site de Vendas — Professor do Futuro

Backend **sem servidor próprio**, usando **Supabase Edge Functions**.
Ele cria a cobrança no **Mercado Pago**, recebe o **webhook** de pagamento
aprovado e **cria a conta de aluno(a)** no Supabase Auth.

**Como o aluno recebe o acesso:** a senha é gerada no navegador **antes** do
pagamento, enviada junto na preferência para o back-end e **exibida na tela**
da página `vendas/obrigado.html` — que só abre após o pagamento aprovado
(no Pix, a página `pendente.html` fica consultando até aprovar e redireciona
para `obrigado.html` com `?email=...&senha=...` na URL, para funcionar mesmo
em outro dispositivo).

Para o aluno NÃO perder o acesso (ex.: pagou o Pix de outro celular), o ideal
é enviar as credenciais também por **e-mail**. O `mp-webhook` já tem esse
código pronto — basta configurar a **Brevo** (passo 0 e 3) e setar as secrets
`BREVO_API_KEY`, `BREVO_FROM_EMAIL` e opcional `BREVO_FROM_NAME`. Sem isso,
nenhum e-mail é enviado ao aluno.

```
vendas/index.html → checkout.js (gera senha + salva no navegador)
        ↓  chama create-preference (Edge Function) com email+senha
    Mercado Pago Checkout
        ↓  pagamento aprovado → webhook
    mp-webhook (Edge Function) → cria conta no Supabase com a MESMA senha
        ↓  aluno volta para obrigado.html → vê a senha na tela
        ↓  botão leva para http://professor-do-futuro-brown.vercel.app/
```

---

## ⚙️ 0. Pré-requisitos

1. **Supabase CLI** instalada — para deploy das Edge Functions e do banco.
   - Instalação: https://supabase.com/docs/guides/cli
2. Uma conta no **Mercado Pago** (vendedor).
3. *(Opcional, mas recomendado)* Uma conta na **Brevo** (ex-Sendinblue) — além
   de **você (dono)** receber aviso de novas vendas, permite **enviar ao aluno**
   o e-mail com login/senha (recomendado para o Pix): configure `BREVO_API_KEY`
   e `BREVO_FROM_EMAIL` como secrets no passo 3. O plano gratuito envia 300
   e-mails/dia. Sem Brevo, o acesso só aparece na tela de "obrigado" (não há
   e-mail automático).

---

## 🔐 1. Chaves/credenciais que você vai precisar

| Onde | O quê | Como pegar |
|---|---|---|
| Mercado Pago | `Access Token` de **produção** | Painel MP → *Desenvolvedores → Integrações → Minhas credenciais* → marcar o modo Produção |
| Supabase | `Service Role Key` | *Project Settings → API* → `service_role` (⚠️ secreta) |
| Supabase | `Project URL` | *Project Settings → API* |
| Brevo *(opcional)* | `API Key` | Env. aluno (login/senha) + aviso de venda ao dono |

> **Segurança:** a `Access Token` do Mercado Pago e a `service_role` do
> Supabase **nunca** devem ir para o navegador. Elas entram apenas como
> **Secret** das Edge Functions (passo 3). Nada disso deve ser colocado
> em `vendas/js/config.js` ou no HTML.

### 🔑 Suas credenciais do Mercado Pago (produção) — fornecidas por você

Use os valores abaixo **apenas como Secret nas Edge Functions** (passo 3).
**Não** cole o `Access Token` no frontend.

| Item | Valor |
|---|---|
| **Public Key** (segura p/ frontend) | `APP_USR-67ace49c-841d-48c6-a469-089aaec9754f` |
| **Access Token** (SECRETO — Edge Function) | `COLE_AQUI_SEU_ACCESS_TOKEN_PRODUCAO` |
| **Client ID** | `SEU_CLIENT_ID` |
| **Client Secret** (SECRETO) | `COLE_AQUI_SEU_CLIENT_SECRET` |

> O `config.js` do site usa a **Public Key** para o Web Token (se quiser)
> e, principalmente, para nada além da criação da preferência. O fluxo
> atual só precisa da URL da Edge Function.

---

## 🗃️ 2. Banco de dados (tabela `orders`)

Aplique a migração que criei:

- `supabase/migrations/0001_orders.sql`

**Opção A — Dashboard:** Supabase → **SQL Editor** → cole o conteúdo → **Run**.

**Opção B — CLI:**
```bash
cd vendas/backend
supabase link --project-ref SEU_PROJETO
supabase db push
```

A tabela grava cada compra com um **índice único em `payment_id`**, então
mesmo que o webhook chegue 2 vezes, a conta é criada só uma vez (anti-duplicado).

---

## 🚀 3. Deploy das Edge Functions + Secrets

Já existem as duas funções prontas em `supabase/functions/`:
- `create-preference/index.ts` — cria a cobrança no MP.
- `mp-webhook/index.ts` — processa o pagamento aprovado.

Comandos (da pasta `vendas/backend`):

```bash
# 1) Variavel que aponta pro seu projeto
export SUPABASE_PROJECT=ngkkhpvganrfctvyyvle

# 2) Autenticar e apontar para o projeto
supabase login                      # pede o access token
supabase link --project-ref $SUPABASE_PROJECT

# 3) Guardar as SECRETS (valores de verdade, sem aspas)
supabase secrets set MERCADOPAGO_ACCESS_TOKEN=COLE_AQUI_SEU_ACCESS_TOKEN_PRODUCAO
# Brevo (recomendado): envia ao ALUNO o e-mail com login/senha e avisa VOCÊ
# (dono) sobre novas vendas. Descomente e preencha com seus dados:
#   - BREVO_API_KEY    → API key (Painel Brevo → SMTP & API → API Keys)
#   - BREVO_FROM_EMAIL → e-mail do remetente (sender) cadastrado/verificado
#   - BREVO_FROM_NAME  → (opcional) nome exibido como remetente
# supabase secrets set BREVO_API_KEY=xkeysib-AAAAAAAAAAA
# supabase secrets set BREVO_FROM_EMAIL=contato@seudominio.com.br
# supabase secrets set BREVO_FROM_NAME="Professor do Futuro"
supabase secrets set CALLBACK_TARGET=kaiosantosss938@gmail.com   # E-mail do dono (aviso de venda)

# 4) Fazer deploy das TRÊS funções (a `payment-status` é usada pela página
#    "pendente" e NÃO pode ficar de fora!)
supabase functions deploy create-preference --project-ref $SUPABASE_PROJECT
supabase functions deploy mp-webhook        --project-ref $SUPABASE_PROJECT
supabase functions deploy payment-status    --project-ref $SUPABASE_PROJECT

# 5) Confirme que as 3 funções responderam (verifique no dashboard também):
#    - https://$SUPABASE_PROJECT.supabase.co/functions/v1/payment-status?email=teste@teste.com
#      deve responder JSON (ex.: {"found":false,...}) — se der 404, a função não está deployada.
```

> A variável `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_URL` do webhook são
> **injetadas automaticamente** pelo Supabase em toda Edge Function — não
> precisa setar.

---

## 🧷 4. Configurar o webhook do Mercado Pago

1. No painel do Mercado Pago: **Desenvolvedores → Integrações → Webhooks**.
2. Crie um webhook de **`payment`**.
3. URL de notificação: a URL da sua função `mp-webhook`:
   ```
   https://$SUPABASE_PROJECT.supabase.co/functions/v1/mp-webhook
   ```
4. Salve.

> Além disso, a função `create-preference` já envia o `notification_url`
> apontando para `mp-webhook`. **Troque o placeholder** no arquivo
> `create-preference/index.ts` pela URL real antes do deploy
> (procure por `SUA_FUNCAO_WEBHOOK`).

---

## 🔗 5. Ligar o site de vendas ao backend

Edite **`../js/config.js`** (no site de vendas):

```js
createPreferenceUrl: 'https://ngkkhpvganrfctvyyvle.supabase.co/functions/v1/create-preference',
```

- 🔹 `successUrl` → `obrigado.html`
- 🔹 `pendingUrl`  → `pendente.html`
- 🔹 `failureUrl`  → `falha.html`

E publique a pasta `vendas/` num serviço de hospedagem estática
(Netlify, Vercel, GitHub Pages, ou até sua própria hospedagem).

---

## 🧪 6. Testar (com pagamento fake do MP)

O Mercado Pago oferece **cartões de teste** (Crédito de Teste). Quando o
preference estiver em modo **teste/sandbox**, faça uma compra no checkout:

- **Cartão de teste:** `5031 4332 1540 6351`
- **Demais dados:** qualquer CPF `12345678909`, validade futura, `123` no CVV.

Acompanhe:
- Tabela `orders` no Supabase (a compra deve aparecer).
- E-mail de boas-vindas (deve chegar com login/senha).
- Login funcionando no site do curso com esses dados.

> **Produção:** o Access Token que você forneceu já é de **produção**
> (inicia com `APP_USR-`). Nada mais a fazer nesse ponto.

---

## 🛠️ 7. Manutenção / dicas

- **Novo preço/produto:** altere o `PRODUCTS` em `create-preference/index.ts`
  e o valor em `vendas/js/config.js` e na página `index.html` (R$ 59,90 / 3x R$ 19,97).
- **Logs:** Supabase Dashboard → Edge Functions → função → **Logs/Invocation**.
- **Acesso manual (fallback):** se alguma venda não disparar, use o
  `criar-conta.bat` que já existe na raiz do projeto para criar a conta
  e envie as credenciais manualmente.
- **Reembolso (garantia de 7 dias):** faça o cancelamento/reembolso pelo
  painel do Mercado Pago e desative/bloqueie a conta do aluno no Supabase,
  se preciso.