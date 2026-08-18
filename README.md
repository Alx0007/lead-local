# Lead Local

Ferramenta de prospecção de clientes locais. Busca empresas por nicho e cidade, pontua cada uma pela chance de fechar, organiza num funil e abre o WhatsApp com a mensagem pronta.

Ferramenta de prospecção e de produção: acha empresas por nicho e cidade, pontua cada uma pela chance de fechar, organiza num funil com valores e datas, guarda o acervo de landings já produzidas e manda a abordagem pelo WhatsApp.

Projeto sem build: não tem npm, não tem compilação, não tem etapa de compilar. São arquivos de texto que o navegador entende direto. O banco compartilhado é o Supabase, chamado por `fetch`.

## Como rodar

O app **precisa** ser servido por HTTP. Abrir o `index.html` com duplo clique não funciona: o Chrome bloqueia chamadas de rede em páginas vindas do disco (`file://`) e toda busca falha com "Failed to fetch". O próprio app avisa se você abrir do jeito errado.

**Com VS Code (recomendado).** Abra esta pasta no VS Code — ele vai sugerir instalar a extensão Live Server, aceite. Depois clique com o botão direito no `index.html` e escolha "Open with Live Server". Abre em `http://localhost:5500`.

**Sem VS Code.** Dê duplo clique em `iniciar-servidor.bat`. Ele sobe um servidor com Python e já abre o navegador em `http://localhost:8000`.

## Estrutura

```
lead-local/
├── index.html              a tela inteira e os modais
├── css/style.css           todo o visual
├── js/app.js               a lógica do app
├── js/nuvem.js             tudo que fala com o banco compartilhado
├── supabase/esquema.sql    tabelas, políticas de acesso e contador de envios
├── netlify.toml            configuração da publicação
├── iniciar-servidor.bat    servidor local no Windows
└── .vscode/  .claude/      configurações de editor
```

O `app.js` está dividido em blocos numerados e comentados, na ordem em que as coisas acontecem:

1. Armazenamento — o `Store`, único ponto de gravação do app; é dele que sai a sincronização
2. Nichos, categorias e localidades — a lista de nichos, os grupos da tela e os estados e cidades do IBGE
3. Utilitários — telefone brasileiro, escape de HTML, avisos na tela
4. Score — a regra que decide se um lead vale sua ligação
5. Mensagem de abordagem e 5B. envio pela uazapi
7. Busca no Google Places e escrita com IA
9 a 10. Renderização de resultados, funil e painel · 10B. acervo de landings
11. Exportação · 12 e 13. Eventos e inicialização · 14. Migração e autoteste da nuvem

## Onde mexer primeiro

**Mudar os pesos do score** — função `pontuar()`, bloco 4. Hoje "não ter site" vale 45 pontos porque você vende site. Se mudar de serviço, mude os pesos. A pontuação é normalizada no fim, então você não precisa fazer os números somarem 100.

**Mudar os textos das mensagens** — função `montarMsg()`, bloco 5. São três variações: sem site, só rede social, e já tem site.

**Adicionar nichos** — lista `NICHOS`, bloco 2. É só o nome do nicho, que vira o termo buscado no Google. Termos fora da lista continuam funcionando: escolha "— outro termo (digitar) —" no fim da lista e digite o que quiser, que vira busca por nome.

**Mexer nas categorias** — objeto `CATEGORIAS`, bloco 2. Cada categoria é só uma lista de nichos que já existem em `NICHOS`. Se você adicionar um nicho e esquecer de citá-lo numa categoria, ele não some: aparece sozinho no grupo "Outros".

**Estados e cidades** vêm da API de localidades do IBGE, grátis e sem chave. A lista de cada estado fica em cache no navegador depois da primeira vez. Se o IBGE não responder, o campo vira texto livre sozinho e você digita "Curitiba, PR" como antes.

**Adicionar etapas no funil** — array `ETAPAS`, bloco 1. Mexeu ali, o Kanban e o painel se ajustam sozinhos.

## As chaves

Ambas ficam guardadas só no seu navegador, nunca saem da sua máquina, e se configuram dentro do app em ⚙ Config.

**Google Places** — traz telefone, nota e avaliações. Exige conta de faturamento ativa no Google Cloud com meio de pagamento; não existe caminho sem cartão. Ative a **Places API (New)** e a **Maps JavaScript API**, e libere as duas nas restrições da chave. Ponha um teto de cota diária (200/dia resolve) para não ter surpresa.

**Google Gemini** — escreve a mensagem de abordagem. Grátis, sem cartão, em `aistudio.google.com`. Se der erro de modelo não encontrado, troque o nome do modelo em Config.

A chave do Places é obrigatória para buscar. A do Gemini é opcional, só para reescrever mensagens.

## Envio automático pelo WhatsApp

Configurado em ⚙ Config, usando a **uazapi**. Com servidor e token preenchidos, aparecem dois botões novos: **Enviar agora** no modal da mensagem, e **Disparar no WhatsApp** na barra de resultados.

A fila percorre os leads **visíveis** que têm telefone com DDD e ainda não foram contatados, **um por vez**: mostra a mensagem já preenchida, você revisa, cola o link da página daquele lead, e manda. Nada sai sem você ver.

**Mensagem padrão** — o texto que aparece preenchido fica em ⚙ Config e é editável. Estas etiquetas são trocadas sozinhas: `[nome do restaurante]` (ou `[nome]`), `[categoria]` e `[cidade]`. A etiqueta `[link]` vira o endereço da landing do acervo marcada para aquele nicho; sem landing cadastrada ela fica visível no texto, e o app pergunta antes de enviar assim.

Esvaziando esse campo, voltam os três modelos automáticos por tipo de lead (sem site / só rede social / já tem site).

Travas embutidas, no bloco 5B do `app.js`:

- **Intervalo** entre envios, com variação sorteada de ±40% para não sair num ritmo mecânico. Mínimo 20 segundos. O botão de enviar fica travado com contagem regressiva — use esse tempo para preparar o link do próximo.
- **Teto diário da equipe**, contado no banco e zerado à meia-noite. É compartilhado de propósito: o número de WhatsApp é um só, e dois contadores separados fariam o número levar o dobro de disparos. Toda tentativa conta, dando certo ou não. Por isso **enviar exige internet** — navegar e editar funcionam offline.
- **Freio automático:** três erros seguidos param a fila. Restrição do WhatsApp (erro 463) para na hora, porque insistir piora a avaliação do número.

Um envio bem-sucedido move o lead para "Contatado" no funil.

**O aviso que importa:** a uazapi é um gateway não-oficial — conecta no seu WhatsApp como o WhatsApp Web faz. Isso está fora dos termos de uso do WhatsApp, e o número que corre risco de banimento é o seu. Use um chip separado do pessoal e comece com o teto baixo.

## Trabalho em equipe

O funil, o acervo e as configurações ficam num banco compartilhado (Supabase). Cada pessoa entra com sua conta e vê o mesmo funil; alteração de um aparece na tela do outro sem recarregar.

O `localStorage` continua sendo a cópia de trabalho, e é por isso que o app funciona no celular sem sinal. Cada alteração sobe na hora; se a conexão falhar, fica numa fila e sobe quando voltar. Em conflito, vence quem salvou por último.

O cabeçalho mostra o estado: **sincronizado**, **enviando** ou **sem conexão**.

Na primeira vez que você entra num aparelho, o que estiver guardado ali sobe sozinho para o banco. Em ⚙ Backup há **Ver o que está no banco**, que compara os dois lados e nomeia o que ficou para trás, e **Testar a conexão**, que escreve, lê e apaga um registro de teste.

O esquema do banco está em `supabase/esquema.sql`. As políticas de acesso são o que protege os dados: a chave que vai no código é pública de propósito, e sem login ela não lê nem escreve nada.

## Publicando para a equipe

O app precisa estar num endereço que todos alcancem — `localhost` só existe na sua máquina e não abre no celular.

A publicação é pelo **Netlify**, ligado ao repositório do GitHub: em netlify.com, "Add new site" → "Import an existing project" → escolha o repositório. Não tem build, então o comando fica vazio e a pasta publicada é a raiz (o `netlify.toml` já diz isso). A cada `git push`, o site atualiza sozinho.

Depois de publicar, dois ajustes:

- No Google Cloud, libere o endereço novo nas restrições da chave do Places. Sem isso a busca para de funcionar fora do localhost.
- Os dados são protegidos pelo login do Supabase, não pelo endereço. Quem abrir a URL vê só a tela de entrada.

## Guardando versões

Se quiser histórico do que você mudou, dentro da pasta:

```
git init
git add .
git commit -m "primeira versão"
```

O `.gitignore` já ignora os CSVs e backups que o app gera, para não sujar o repositório.
