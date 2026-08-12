# Lead Local

Ferramenta de prospecção de clientes locais. Busca empresas por nicho e cidade, pontua cada uma pela chance de fechar, organiza num funil e abre o WhatsApp com a mensagem pronta.

Projeto sem build: não tem npm, não tem compilação, não tem dependência. São três arquivos de texto que o navegador entende direto.

## Como rodar

O app **precisa** ser servido por HTTP. Abrir o `index.html` com duplo clique não funciona: o Chrome bloqueia chamadas de rede em páginas vindas do disco (`file://`) e toda busca falha com "Failed to fetch". O próprio app avisa se você abrir do jeito errado.

**Com VS Code (recomendado).** Abra esta pasta no VS Code — ele vai sugerir instalar a extensão Live Server, aceite. Depois clique com o botão direito no `index.html` e escolha "Open with Live Server". Abre em `http://localhost:5500`.

**Sem VS Code.** Dê duplo clique em `iniciar-servidor.bat`. Ele sobe um servidor com Python e já abre o navegador em `http://localhost:8000`.

## Estrutura

```
lead-local/
├── index.html              a tela: cabeçalho, busca, resultados, funil, painel, modais
├── css/style.css           todo o visual
├── js/app.js               toda a lógica
├── iniciar-servidor.bat    sobe o servidor local no Windows
└── .vscode/                configuração do Live Server e da tarefa de servidor
```

O `app.js` está dividido em blocos numerados e comentados, na ordem em que as coisas acontecem:

1. Armazenamento — salva funil e configurações no navegador, com proteção se estiver bloqueado
2. Dicionário de nichos e categorias — traduz "academia" para as etiquetas do OpenStreetMap e agrupa os nichos nas categorias da tela
2B. Localidades — carrega estados e cidades da API do IBGE
3. Utilitários — telefone brasileiro, escape de HTML, avisos na tela
4. Score — a regra que decide se um lead vale sua ligação
5. Mensagem de abordagem — os três modelos, escolhidos pelo que falta no lead
6. Busca no OpenStreetMap
7. Busca no Google Places e escrita com IA
8. Dados de exemplo
9 a 11. Renderização e exportação
12 e 13. Eventos e inicialização

## Onde mexer primeiro

**Mudar os pesos do score** — função `pontuar()`, bloco 4. Hoje "não ter site" vale 45 pontos porque você vende site. Se mudar de serviço, mude os pesos. A pontuação é normalizada no fim, então você não precisa fazer os números somarem 100.

**Mudar os textos das mensagens** — função `montarMsg()`, bloco 5. São três variações: sem site, só rede social, e já tem site.

**Adicionar nichos** — objeto `NICHOS`, bloco 2. Cada entrada liga um termo em português às etiquetas do OpenStreetMap. Termos fora da lista continuam funcionando: escolha "— outro termo (digitar) —" no fim da lista e digite o que quiser, que vira busca por nome.

**Mexer nas categorias** — objeto `CATEGORIAS`, bloco 2. Cada categoria é só uma lista de nichos que já existem em `NICHOS`. Se você adicionar um nicho e esquecer de citá-lo numa categoria, ele não some: aparece sozinho no grupo "Outros".

**Estados e cidades** vêm da API de localidades do IBGE, grátis e sem chave. A lista de cada estado fica em cache no navegador depois da primeira vez. Se o IBGE não responder, o campo vira texto livre sozinho e você digita "Curitiba, PR" como antes.

**Adicionar etapas no funil** — array `ETAPAS`, bloco 1. Mexeu ali, o Kanban e o painel se ajustam sozinhos.

## As chaves

Ambas ficam guardadas só no seu navegador, nunca saem da sua máquina, e se configuram dentro do app em ⚙ Config.

**Google Places** — traz telefone, nota e avaliações. Exige conta de faturamento ativa no Google Cloud com meio de pagamento; não existe caminho sem cartão. Ative a **Places API (New)** e a **Maps JavaScript API**, e libere as duas nas restrições da chave. Ponha um teto de cota diária (200/dia resolve) para não ter surpresa.

**Google Gemini** — escreve a mensagem de abordagem. Grátis, sem cartão, em `aistudio.google.com`. Se der erro de modelo não encontrado, troque o nome do modelo em Config.

Sem nenhuma das duas o app funciona pelo OpenStreetMap, que não pede chave nenhuma.

## Envio automático pelo WhatsApp

Configurado em ⚙ Config, usando a **uazapi**. Com servidor e token preenchidos, aparecem dois botões novos: **Enviar agora** no modal da mensagem, e **Disparar no WhatsApp** na barra de resultados.

A fila percorre os leads **visíveis** que têm telefone com DDD e ainda não foram contatados, **um por vez**: mostra a mensagem já preenchida, você revisa, cola o link da página daquele lead, e manda. Nada sai sem você ver.

**Mensagem padrão** — o texto que aparece preenchido fica em ⚙ Config e é editável. Estas etiquetas são trocadas sozinhas: `[nome do restaurante]` (ou `[nome]`), `[categoria]` e `[cidade]`. A etiqueta `[link]` fica como está de propósito — a página de demonstração muda a cada lead. Se você tentar enviar com `[link]` ainda no texto, o app pergunta antes.

Esvaziando esse campo, voltam os três modelos automáticos por tipo de lead (sem site / só rede social / já tem site).

Travas embutidas, no bloco 5B do `app.js`:

- **Intervalo** entre envios, com variação sorteada de ±40% para não sair num ritmo mecânico. Mínimo 20 segundos. O botão de enviar fica travado com contagem regressiva — use esse tempo para preparar o link do próximo.
- **Teto diário**, contado no navegador e zerado à meia-noite. Toda tentativa conta, dando certo ou não: o que pesa para o WhatsApp é o tráfego que sai do número. Batido o teto, a fila se fecha sozinha.

Um envio bem-sucedido move o lead para "Contatado" no funil.

**O aviso que importa:** a uazapi é um gateway não-oficial — conecta no seu WhatsApp como o WhatsApp Web faz. Isso está fora dos termos de uso do WhatsApp, e o número que corre risco de banimento é o seu. Use um chip separado do pessoal e comece com o teto baixo.

## Guardando versões

Se quiser histórico do que você mudou, dentro da pasta:

```
git init
git add .
git commit -m "primeira versão"
```

O `.gitignore` já ignora os CSVs e backups que o app gera, para não sujar o repositório.
