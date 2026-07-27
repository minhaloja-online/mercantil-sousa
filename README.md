# MercadoPDV — Sistema de gestão para comércio

Sistema completo de frente de caixa (PDV), estoque, controle de validade e
financeiro, feito para funcionar principalmente no celular, instalável como
app (PWA) e com Firebase como banco de dados em nuvem.

## Arquivos do projeto

```
index.html               → a aplicação (telas, estilos)
app.js                    → toda a lógica (Firebase, PDV, estoque, relatórios...)
firebase-config.js        → ⚠️ ARQUIVO QUE VOCÊ PRECISA EDITAR com as chaves do seu Firebase
manifest.json             → configuração do app instalável (PWA)
sw.js                     → service worker (cache do app para funcionar offline)
icon-192.png / icon-512.png / icon-maskable-512.png → ícones do app
README.md                 → este guia
```

> O pedido original foi por um único `index.html`. Na prática, um PWA com
> Firebase **precisa** de alguns arquivos extras (`manifest.json`, `sw.js`,
> ícones), e separar `app.js` do `index.html` deixa o projeto muito mais fácil
> de manter e depurar. Funcionalmente é a mesma coisa: são os arquivos que
> compõem "o site". Todos ficam na mesma pasta.

---

## Passo 1 — Criar o projeto no Firebase

1. Acesse **https://console.firebase.google.com** e clique em **"Adicionar projeto"**.
2. Dê um nome (ex: `mercadopdv`) e siga o assistente (pode desativar o Google Analytics, não é necessário).
3. Dentro do projeto, clique no ícone **`</>`** ("Web") para registrar um app da Web.
   - Apelido: `MercadoPDV Web`. Não marque "Firebase Hosting" (vamos usar o GitHub Pages).
   - O Firebase vai mostrar um bloco `firebaseConfig = {...}`. **Copie esses valores.**
4. Abra o arquivo **`firebase-config.js`** e cole seus valores no lugar de `COLE_AQUI_SUA_API_KEY` etc.

## Passo 2 — Ativar o Authentication (login)

1. No menu lateral, vá em **Build → Authentication → Get started**.
2. Na aba **Sign-in method**, ative o provedor **E-mail/senha**.
3. Pronto — o app já poderá criar contas pela própria tela de login ("Criar primeiro acesso").

## Passo 3 — Criar o banco de dados (Firestore)

1. Menu lateral → **Build → Firestore Database → Criar banco de dados**.
2. Escolha o modo **produção** (não "teste", vamos configurar as regras corretamente já no passo seguinte) e a região mais próxima (ex: `southamerica-east1` para o Brasil).
3. Vá até a aba **Regras** e substitua o conteúdo por:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function isAdmin() {
      return signedIn() &&
        get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.papel == 'admin';
    }
    // Perfil de cada usuário: qualquer pessoa logada pode ler,
    // mas só o próprio usuário ou um admin pode alterar o perfil.
    match /usuarios/{uid} {
      allow read: if signedIn();
      allow write: if signedIn() && (request.auth.uid == uid || isAdmin());
    }
    // Demais coleções (produtos, vendas, estoque, financeiro...):
    // liberado para qualquer usuário autenticado.
    match /{document=**} {
      allow read, write: if signedIn();
    }
  }
}
```

4. Clique em **Publicar**.

> **Sobre permissões por perfil (admin/operador/caixa):** o app já esconde
> botões e telas conforme o perfil na interface (ex: caixa não vê o menu
> Financeiro). As regras acima garantem que só quem tem login pode mexer nos
> dados, mas **não bloqueiam no servidor** um operador de editar algo que só o
> admin deveria — isso é reforçado apenas no app. Se quiser bloquear também no
> servidor, me peça e eu adiciono regras mais específicas por coleção
> (checando `get(.../usuarios/$(request.auth.uid)).data.papel` em cada
> `match`).

## Passo 4 — Testar localmente

Como o app usa `fetch`/módulos, o ideal é rodar por um servidor local (abrir o
`index.html` direto com duplo clique pode bloquear alguns recursos no
navegador). A forma mais simples:

- Instale a extensão **"Live Server"** no VS Code e clique em "Go Live", **ou**
- No terminal, dentro da pasta do projeto: `python3 -m http.server 8080` e acesse `http://localhost:8080`.

Na primeira vez, toque em **"Criar primeiro acesso (administrador)"**, informe
e-mail e senha — essa primeira conta já entra como **administrador**.

---

## Passo 5 — Criar o repositório no GitHub

1. Acesse **https://github.com** → **New repository**.
   - Nome: `mercadopdv` (ou o que preferir).
   - Deixe **Public** ou **Private**, como preferir. Não marque "Add README" (já temos um).
2. No computador, dentro da pasta com os arquivos do projeto, rode:

```bash
git init
git add .
git commit -m "Primeira versão do MercadoPDV"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/mercadopdv.git
git push -u origin main
```

3. **Importante:** o `firebase-config.js` contém as chaves do seu projeto
   Firebase. Elas não são "secretas" no sentido tradicional (ficam visíveis no
   navegador de qualquer forma), mas quem realmente protege seus dados são as
   **Regras do Firestore** do Passo 3. Ainda assim, se preferir não deixar o
   arquivo público, adicione `firebase-config.js` a um `.gitignore` e suba
   manualmente esse arquivo direto no servidor onde for hospedar.

## Passo 6 — Publicar o site (GitHub Pages) para acessar pelo celular

1. No repositório do GitHub → **Settings → Pages**.
2. Em **Source**, escolha a branch `main` e a pasta `/ (root)`. Salve.
3. Em ~1 minuto o GitHub mostra o link, algo como:
   `https://seu-usuario.github.io/mercadopdv/`
4. Abra esse link **no celular** pelo Chrome (Android) ou Safari (iPhone).

## Passo 7 — Instalar como app no celular

- **Android (Chrome):** abra o link → menu (⋮) → **"Instalar aplicativo"** / "Adicionar à tela inicial".
- **iPhone (Safari):** abra o link → botão de compartilhar (□↑) → **"Adicionar à Tela de Início"**.

O ícone passa a abrir em tela cheia, como um app nativo.

---

## O que já funciona

- **Dashboard**: faturamento do dia/mês, lucro do dia, ticket médio, estoque, alertas de validade e estoque baixo, gráficos (vendas por dia, lucro por mês, produtos e categorias mais vendidos).
- **Cadastro de produtos** completo (código de barras, categoria, marca, unidade, fornecedor, custo, preço, margem automática, estoque mín/atual, localização, fabricação/validade, foto), com busca e filtro por categoria.
- **Leitor de código de barras** pela câmera (usa a biblioteca `html5-qrcode`), tanto no cadastro quanto na tela de venda.
- **PDV** com busca por nome/código, carrinho com quantidade +/-, **venda avulsa** (frutas/verduras por Kg, sem cadastro e sem baixa de estoque), pagamento em Pix/Dinheiro/Cartão/Fiado com cálculo de troco, geração de comprovante, impressão pelo navegador, compartilhamento e **impressão Bluetooth** (ver limitações).
- **Baixa automática de estoque** na venda, priorizando os lotes que vencem primeiro (FIFO).
- **Estoque**: lotes com data de fabricação/validade e status colorido (verde/amarelo/vermelho), movimentações (entrada/saída/ajuste/transferência) com histórico, contagem de inventário.
- **Financeiro**: lançamentos de entrada/saída, despesas, contas a pagar/receber, saldo.
- **Relatórios**: diário, mensal, anual, por vendedor/categoria/cliente/produto, produtos sem venda, vencidos e abaixo do mínimo — com exportação em **Excel** e **PDF**.
- **Importação/exportação de produtos em Excel** (planilha `.xlsx`).
- **Backup manual** (baixa um `.json` com todos os dados) direto pelo app.
- **Tema claro/escuro**.
- **PWA instalável** com ícone próprio, e **cache do app** para abrir mesmo sem internet (os dados sincronizam sozinhos quando a conexão volta, graças à persistência offline nativa do Firestore).
- **Perfis de usuário** (administrador/operador/caixa) com telas e botões liberados conforme o perfil.

## Limitações importantes (leia antes de usar em produção)

- **Impressão Bluetooth** usa a *Web Bluetooth API*, que só existe no
  **Chrome/Edge para Android**. O **Safari do iPhone não suporta** Bluetooth
  via navegador (restrição da Apple) — no iPhone, use o botão "Imprimir" ou
  "Compartilhar" do comprovante. Além disso, cada modelo de impressora
  térmica usa um protocolo Bluetooth próprio; o app tenta os padrões mais
  comuns, mas impressoras muito específicas podem exigir ajustes.
- **Convidar usuários**: por segurança, um app rodando só no navegador não
  pode criar a senha de outra pessoa. Por isso, cada funcionário cria o
  próprio acesso na tela de login, e depois o administrador só ajusta o
  **perfil** dele (admin/operador/caixa) em Configurações → Usuários.
- **Itens da venda**: para ser mais rápido e gastar menos leituras do banco,
  os itens de cada venda ficam **dentro do próprio documento da venda**
  (`vendas.itens`), em vez de numa coleção separada `itensVenda` — o resultado
  para relatórios é o mesmo, só muda como fica guardado.
- **Contas a pagar/receber e despesas** ficam numa única coleção `despesas`
  (com um campo `tipo`: `pagar` ou `receber`), em vez de coleções separadas —
  mais simples de consultar e manter.
- **Regras de segurança**: como explicado no Passo 3, hoje qualquer pessoa
  logada pode alterar qualquer dado; o controle por perfil é feito na
  interface. Para um controle também no servidor, é só pedir.
- Este é um projeto extenso entregue em uma primeira versão funcional — voltas
  finas (ex: relatório comparativo lado a lado, impressão térmica mais
  robusta, back-up automático agendado via Cloud Functions) podem ser
  refinadas depois, uma de cada vez.

## Estrutura das coleções no Firestore

```
usuarios/{uid}            → nome, email, papel (admin|operador|caixa), ativo
categorias/{id}           → nome
fornecedores/{id}         → nome, contato, telefone
clientes/{id}             → nome, telefone, fiado
produtos/{id}             → codigoBarras, nome, categoriaId, marca, unidade,
                             fornecedorId, custo, preco, margem, estoqueMinimo,
                             estoqueAtual, localizacao, dataFabricacao,
                             dataValidade, foto (base64)
lotes/{id}                → produtoId, dataFabricacao, dataValidade, quantidade
vendas/{id}                → numero, data, itens[], total, custoTotal, lucro,
                             formaPagamento, valorPago, troco, clienteId,
                             vendedorId, vendedorNome, status
movimentacoesEstoque/{id} → produtoId, tipo (entrada|saida|ajuste|transferencia),
                             quantidade, motivo, data, usuarioId
financeiro/{id}           → tipo (entrada|saida), categoria, valor, data, descricao
despesas/{id}             → tipo (pagar|receber), descricao, valor,
                             dataVencimento, status (pendente|pago), categoria
configuracoes/geral       → nomeLoja, temaPreferido, ultimoBackup, numeracaoVenda
```

Qualquer dúvida no caminho, é só chamar.
